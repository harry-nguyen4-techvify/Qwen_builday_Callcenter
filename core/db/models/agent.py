"""Agent model - Human call center agents."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base

if TYPE_CHECKING:
    from core.db.models.call import Call
    from core.db.models.queue import Queue


class Agent(Base):
    """Human call center agent for escalation handling."""
    __tablename__ = "agents"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    employee_id: Mapped[str] = mapped_column(String(50), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Status: online, offline, busy, break, after_call_work
    status: Mapped[str] = mapped_column(String(20), default="offline")

    # Skills & assignment
    skills: Mapped[list] = mapped_column(JSON, default=list)
    max_concurrent_calls: Mapped[int] = mapped_column(default=1)
    current_queue_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("queues.id"), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    last_active_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Relationships
    current_queue: Mapped[Optional["Queue"]] = relationship(
        "Queue", back_populates="agents"
    )
    calls: Mapped[List["Call"]] = relationship("Call", back_populates="agent")

    def __repr__(self) -> str:
        return f"<Agent {self.employee_id}: {self.name}>"
