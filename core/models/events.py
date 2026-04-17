"""
Event models for real-time transcript streaming.

Used by TranscriptBroadcaster to publish events from the agent process
and by the SSE endpoint to stream them to the frontend.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class TranscriptEvent(BaseModel):
    """A single transcript event from the voice agent."""

    call_id: str
    role: Literal["agent", "customer", "system"]
    text: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    is_final: bool
    turn_index: int
    translation: str | None = None
    is_translated: bool = False


class TranscriptEventSSE(BaseModel):
    """SSE-formatted event wrapper."""

    event: str = "transcript"
    data: TranscriptEvent


class FormFieldEvent(BaseModel):
    """A form state event from the voice agent."""

    call_id: str
    event_type: Literal["form-init", "field-update", "form-confirmed", "form-completed"]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    fields: list[dict] | None = None  # For form-init: list of {id, label, field_type}
    field_id: str | None = None  # For field-update
    value: str | None = None
    validated: bool = False
    attempts: int = 0
    confirmed: bool = False
    completed: bool = False


class FormFieldEventSSE(BaseModel):
    """SSE-formatted form event wrapper."""

    event: str = "form"
    data: FormFieldEvent
