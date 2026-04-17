"""
In-memory event broadcaster for single-instance deployment.

Uses asyncio.Queue for pub/sub within a single process.
For multi-instance scaling, replace with Redis pub/sub.

Supports optional real-time translation of final transcripts.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterator

from core.models.events import TranscriptEvent

logger = logging.getLogger(__name__)


@dataclass
class TranslationConfig:
    """Translation configuration for a call."""
    enabled: bool = False
    source: str = "vi"
    target: str = "en"


class TranscriptBroadcaster:
    """
    In-memory broadcaster for transcript events.

    Thread-safe singleton that manages per-call subscriber queues.
    Supports multiple SSE connections per call_id.
    """

    _instance: TranscriptBroadcaster | None = None
    _lock: asyncio.Lock | None = None

    def __init__(self) -> None:
        # call_id -> list of subscriber queues
        self._subscribers: dict[str, list[asyncio.Queue[TranscriptEvent]]] = defaultdict(list)
        # call_id -> current turn index
        self._turn_counters: dict[str, int] = defaultdict(int)
        # Track active calls for cleanup
        self._active_calls: set[str] = set()
        # call_id -> translation config
        self._translation_config: dict[str, TranslationConfig] = {}

    @classmethod
    def get(cls) -> TranscriptBroadcaster:
        """Get or create the singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset singleton for testing."""
        cls._instance = None

    def set_translation(
        self,
        call_id: str,
        enabled: bool,
        source: str = "vi",
        target: str = "en",
    ) -> None:
        """
        Enable/disable translation for a call.

        Args:
            call_id: The call to configure
            enabled: Whether to enable translation
            source: Source language code
            target: Target language code
        """
        self._translation_config[call_id] = TranslationConfig(
            enabled=enabled,
            source=source,
            target=target,
        )
        logger.info(
            "Translation %s for call_id=%s (%s->%s)",
            "enabled" if enabled else "disabled",
            call_id,
            source,
            target,
        )

    def get_translation_config(self, call_id: str) -> TranslationConfig:
        """Get translation config for a call (default: disabled)."""
        return self._translation_config.get(call_id, TranslationConfig())

    async def publish(
        self,
        call_id: str,
        role: str,
        text: str,
        is_final: bool,
    ) -> None:
        """
        Publish a transcript event to all subscribers of this call.

        If translation is enabled for this call and this is a final transcript,
        the event will include the translated text.

        Args:
            call_id: Unique identifier for the call/session
            role: Speaker role (agent, customer, system)
            text: The transcript text
            is_final: Whether this is a final transcript (vs interim)
        """
        # Normalize role
        if role.lower() in ("assistant", "ai"):
            role = "agent"
        elif role.lower() in ("user", "human"):
            role = "customer"

        # Validate role
        if role not in ("agent", "customer", "system"):
            role = "system"

        # Get turn index (increment on final transcripts)
        turn_index = self._turn_counters[call_id]
        if is_final:
            self._turn_counters[call_id] += 1

        # Translate if enabled and final
        translation: str | None = None
        if is_final:
            config = self._translation_config.get(call_id)
            if config and config.enabled and text.strip():
                try:
                    # Lazy import to avoid circular imports
                    from core.translation import get_translator

                    translator = get_translator()
                    translation = await translator.translate(
                        text=text,
                        source=config.source,
                        target=config.target,
                    )
                    # Don't include translation if it's same as original (fallback)
                    if translation == text:
                        translation = None
                    else:
                        logger.debug(
                            "Translated (%s->%s): %s... -> %s...",
                            config.source,
                            config.target,
                            text[:30],
                            translation[:30] if translation else "",
                        )
                except Exception as e:
                    logger.warning("Translation failed for call_id=%s: %s", call_id, e)
                    translation = None

        event = TranscriptEvent(
            call_id=call_id,
            role=role,  # type: ignore[arg-type]
            text=text,
            timestamp=datetime.utcnow(),
            is_final=is_final,
            turn_index=turn_index,
            translation=translation,
            is_translated=translation is not None,
        )

        # Track active call
        self._active_calls.add(call_id)

        # Persist final events asynchronously (non-blocking)
        if is_final:
            try:
                from core.events.transcript_persister import get_persister
                persister = get_persister()
                await persister.enqueue(event)
            except Exception as e:
                logger.warning("Persistence enqueue failed for call_id=%s: %s", call_id, e)

        # Broadcast to all subscribers
        subscribers = self._subscribers.get(call_id, [])
        if subscribers:
            logger.debug(
                "Broadcasting event to %d subscribers: call_id=%s role=%s is_final=%s translation=%s",
                len(subscribers),
                call_id,
                role,
                is_final,
                "yes" if translation else "no",
            )
            for queue in subscribers:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning("Subscriber queue full, dropping event for call_id=%s", call_id)

    async def subscribe(self, call_id: str) -> AsyncIterator[TranscriptEvent]:
        """
        Subscribe to transcript events for a call.

        Yields TranscriptEvent objects as they arrive.
        Automatically unsubscribes on generator exit.

        Args:
            call_id: The call to subscribe to

        Yields:
            TranscriptEvent objects
        """
        queue: asyncio.Queue[TranscriptEvent] = asyncio.Queue(maxsize=100)
        self._subscribers[call_id].append(queue)
        logger.info("New subscriber for call_id=%s (total: %d)", call_id, len(self._subscribers[call_id]))

        try:
            while True:
                event = await queue.get()
                yield event
        except asyncio.CancelledError:
            logger.debug("Subscriber cancelled for call_id=%s", call_id)
            raise
        finally:
            # Clean up subscription
            try:
                self._subscribers[call_id].remove(queue)
                logger.info(
                    "Subscriber removed for call_id=%s (remaining: %d)",
                    call_id,
                    len(self._subscribers[call_id]),
                )
            except ValueError:
                pass  # Already removed

    def cleanup(self, call_id: str) -> None:
        """
        Remove all state for a call when it ends.

        Should be called when a call/session terminates.
        """
        self._subscribers.pop(call_id, None)
        self._turn_counters.pop(call_id, None)
        self._translation_config.pop(call_id, None)
        self._active_calls.discard(call_id)
        logger.info("Cleaned up call_id=%s", call_id)

    def get_subscriber_count(self, call_id: str) -> int:
        """Get the number of active subscribers for a call."""
        return len(self._subscribers.get(call_id, []))

    def get_active_calls(self) -> set[str]:
        """Get set of call_ids with active sessions."""
        return self._active_calls.copy()
