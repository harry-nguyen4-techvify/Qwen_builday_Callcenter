"""
Transcript persistence service.

Batches final transcript events and writes them to the database.
Uses asyncio.Queue for non-blocking writes that don't stall the SSE stream.

Design notes:
- Only persists is_final=True events (skips interim transcripts)
- Batches writes: flush every 500ms or when batch_size reached
- Idempotent: (conversation_id, turn_index) unique constraint prevents duplicates
- ConversationHistory is looked up by its pk (UUID) stored in _conv_cache keyed by call_id string.
  Because the FK requires a real Call.id UUID, we create a bare-minimum Call record if
  one doesn't exist yet (for LiveKit calls that bypass the normal call-creation flow).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import List
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.db.base import AsyncSessionLocal
from core.db.models.call import Call
from core.db.models.conversation import ConversationHistory, ConversationTurn
from core.models.events import TranscriptEvent

logger = logging.getLogger(__name__)


class TranscriptPersister:
    """Batched async persistence of final transcript events."""

    def __init__(self, batch_size: int = 10, flush_interval: float = 0.5):
        self._batch_size = batch_size
        self._flush_interval = flush_interval
        self._queue: asyncio.Queue[TranscriptEvent] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        # call_id (str) -> conversation UUID
        self._conversation_cache: dict[str, UUID] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the background flush loop."""
        if self._task is None:
            self._task = asyncio.create_task(self._flush_loop())
            logger.info("TranscriptPersister started")

    async def stop(self) -> None:
        """Stop background loop and flush remaining events."""
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        # Final flush
        await self._flush()
        logger.info("TranscriptPersister stopped")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def enqueue(self, event: TranscriptEvent) -> None:
        """
        Queue a transcript event for persistence.

        Only final events are persisted (is_final=True).
        Flushes immediately when batch_size reached.
        """
        if not event.is_final:
            return

        await self._queue.put(event)

        if self._queue.qsize() >= self._batch_size:
            await self._flush()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _flush_loop(self) -> None:
        """Periodically flush the queue every flush_interval seconds."""
        while True:
            await asyncio.sleep(self._flush_interval)
            await self._flush()

    async def _flush(self) -> None:
        """Drain the queue and write events to DB in one transaction."""
        events: List[TranscriptEvent] = []
        while not self._queue.empty():
            try:
                events.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break

        if not events:
            return

        try:
            async with AsyncSessionLocal() as session:
                for event in events:
                    await self._persist_turn(session, event)
                await session.commit()
                logger.info("Persisted %d transcript turn(s)", len(events))
        except Exception as exc:
            logger.error("Failed to persist transcript batch: %s", exc, exc_info=True)
            # Re-queue events so they aren't lost on transient errors
            for ev in events:
                try:
                    self._queue.put_nowait(ev)
                except asyncio.QueueFull:
                    logger.warning("Queue full, dropping event turn_index=%d", ev.turn_index)

    async def _persist_turn(self, session: AsyncSession, event: TranscriptEvent) -> None:
        """
        Persist a single final transcript turn (idempotent).

        Uses INSERT OR IGNORE semantics via the unique constraint on
        (conversation_id, turn_index).
        """
        conv_id = await self._get_or_create_conversation(session, event.call_id)

        # Check if turn already exists (idempotent)
        existing = await session.execute(
            select(ConversationTurn.id).where(
                ConversationTurn.conversation_id == conv_id,
                ConversationTurn.turn_index == event.turn_index,
            )
        )
        if existing.scalar_one_or_none() is not None:
            logger.debug(
                "Turn already persisted: call_id=%s turn_index=%d — skipping",
                event.call_id,
                event.turn_index,
            )
            return

        turn = ConversationTurn(
            id=uuid4(),
            conversation_id=conv_id,
            turn_index=event.turn_index,
            role=event.role,
            text=event.text,
            timestamp=event.timestamp,
            translation=event.translation,
            translation_source=None,
            translation_target=None,
            is_translated=event.translation is not None,
        )
        session.add(turn)
        logger.debug(
            "Queued turn for insert: call_id=%s turn_index=%d role=%s",
            event.call_id,
            event.turn_index,
            event.role,
        )

    async def _get_or_create_conversation(
        self, session: AsyncSession, call_id: str
    ) -> UUID:
        """
        Get or create a ConversationHistory for the given call_id string.

        Lookup order:
        1. call_id as UUID → match Call.id
        2. call_id as room name → match Call.livekit_room
        3. Create lightweight stub if not found
        """
        if call_id in self._conversation_cache:
            return self._conversation_cache[call_id]

        call_uuid: UUID | None = None

        # Try to parse call_id as UUID first (might already be a call UUID)
        try:
            maybe_uuid = UUID(call_id)
            call_row = await session.execute(
                select(Call.id).where(Call.id == maybe_uuid)
            )
            call_uuid = call_row.scalar_one_or_none()
        except ValueError:
            pass  # call_id is a string slug, not a UUID

        # If not found by UUID, try livekit_room lookup
        if call_uuid is None:
            call_row = await session.execute(
                select(Call.id).where(Call.livekit_room == call_id)
            )
            call_uuid = call_row.scalar_one_or_none()

        # Still not found — create a lightweight stub
        if call_uuid is None:
            stub_call = Call(
                id=uuid4(),
                direction="inbound",
                caller_number=call_id,
                callee_number="system",
                status="in_progress",
            )
            session.add(stub_call)
            await session.flush()
            call_uuid = stub_call.id
            logger.info(
                "Created stub Call record for livekit call_id=%s -> call.id=%s",
                call_id,
                call_uuid,
            )
        else:
            logger.debug("Found existing Call for call_id=%s -> %s", call_id, call_uuid)

        # Now find or create ConversationHistory linked to this call
        conv_row = await session.execute(
            select(ConversationHistory.id).where(
                ConversationHistory.call_id == call_uuid
            )
        )
        conv_id = conv_row.scalar_one_or_none()

        if conv_id is None:
            conv = ConversationHistory(
                id=uuid4(),
                call_id=call_uuid,
            )
            session.add(conv)
            await session.flush()
            conv_id = conv.id
            logger.info(
                "Created ConversationHistory for call_id=%s conv_id=%s",
                call_id,
                conv_id,
            )

        self._conversation_cache[call_id] = conv_id
        return conv_id


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_persister: TranscriptPersister | None = None


def get_persister() -> TranscriptPersister:
    """Get or create the global TranscriptPersister singleton."""
    global _persister
    if _persister is None:
        _persister = TranscriptPersister()
    return _persister


def reset_persister() -> None:
    """Reset the singleton (for testing)."""
    global _persister
    _persister = None
