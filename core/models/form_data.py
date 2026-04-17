from dataclasses import dataclass, field


@dataclass
class FormData:
    values: dict[str, str] = field(default_factory=dict)
    retry_counts: dict[str, int] = field(default_factory=dict)
    flow_id: str = ""
    session_id: str = ""
    completed: bool = False
    escalation_requested: bool = False

    def get(self, field_id: str, default: str = "") -> str:
        """Return the stored value for field_id, or default if absent."""
        return self.values.get(field_id, default)

    def set(self, field_id: str, value: str) -> None:
        """Store a value for field_id."""
        self.values[field_id] = value

    def increment_retry(self, field_id: str) -> int:
        """Increment the retry counter for field_id and return the new count."""
        self.retry_counts[field_id] = self.retry_counts.get(field_id, 0) + 1
        return self.retry_counts[field_id]
