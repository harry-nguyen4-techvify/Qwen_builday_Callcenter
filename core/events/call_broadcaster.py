"""
Global event broadcaster for call lifecycle events.

Unlike TranscriptBroadcaster (per-call subscriptions), this broadcasts
all call events to all subscribers (for the Calls dashboard).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncIterator, Literal

logger = logging.getLogger(__name__)


CallEventType = Literal[
    "call-started",
    "call-updated",
    "call-ended",
    "call-escalation-requested",
    "call-escalation-cleared",
    "call-card-locked",
    "incoming-call",
    "call-answered",
]


@dataclass
class CallEvent:
    """A call lifecycle event."""
    type: CallEventType
    call_id: str
    call: dict | None = None
    ended_at: str | None = None
    reason: str | None = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "call_id": self.call_id,
            "call": self.call,
            "ended_at": self.ended_at,
            "reason": self.reason,
            "timestamp": self.timestamp.isoformat(),
        }


class CallBroadcaster:
    """
    Global broadcaster for call events.

    Singleton pattern - use CallBroadcaster.get() to access.
    All subscribers receive all events (global subscription).
    """

    _instance: CallBroadcaster | None = None

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[CallEvent]] = []
        self._lock = asyncio.Lock()

    @classmethod
    def get(cls) -> CallBroadcaster:
        """Get or create the singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Reset singleton for testing."""
        cls._instance = None

    async def publish(
        self,
        event_type: CallEventType,
        call_id: str,
        call: dict | None = None,
        ended_at: str | None = None,
        reason: str | None = None,
    ) -> None:
        """
        Publish a call event to all subscribers.

        Args:
            event_type: Type of event
            call_id: UUID of the call
            call: Full call data (for started/updated)
            ended_at: ISO timestamp (for ended)
            reason: Optional reason (for escalation events)
        """
        event = CallEvent(
            type=event_type,
            call_id=call_id,
            call=call,
            ended_at=ended_at,
            reason=reason,
        )

        async with self._lock:
            subscribers = list(self._subscribers)

        if subscribers:
            logger.debug(
                "Broadcasting %s event for call_id=%s to %d subscribers",
                event_type,
                call_id,
                len(subscribers),
            )
            for queue in subscribers:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning(
                        "Subscriber queue full, dropping %s event for call_id=%s",
                        event_type,
                        call_id,
                    )

    async def subscribe(self) -> AsyncIterator[CallEvent]:
        """
        Subscribe to all call events.

        Yields CallEvent objects as they arrive.
        Automatically unsubscribes on generator exit.
        """
        queue: asyncio.Queue[CallEvent] = asyncio.Queue(maxsize=100)

        async with self._lock:
            self._subscribers.append(queue)
            subscriber_count = len(self._subscribers)

        logger.info("New call subscriber (total: %d)", subscriber_count)

        try:
            while True:
                event = await queue.get()
                yield event
        except asyncio.CancelledError:
            logger.debug("Call subscriber cancelled")
            raise
        finally:
            async with self._lock:
                try:
                    self._subscribers.remove(queue)
                    logger.info(
                        "Call subscriber removed (remaining: %d)",
                        len(self._subscribers),
                    )
                except ValueError:
                    pass

    def subscriber_count(self) -> int:
        """Get current number of subscribers."""
        return len(self._subscribers)
