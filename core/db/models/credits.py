"""Credit card records for report_lost_card flow verification.

Stores customer credit cards for lookup during lost-card escalation.
Lookup requires 3-way match: CCCD + full_name (normalized) + card_last4.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import Index, String, Text, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base, TimestampMixin


# Card status constants
STATUS_ACTIVE = "active"
STATUS_LOCKED = "locked"
STATUS_EXPIRED = "expired"


def normalize_name(name: str) -> str:
    """Lowercase + collapse whitespace. Preserve diacritics."""
    return " ".join(name.lower().strip().split())


class Credit(Base, TimestampMixin):
    """Credit card record for customer verification + locking."""
    __tablename__ = "credits"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # Identification
    cccd: Mapped[str] = mapped_column(String(20))
    full_name: Mapped[str] = mapped_column(String(200))
    card_last4: Mapped[str] = mapped_column(String(4))

    # Status: active, locked, expired
    status: Mapped[str] = mapped_column(String(20), default=STATUS_ACTIVE)
    locked_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    locked_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_credits_cccd", "cccd"),
        Index("ix_credits_cccd_last4", "cccd", "card_last4"),
    )

    def __repr__(self) -> str:
        return f"<Credit {self.cccd}/{self.card_last4} status={self.status}>"


async def find_credit(
    session: AsyncSession,
    cccd: str,
    full_name: str,
    card_last4: str,
    active_only: bool = True,
) -> Optional[Credit]:
    """Find a credit record matching all three inputs.

    Matching rules:
    - cccd: stripped, exact match
    - full_name: normalized (lowercase, collapsed whitespace) — diacritics preserved
    - card_last4: exact match
    - status: defaults to STATUS_ACTIVE only (prevents locked/expired cards
      from being treated as a valid identity confirmation).

    Returns the matching Credit or None.
    """
    cccd_q = cccd.strip()
    last4_q = card_last4.strip()
    name_q = normalize_name(full_name)

    query = select(Credit).where(
        Credit.cccd == cccd_q,
        Credit.card_last4 == last4_q,
    )
    if active_only:
        query = query.where(Credit.status == STATUS_ACTIVE)
    result = await session.execute(query)
    # Filter by name in Python to use normalize_name (avoid DB-specific LOWER+REPLACE)
    for row in result.scalars().all():
        if normalize_name(row.full_name) == name_q:
            return row
    return None


async def lock_credit(
    session: AsyncSession,
    credit_id: UUID,
    reason: str,
) -> None:
    """Mark a credit as locked with reason + timestamp. Commits."""
    await session.execute(
        update(Credit)
        .where(Credit.id == credit_id)
        .values(
            status=STATUS_LOCKED,
            locked_at=datetime.now(timezone.utc),
            locked_reason=reason,
        )
    )
    await session.commit()
