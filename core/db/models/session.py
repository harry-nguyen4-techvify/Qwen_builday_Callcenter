"""Session model - Voice agent sessions."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Optional
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base

if TYPE_CHECKING:
    from core.db.models.call import Call


class Session(Base):
    """Voice agent session - form data stored locally."""
    __tablename__ = "sessions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    call_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("calls.id"), unique=True, nullable=True
    )
    flow_id: Mapped[str] = mapped_column(String(100), index=True)

    # Status: active, completed, escalated, failed, abandoned
    status: Mapped[str] = mapped_column(String(20), default="active")

    # Form state flags (actual data stored locally)
    confirmed: Mapped[bool] = mapped_column(default=False)
    completed: Mapped[bool] = mapped_column(default=False)
    escalated: Mapped[bool] = mapped_column(default=False)

    # Timestamps
    started_at: Mapped[datetime] = mapped_column(default=func.now())
    ended_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Metadata
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)

    # Relationships
    call: Mapped[Optional["Call"]] = relationship("Call", back_populates="session")

    def __repr__(self) -> str:
        return f"<Session {self.id}: flow={self.flow_id} status={self.status}>"

    @property
    def local_data_path(self) -> str:
        """Path to local form data file."""
        return f"data/sessions/{self.id}.json"
