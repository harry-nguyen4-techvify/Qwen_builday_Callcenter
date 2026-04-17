from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from core.models.form_data import FormData


@dataclass
class FieldState:
    """State of a single form field."""
    value: str | None = None
    validated: bool = False
    attempts: int = 0


@dataclass
class FormStep:
    """Single source of truth for form progress, updated only by agent tools."""
    flow_id: str = ""
    session_id: str = ""
    fields: dict[str, FieldState] = field(default_factory=dict)
    confirmed: bool = False
    completed: bool = False
    escalated: bool = False
    # Scenario-specific state
    computed_fields: dict[str, Any] = field(default_factory=dict)
    verification_attempts: int = 0
    escalation_requested: bool = False

    @property
    def collected_fields(self) -> dict[str, str]:
        """Dict of field_id -> value for all validated fields with a value."""
        return {
            fid: fs.value
            for fid, fs in self.fields.items()
            if fs.validated and fs.value is not None
        }

    @property
    def missing_fields(self) -> list[str]:
        """List of field IDs that are not yet validated with a value."""
        return [
            fid for fid, fs in self.fields.items()
            if not fs.validated or fs.value is None
        ]

    @property
    def all_collected(self) -> bool:
        """True when every field has a validated value."""
        return all(
            fs.validated and fs.value is not None
            for fs in self.fields.values()
        )

    def to_form_data(self) -> FormData:
        """Convert to the existing FormData model."""
        return FormData(
            values=self.collected_fields,
            retry_counts={fid: fs.attempts for fid, fs in self.fields.items()},
            flow_id=self.flow_id,
            session_id=self.session_id,
            completed=self.completed,
            escalation_requested=self.escalated,
        )
