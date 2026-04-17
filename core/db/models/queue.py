"""Queue model - Call routing queues."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base

if TYPE_CHECKING:
    from core.db.models.agent import Agent
    from core.db.models.call import Call


class Queue(Base):
    """Call routing queue."""
    __tablename__ = "queues"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Config
    priority: Mapped[int] = mapped_column(default=0)
    max_wait_time: Mapped[int] = mapped_column(default=300)  # seconds
    default_flow_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Routing strategy: round_robin, least_busy, skills_based, random
    routing_strategy: Mapped[str] = mapped_column(String(30), default="round_robin")

    # Status
    is_active: Mapped[bool] = mapped_column(default=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    # Relationships
    agents: Mapped[List["Agent"]] = relationship("Agent", back_populates="current_queue")
    calls: Mapped[List["Call"]] = relationship("Call", back_populates="queue")

    def __repr__(self) -> str:
        return f"<Queue {self.name}>"
