"""Call and CallEvent models."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base

if TYPE_CHECKING:
    from core.db.models.agent import Agent
    from core.db.models.conversation import ConversationHistory
    from core.db.models.customer import Customer
    from core.db.models.queue import Queue
    from core.db.models.session import Session


class Call(Base):
    """Individual call record."""
    __tablename__ = "calls"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # References
    customer_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("customers.id"), nullable=True
    )
    agent_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("agents.id"), nullable=True
    )
    queue_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("queues.id"), nullable=True
    )

    # Call info
    direction: Mapped[str] = mapped_column(String(10))  # inbound, outbound
    caller_number: Mapped[str] = mapped_column(String(20), index=True)
    callee_number: Mapped[str] = mapped_column(String(20))

    # Status: queued, ringing, in_progress, on_hold, transferred, completed, failed, abandoned
    status: Mapped[str] = mapped_column(String(20), default="queued")
    # Disposition: completed, voicemail, no_answer, busy, escalated, form_filled
    disposition: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Timing
    queued_at: Mapped[datetime] = mapped_column(default=func.now())
    answered_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Duration (seconds)
    wait_duration: Mapped[Optional[int]] = mapped_column(nullable=True)
    talk_duration: Mapped[Optional[int]] = mapped_column(nullable=True)
    hold_duration: Mapped[Optional[int]] = mapped_column(nullable=True)

    # Voice agent
    flow_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    was_escalated: Mapped[bool] = mapped_column(default=False)
    escalation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # LiveKit session tracking
    livekit_room: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    simulator_user_identity: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Metadata
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)

    # Relationships
    customer: Mapped[Optional["Customer"]] = relationship(
        "Customer", back_populates="calls"
    )
    agent: Mapped[Optional["Agent"]] = relationship("Agent", back_populates="calls")
    queue: Mapped[Optional["Queue"]] = relationship("Queue", back_populates="calls")
    events: Mapped[List["CallEvent"]] = relationship(
        "CallEvent", back_populates="call", cascade="all, delete-orphan"
    )
    session: Mapped[Optional["Session"]] = relationship(
        "Session", back_populates="call", uselist=False
    )
    conversation: Mapped[Optional["ConversationHistory"]] = relationship(
        "ConversationHistory", back_populates="call", uselist=False
    )

    __table_args__ = (
        Index("ix_calls_status_queued", "status", "queued_at"),
    )

    def __repr__(self) -> str:
        return f"<Call {self.id}: {self.direction} {self.status}>"


class CallEvent(Base):
    """Timeline event for a call."""
    __tablename__ = "call_events"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    call_id: Mapped[UUID] = mapped_column(ForeignKey("calls.id"), index=True)

    # Event type: queued, answered, hold_start, hold_end, transfer, escalate,
    # field_collected, validation_failed, form_submitted, ended
    event_type: Mapped[str] = mapped_column(String(50))
    timestamp: Mapped[datetime] = mapped_column(default=func.now())
    data: Mapped[dict] = mapped_column(JSON, default=dict)

    # Relationships
    call: Mapped["Call"] = relationship("Call", back_populates="events")

    def __repr__(self) -> str:
        return f"<CallEvent {self.event_type} @ {self.timestamp}>"
