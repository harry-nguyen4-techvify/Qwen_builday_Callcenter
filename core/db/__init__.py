"""Database module for call center."""
from core.db.base import (
    AsyncSessionLocal,
    Base,
    SessionLocal,
    async_engine,
    drop_all_tables,
    engine,
    get_db,
    get_db_async,
    init_db,
    init_db_async,
)
from core.db.models import (
    Agent,
    Call,
    CallEvent,
    ConversationHistory,
    ConversationTurn,
    Customer,
    Queue,
    Session,
)

__all__ = [
    # Base
    "Base",
    "engine",
    "async_engine",
    "SessionLocal",
    "AsyncSessionLocal",
    "init_db",
    "init_db_async",
    "get_db",
    "get_db_async",
    "drop_all_tables",
    # Models
    "Agent",
    "Call",
    "CallEvent",
    "ConversationHistory",
    "ConversationTurn",
    "Customer",
    "Queue",
    "Session",
]
