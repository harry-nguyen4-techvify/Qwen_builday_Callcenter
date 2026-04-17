"""
Stub escalation handler — logs and prints only.
In production, replace with real CRM/ticket integration.
"""
import logging

from core.models.form_data import FormData

logger = logging.getLogger(__name__)


async def escalate_to_human(
    flow_id: str,
    session_id: str,
    reason: str,
    form_data: FormData,
) -> None:
    """Stub: log the escalation request and print to stdout."""
    msg = (
        f"[ESCALATION] flow_id={flow_id} session_id={session_id} "
        f"reason={reason!r} collected_fields={list(form_data.values.keys())}"
    )
    logger.warning(msg)
    print(f"[ESCALATION STUB] {msg}")
