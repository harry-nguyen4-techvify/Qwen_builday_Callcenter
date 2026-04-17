"""Idempotent seed for `credits` table — 3 mock records for testing."""
from __future__ import annotations

import logging

from sqlalchemy import select

from core.db.base import AsyncSessionLocal
from core.db.models.credits import Credit, STATUS_ACTIVE

logger = logging.getLogger(__name__)

_SEED_RECORDS: list[dict] = [
    {
        "cccd": "070809112233",
        "full_name": "Nguyen Van A",
        "card_last4": "1234",
    },
    {
        "cccd": "070809112244",
        "full_name": "Tran Thi B",
        "card_last4": "5678",
    },
    {
        "cccd": "070809112255",
        "full_name": "Le Van C",
        "card_last4": "9012",
    },
]


async def seed_mock_credits() -> int:
    """Insert mock credit records if they don't already exist. Returns inserted count."""
    inserted = 0
    async with AsyncSessionLocal() as session:
        for record in _SEED_RECORDS:
            existing = await session.execute(
                select(Credit).where(
                    Credit.cccd == record["cccd"],
                    Credit.card_last4 == record["card_last4"],
                )
            )
            if existing.scalar_one_or_none() is not None:
                continue
            session.add(Credit(
                cccd=record["cccd"],
                full_name=record["full_name"],
                card_last4=record["card_last4"],
                status=STATUS_ACTIVE,
            ))
            inserted += 1
        if inserted:
            await session.commit()
    logger.info("Seeded %d credit records (skipped existing)", inserted)
    return inserted
