"""ConversationHistory and ConversationTurn models."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base

if TYPE_CHECKING:
    from core.db.models.call import Call


class ConversationHistory(Base):
    """Complete conversation record with analytics."""
    __tablename__ = "conversation_histories"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    call_id: Mapped[UUID] = mapped_column(
        ForeignKey("calls.id"), unique=True, index=True
    )
    session_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("sessions.id"), nullable=True
    )

    # === RAW TRANSCRIPT ===
    # [{role, text, timestamp, audio_segment?}]
    transcript: Mapped[list] = mapped_column(JSON, default=list)

    # === ANALYTICS ===
    # Overall sentiment: positive, neutral, negative, mixed
    overall_sentiment: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    sentiment_score: Mapped[Optional[float]] = mapped_column(nullable=True)  # -1.0 to 1.0

    # Conversation stats
    total_turns: Mapped[int] = mapped_column(default=0)
    agent_turns: Mapped[int] = mapped_column(default=0)
    customer_turns: Mapped[int] = mapped_column(default=0)
    total_words: Mapped[int] = mapped_column(default=0)
    duration_seconds: Mapped[Optional[int]] = mapped_column(nullable=True)

    # === INTENT ANALYSIS ===
    # [{intent, confidence, turn_index}]
    detected_intents: Mapped[list] = mapped_column(JSON, default=list)
    primary_intent: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # === ENTITY EXTRACTION ===
    # {entity_type: [{value, turn_index, confidence}]}
    extracted_entities: Mapped[dict] = mapped_column(JSON, default=dict)

    # === TOOL CALLS ===
    # [{tool_name, args, result, turn_index, timestamp}]
    tool_calls: Mapped[list] = mapped_column(JSON, default=list)

    # === TOPICS & KEYWORDS ===
    topics: Mapped[list] = mapped_column(JSON, default=list)
    keywords: Mapped[list] = mapped_column(JSON, default=list)

    # === QUALITY METRICS ===
    avg_response_time_ms: Mapped[Optional[int]] = mapped_column(nullable=True)
    interruptions_count: Mapped[int] = mapped_column(default=0)
    silence_duration_seconds: Mapped[Optional[int]] = mapped_column(nullable=True)

    # === SUMMARY ===
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    action_items: Mapped[list] = mapped_column(JSON, default=list)

    # === FLAGS ===
    has_escalation: Mapped[bool] = mapped_column(default=False)
    has_complaint: Mapped[bool] = mapped_column(default=False)
    requires_followup: Mapped[bool] = mapped_column(default=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(default=func.now())
    analyzed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Relationships
    call: Mapped["Call"] = relationship("Call", back_populates="conversation")
    turns: Mapped[List["ConversationTurn"]] = relationship(
        "ConversationTurn",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ConversationTurn.turn_index",
    )

    def __repr__(self) -> str:
        return f"<ConversationHistory {self.id}: {self.total_turns} turns>"

    def add_turn(
        self,
        role: str,
        text: str,
        timestamp: datetime,
        **kwargs,
    ) -> "ConversationTurn":
        """Add a new turn to the conversation."""
        turn = ConversationTurn(
            conversation_id=self.id,
            turn_index=len(self.turns),
            role=role,
            text=text,
            timestamp=timestamp,
            **kwargs,
        )
        self.turns.append(turn)
        self.total_turns += 1
        if role == "agent":
            self.agent_turns += 1
        elif role == "customer":
            self.customer_turns += 1
        return turn


class ConversationTurn(Base):
    """Individual turn in conversation with detailed analysis."""
    __tablename__ = "conversation_turns"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("conversation_histories.id"), index=True
    )

    # Turn info
    turn_index: Mapped[int]
    role: Mapped[str] = mapped_column(String(20))  # agent, customer, system

    # Content
    text: Mapped[str] = mapped_column(Text)
    audio_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Timing
    timestamp: Mapped[datetime]
    duration_ms: Mapped[Optional[int]] = mapped_column(nullable=True)
    response_latency_ms: Mapped[Optional[int]] = mapped_column(nullable=True)

    # === PER-TURN ANALYSIS ===
    intent: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    intent_confidence: Mapped[Optional[float]] = mapped_column(nullable=True)

    sentiment: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    sentiment_score: Mapped[Optional[float]] = mapped_column(nullable=True)

    # Entities extracted from this turn: {"phone": "0901234567", "name": "..."}
    entities: Mapped[dict] = mapped_column(JSON, default=dict)

    # Tool call made (if agent turn): {"tool": "fill_field", "args": {...}, "result": "..."}
    tool_call: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Flags
    is_question: Mapped[bool] = mapped_column(default=False)
    is_confirmation: Mapped[bool] = mapped_column(default=False)
    is_correction: Mapped[bool] = mapped_column(default=False)
    has_error: Mapped[bool] = mapped_column(default=False)

    # Translation (added Phase 04)
    translation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    translation_source: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    translation_target: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    is_translated: Mapped[bool] = mapped_column(default=False)

    # Raw ASR data
    asr_confidence: Mapped[Optional[float]] = mapped_column(nullable=True)
    asr_alternatives: Mapped[list] = mapped_column(JSON, default=list)

    # Relationships
    conversation: Mapped["ConversationHistory"] = relationship(
        "ConversationHistory", back_populates="turns"
    )

    __table_args__ = (
        UniqueConstraint("conversation_id", "turn_index", name="uq_conv_turn"),
        Index("ix_turns_conversation", "conversation_id", "turn_index"),
    )

    def __repr__(self) -> str:
        return f"<ConversationTurn {self.turn_index}: {self.role}>"
