"""SQLAlchemy base configuration for call center database."""
from __future__ import annotations

from datetime import datetime
from typing import AsyncGenerator
from uuid import uuid4

from sqlalchemy import create_engine, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

# Default SQLite database URL
DATABASE_URL = "sqlite:///data/callcenter.db"
ASYNC_DATABASE_URL = "sqlite+aiosqlite:///data/callcenter.db"


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


class TimestampMixin:
    """Mixin for created_at and updated_at timestamps."""
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(onupdate=func.now())


# Sync engine and session (for simple operations)
engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


# Async engine and session (for async operations)
async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def init_db() -> None:
    """Create all tables in the database."""
    # Import all models to register them with Base
    from core.db.models import (  # noqa: F401
        Agent,
        Call,
        CallEvent,
        ConversationHistory,
        ConversationTurn,
        Credit,
        Customer,
        Queue,
        Session,
    )
    Base.metadata.create_all(bind=engine)


async def init_db_async() -> None:
    """Create all tables in the database (async)."""
    from core.db.models import (  # noqa: F401
        Agent,
        Call,
        CallEvent,
        ConversationHistory,
        ConversationTurn,
        Credit,
        Customer,
        Queue,
        Session,
    )
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def get_db():
    """Get a database session (sync)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_db_async() -> AsyncGenerator[AsyncSession, None]:
    """Get a database session (async)."""
    async with AsyncSessionLocal() as session:
        yield session


def drop_all_tables() -> None:
    """Drop all tables (for testing)."""
    Base.metadata.drop_all(bind=engine)
