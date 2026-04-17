"""
In-memory event broadcaster for form state updates.

Uses asyncio.Queue for pub/sub within a single process.
For multi-instance scaling, replace with Redis pub/sub.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime
from typing import AsyncIterator

from core.models.events import FormFieldEvent

logger = logging.getLogger(__name__)


class FormStateBroadcaster:
    """
    In-memory broadcaster for form state events.

    Thread-safe singleton that manages per-call subscriber queues.
    Supports multiple SSE connections per call_id.
    """

    _instance: FormStateBroadcaster | None = None

    def __init__(self) -> None:
        # call_id -> list of subscriber queues
        self._subscribers: dict[str, list[asyncio.Queue[FormFieldEvent]]] = defaultdict(list)
        # Track active calls for cleanup
        self._active_calls: set[str] = set()
        # Per-call buffered state for replay to late subscribers
        self._init_state: dict[str, FormFieldEvent] = {}
        self._field_state: dict[str, dict[str, FormFieldEvent]] = defaultdict(dict)  # call_id -> field_id -> event
        self._status_state: dict[str, FormFieldEvent] = {}

    @classmethod
    def get(cls) -> FormStateBroadcaster:
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
        call_id: str,
        event_type: str,
        fields: list[dict] | None = None,
        field_id: str | None = None,
        value: str | None = None,
        validated: bool = False,
        attempts: int = 0,
        confirmed: bool = False,
        completed: bool = False,
    ) -> None:
        """
        Publish a form event to all subscribers of this call.

        This is the generic publish method used by the API endpoint.

        Args:
            call_id: Unique identifier for the call/session
            event_type: Type of event (form-init, field-update, form-confirmed, form-completed)
            fields: For form-init: list of field definitions [{id, label, field_type}]
            field_id: For field-update: the field being updated
            value: For field-update: the new value
            validated: For field-update: whether the value is validated
            attempts: For field-update: number of collection attempts
            confirmed: For form-confirmed: whether data is confirmed
            completed: For form-completed: whether form is submitted
        """
        event = FormFieldEvent(
            call_id=call_id,
            event_type=event_type,  # type: ignore[arg-type]
            timestamp=datetime.utcnow(),
            fields=fields,
            field_id=field_id,
            value=value,
            validated=validated,
            attempts=attempts,
            confirmed=confirmed,
            completed=completed,
        )
        self._active_calls.add(call_id)
        await self._broadcast(call_id, event)

    async def publish_init(
        self,
        call_id: str,
        fields: list[dict],
    ) -> None:
        """
        Publish a form-init event when the agent starts.

        Args:
            call_id: Unique identifier for the call/session
            fields: List of field definitions [{id, label, field_type}, ...]
        """
        event = FormFieldEvent(
            call_id=call_id,
            event_type="form-init",
            timestamp=datetime.utcnow(),
            fields=fields,
        )
        self._active_calls.add(call_id)
        await self._broadcast(call_id, event)

    async def publish_field(
        self,
        call_id: str,
        field_id: str,
        value: str,
        validated: bool,
        attempts: int,
    ) -> None:
        """
        Publish a field-update event when a field value changes.

        Args:
            call_id: Unique identifier for the call/session
            field_id: The field that was updated
            value: The new value
            validated: Whether the value passed validation
            attempts: Number of attempts for this field
        """
        event = FormFieldEvent(
            call_id=call_id,
            event_type="field-update",
            timestamp=datetime.utcnow(),
            field_id=field_id,
            value=value,
            validated=validated,
            attempts=attempts,
        )
        await self._broadcast(call_id, event)

    async def publish_status(
        self,
        call_id: str,
        confirmed: bool = False,
        completed: bool = False,
    ) -> None:
        """
        Publish a form status event (confirmed or completed).

        Args:
            call_id: Unique identifier for the call/session
            confirmed: Whether data was confirmed
            completed: Whether form was submitted
        """
        event_type = "form-completed" if completed else "form-confirmed"
        event = FormFieldEvent(
            call_id=call_id,
            event_type=event_type,
            timestamp=datetime.utcnow(),
            confirmed=confirmed,
            completed=completed,
        )
        await self._broadcast(call_id, event)

    async def _broadcast(self, call_id: str, event: FormFieldEvent) -> None:
        """Broadcast an event to all subscribers of this call."""
        # Buffer the event for replay to future subscribers
        if event.event_type == "form-init":
            self._init_state[call_id] = event
            # Reset field cache when a fresh init arrives
            self._field_state.pop(call_id, None)
            self._status_state.pop(call_id, None)
        elif event.event_type == "field-update" and event.field_id is not None:
            self._field_state[call_id][event.field_id] = event
        elif event.event_type in ("form-confirmed", "form-completed"):
            self._status_state[call_id] = event

        subscribers = self._subscribers.get(call_id, [])
        if subscribers:
            logger.debug(
                "Broadcasting form event to %d subscribers: call_id=%s event_type=%s",
                len(subscribers),
                call_id,
                event.event_type,
            )
            for queue in subscribers:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    logger.warning(
                        "Subscriber queue full, dropping form event for call_id=%s",
                        call_id,
                    )

    async def subscribe(self, call_id: str) -> AsyncIterator[FormFieldEvent]:
        """
        Subscribe to form state events for a call.

        Yields FormFieldEvent objects as they arrive.
        Automatically unsubscribes on generator exit.

        Args:
            call_id: The call to subscribe to

        Yields:
            FormFieldEvent objects
        """
        queue: asyncio.Queue[FormFieldEvent] = asyncio.Queue(maxsize=100)
        self._subscribers[call_id].append(queue)
        logger.info(
            "New form subscriber for call_id=%s (total: %d)",
            call_id,
            len(self._subscribers[call_id]),
        )

        try:
            # Replay buffered state first so late subscribers receive current form snapshot
            init = self._init_state.get(call_id)
            if init is not None:
                yield init
            for field_event in list(self._field_state.get(call_id, {}).values()):
                yield field_event
            status = self._status_state.get(call_id)
            if status is not None:
                yield status
            # Live loop
            while True:
                event = await queue.get()
                yield event
        except asyncio.CancelledError:
            logger.debug("Form subscriber cancelled for call_id=%s", call_id)
            raise
        finally:
            # Clean up subscription
            try:
                self._subscribers[call_id].remove(queue)
                logger.info(
                    "Form subscriber removed for call_id=%s (remaining: %d)",
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
        self._active_calls.discard(call_id)
        self._init_state.pop(call_id, None)
        self._field_state.pop(call_id, None)
        self._status_state.pop(call_id, None)
        logger.info("Cleaned up form state for call_id=%s", call_id)

    def get_subscriber_count(self, call_id: str) -> int:
        """Get the number of active subscribers for a call."""
        return len(self._subscribers.get(call_id, []))

    def get_active_calls(self) -> set[str]:
        """Get set of call_ids with active sessions."""
        return self._active_calls.copy()
