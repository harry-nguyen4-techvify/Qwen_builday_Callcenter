"""
Prompt-driven form-filling agent.

Replaces GraphExecutor + FormFillingAgent with a single Agent that uses
function_tools to enforce business rules while the LLM handles conversation
flow naturally via its system prompt.
"""
from __future__ import annotations

import asyncio
import logging
import os

import aiohttp
from livekit.agents import Agent, function_tool

from core.compiler.models import CompiledFlowSpec, FieldSpec
from core.escalation import escalate_to_human
from core.excel.filler import ExcelFiller
from core.models.form_step import FieldState, FormStep
from core.runtime.validation import ValidationEngine

logger = logging.getLogger(__name__)


HOLD_MUSIC_PATH = os.environ.get("HOLD_MUSIC_PATH", "assets/hold-music.mp3")
HUMAN_IDENTITY_PREFIX = "human-agent-"


def _worker_headers() -> dict[str, str]:
    """Return auth headers for worker → API posts if WORKER_API_TOKEN is set."""
    token = os.environ.get("WORKER_API_TOKEN")
    return {"X-Worker-Token": token} if token else {}


def _mask_cccd(value: str | None) -> str:
    if not value:
        return "(none)"
    return f"****{value[-4:]}" if len(value) >= 4 else "****"


def _mask_last4(value: str | None) -> str:
    if not value:
        return "****"
    return f"****{value[-4:]}"


# Field ids whose values contain PII and must be masked in logs.
_PII_FIELD_IDS = {"cccd", "full_name", "card_last4"}


def _mask_for_log(field_id: str, value: str | None) -> str:
    """Return a safe-to-log representation of a possibly-PII value."""
    if value is None:
        return "(none)"
    if field_id == "cccd":
        return _mask_cccd(value)
    if field_id == "card_last4":
        return _mask_last4(value)
    if field_id == "full_name":
        return f"<name len={len(value)}>"
    if field_id in _PII_FIELD_IDS:
        return "<redacted>"
    return value


class PromptFormAgent(Agent):
    """
    Prompt-driven form-filling agent.

    Instead of a graph executor, the LLM follows its compiled system prompt
    to collect fields, validate via tools, and submit when ready.
    Tools enforce business rules the LLM cannot bypass.
    """

    def __init__(self, spec: CompiledFlowSpec) -> None:
        self._spec = spec
        self._step = FormStep(
            flow_id=spec.flow_id,
            fields={f.id: FieldState() for f in spec.fields},
        )
        self._field_map: dict[str, FieldSpec] = {f.id: f for f in spec.fields}
        self._validator = ValidationEngine()
        # Hold-music state (populated on escalate)
        self._hold_player = None  # BackgroundAudioPlayer | None
        self._hold_handle = None
        self._hold_listener_registered = False

        # Append plaintext rule as a hard guardrail — even if compiled prompt misses it
        prompt = spec.system_prompt + (
            "\n\nIMPORTANT: You are a VOICE agent. Output PLAIN TEXT ONLY for natural speech. "
            "NEVER use ANY special characters or formatting symbols. Forbidden characters: "
            "/ () * : # - ** bullet points, numbered lists. "
            "TTS reads these symbols literally and it sounds unnatural. "
            "Instead of 'Họ tên: Nguyễn Văn A' say 'Họ tên là Nguyễn Văn A'. "
            "Instead of '15/09/1990' say '15 tháng 9 năm 1990'. "
            "Instead of 'CCCD: 070809112233' say 'Số căn cước công dân là 070809112233'. "
            "Replace ALL colons with 'là', ALL slashes in dates with 'tháng' and 'năm', "
            "and remove ALL parentheses, asterisks, and other punctuation symbols."
            "\n\nMANDATORY TOOL CALL RULE: "
            "Every time the user provides information for a field, IMMEDIATELY call fill_field(field_id, value). "
            "Do NOT say anything before calling the tool — call it directly without acknowledgment. "
            "NEVER skip the tool call — the data is LOST if you don't call fill_field. "
            "After the tool returns, proceed to ask for the next field or confirm the data as instructed."
            "\n\nBOOLEAN FIELDS RULE: "
            "For yes/no or permission fields (like 'permission_granted'), when user agrees (says 'đồng ý', 'ok', 'ừ', 'vâng', etc.), "
            "you MUST call fill_field(field_id, 'true'). When user refuses, call fill_field(field_id, 'false'). "
            "These are DATA FIELDS, not just conversation gates — the value must be recorded."
        )
        super().__init__(instructions=prompt)

    async def on_enter(self) -> None:
        """Kick off the conversation. LLM will greet based on instructions."""
        self._step.session_id = self.session.userdata.session_id
        logger.info("PromptFormAgent.on_enter: session_id=%s", self._step.session_id)
        # Store step reference in session.userdata for external access
        self.session.userdata.step = self._step
        # Broadcast initial form state via HTTP POST to API
        await self._broadcast_form_init()
        await self.session.generate_reply(
            instructions="Greet the user and begin collecting information as instructed."
        )

    # ------------------------------------------------------------------
    # Broadcast helpers -- POST events to API for SSE broadcasting
    # ------------------------------------------------------------------

    async def _broadcast_form_init(self) -> None:
        """POST form-init event to API for SSE broadcasting."""
        api_url = os.environ.get("API_URL", "http://localhost:8000")
        url = f"{api_url}/api/calls/{self._step.session_id}/form"
        payload = {
            "event_type": "form-init",
            "fields": [
                {"id": f.id, "label": f.label, "field_type": f.field_type.value}
                for f in self._spec.fields
            ],
        }
        logger.info("Broadcasting form-init to %s with %d fields", url, len(payload["fields"]))
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.post(url, json=payload)
                logger.info("form-init broadcast response: %s", resp.status)
        except Exception as e:
            logger.error("Failed to broadcast form-init: %s", e)

    async def _broadcast_field_update(self, field_id: str, field_state) -> None:
        """POST field-update event to API."""
        api_url = os.environ.get("API_URL", "http://localhost:8000")
        url = f"{api_url}/api/calls/{self._step.session_id}/form"
        payload = {
            "event_type": "field-update",
            "field_id": field_id,
            "value": field_state.value,
            "validated": field_state.validated,
            "attempts": field_state.attempts,
        }
        logger.info(
            "Broadcasting field-update: %s = %s to %s",
            field_id, _mask_for_log(field_id, field_state.value), url,
        )
        try:
            async with aiohttp.ClientSession() as session:
                resp = await session.post(url, json=payload)
                logger.info("field-update broadcast response: %s", resp.status)
        except Exception as e:
            logger.error("Failed to broadcast field-update: %s", e)

    async def _broadcast_escalation(
        self, event_type: str, reason: str = ""
    ) -> None:
        """POST escalation state changes to API.

        event_type: 'escalation-requested' | 'escalation-cleared'
        """
        api_url = os.environ.get("API_URL", "http://localhost:8000")
        url = f"{api_url}/api/calls/{self._step.session_id}/escalation"
        payload = {"event_type": event_type, "reason": reason}
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(url, json=payload, headers=_worker_headers())
        except Exception as e:
            logger.warning("Failed to broadcast escalation (%s): %s", event_type, e)

    async def _broadcast_card_locked(self, cccd: str) -> None:
        """POST card-locked event to API."""
        api_url = os.environ.get("API_URL", "http://localhost:8000")
        url = f"{api_url}/api/calls/{self._step.session_id}/card-locked"
        payload = {"cccd_masked": _mask_cccd(cccd)}
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(url, json=payload, headers=_worker_headers())
        except Exception as e:
            logger.warning("Failed to broadcast card-locked: %s", e)

    async def _broadcast_computed_field(
        self, field_id: str, display_value: str, validated: bool
    ) -> None:
        """POST a pseudo field-update for a computed field (e.g. is_true_credential)."""
        api_url = os.environ.get("API_URL", "http://localhost:8000")
        url = f"{api_url}/api/calls/{self._step.session_id}/form"
        payload = {
            "event_type": "field-update",
            "field_id": field_id,
            "value": display_value,
            "validated": validated,
            "attempts": 0,
        }
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(url, json=payload, headers=_worker_headers())
        except Exception as e:
            logger.warning("Failed to broadcast computed field %s: %s", field_id, e)

    async def _broadcast_status(
        self, confirmed: bool = False, completed: bool = False
    ) -> None:
        """POST form status event to API."""
        api_url = os.environ.get("API_URL", "http://localhost:8000")
        event_type = "form-completed" if completed else "form-confirmed"
        payload = {
            "event_type": event_type,
            "confirmed": confirmed,
            "completed": completed,
        }
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(
                    f"{api_url}/api/calls/{self._step.session_id}/form",
                    json=payload,
                )
        except Exception as e:
            logger.warning("Failed to broadcast form status: %s", e)

    # ------------------------------------------------------------------
    # Tools -- these are the ONLY way the LLM can modify FormStep
    # ------------------------------------------------------------------

    @function_tool
    async def fill_field(self, field_id: str, value: str) -> str:
        """Record a field value after the user provides their answer. Call this every time the user answers a question.

        Args:
            field_id: The field identifier (e.g. "full_name", "date_of_birth")
            value: The user's answer
        """
        logger.info(
            "fill_field called: field_id=%s value=%s",
            field_id, _mask_for_log(field_id, value),
        )
        # Guard: valid field_id?
        field_spec = self._field_map.get(field_id)
        if field_spec is None:
            valid = list(self._field_map.keys())
            return f"Unknown field '{field_id}'. Valid fields: {valid}"

        # Guard: already completed?
        if self._step.completed:
            return "Form already submitted. No more changes allowed."

        # Validate
        result = self._validator.validate(
            field_spec.field_type,
            value,
            field_spec.constraints,
        )

        field_state = self._step.fields[field_id]
        field_state.attempts += 1

        if not result.ok:
            if field_state.attempts >= field_spec.retry_limit:
                return (
                    f"Validation failed: {result.error_msg} "
                    f"(attempt {field_state.attempts}/{field_spec.retry_limit}). "
                    f"Consider asking if user wants to escalate to human support."
                )
            return (
                f"Validation failed: {result.error_msg} "
                f"Please ask the user to provide the correct value."
            )

        # Store validated value
        field_state.value = value
        field_state.validated = True

        # Reset confirmed flag when any field changes
        self._step.confirmed = False

        # Broadcast field update to SSE subscribers
        await self._broadcast_field_update(field_id, field_state)

        # Report progress
        missing = self._step.missing_fields
        if missing:
            return (
                f"Recorded {field_id} = '{value}'. "
                f"Remaining fields: {missing}. "
                f"Continue collecting the next field."
            )
        return (
            f"Recorded {field_id} = '{value}'. "
            f"All fields collected! "
            f"Please summarize the data and ask the user to confirm."
        )

    @function_tool
    async def confirm_data(self) -> str:
        """Mark the collected data as confirmed by the user. Call ONLY after presenting a summary and the user explicitly agrees."""
        if not self._step.all_collected:
            missing = self._step.missing_fields
            return f"Cannot confirm -- missing fields: {missing}"

        self._step.confirmed = True

        # Broadcast confirmation status to SSE subscribers
        await self._broadcast_status(confirmed=True)

        summary = ", ".join(
            f"{fid}: {fs.value}"
            for fid, fs in self._step.fields.items()
            if fs.validated
        )
        return f"Data confirmed. Summary: {summary}. You may now call submit_form."

    @function_tool
    async def submit_form(self) -> str:
        """Submit the completed form. Fills the Excel template and marks done. Call ONLY after confirm_data."""
        # Guard: all collected?
        if not self._step.all_collected:
            missing = self._step.missing_fields
            return f"Cannot submit -- missing fields: {missing}"

        # Guard: confirmed?
        if not self._step.confirmed:
            return (
                "Cannot submit -- data not confirmed. "
                "Please summarize the data for the user and call confirm_data first."
            )

        # Guard: not already submitted?
        if self._step.completed:
            return "Form already submitted."

        # Fill Excel (skip if no template configured)
        form_data = self._step.to_form_data()
        template = self._spec.excel_template

        if template:
            output = self._spec.excel_output.replace(
                "{session_id}", self._step.session_id
            )
            try:
                ExcelFiller().fill(
                    template, form_data, self._spec.cell_mapping, output
                )
                logger.info("Form submitted (excel): %s", output)
            except Exception as exc:
                logger.error("submit_form failed: %s", exc)
                return (
                    f"Submission failed: {exc}. "
                    f"Inform the user and ask if they want to try again or escalate."
                )

        self._step.completed = True
        form_data.completed = True

        # Broadcast completion status to SSE subscribers
        await self._broadcast_status(completed=True)

        logger.info("Form completed: flow_id=%s", self._step.flow_id)
        return (
            "Form submitted successfully! "
            "Thank the user and say goodbye."
        )

    @function_tool
    async def check_credential(
        self, cccd: str, full_name: str, card_last4: str
    ) -> str:
        """Verify the caller's credentials against the credits DB for the report_lost_card scenario.

        Call this AFTER collecting all three fields via fill_field. Returns whether
        the credential matched; if true, call lock_card next. If false, re-collect
        all three fields once; if still false after 2 attempts, call escalate.

        Args:
            cccd: 12-digit CCCD provided by the user
            full_name: Full name provided by the user
            card_last4: 4-digit card suffix provided by the user
        """
        from core.db.base import AsyncSessionLocal
        from core.db.models.credits import find_credit

        self._step.verification_attempts += 1
        attempt_no = self._step.verification_attempts

        try:
            async with AsyncSessionLocal() as session:
                credit = await find_credit(session, cccd, full_name, card_last4)
        except Exception:
            # N3: Do NOT leak raw exception text to the LLM (could voice DB schema).
            logger.exception("check_credential DB error")
            return (
                "Credential check failed due to an internal error. "
                "Apologize to the user and call escalate."
            )

        matched = credit is not None
        self._step.computed_fields["is_true_credential"] = matched
        if matched:
            self._step.computed_fields["credit_id"] = str(credit.id)

        logger.info(
            "check_credential attempt=%d cccd=%s last4=%s -> %s",
            attempt_no, _mask_cccd(cccd), _mask_last4(card_last4), matched,
        )

        # Broadcast pseudo field-update so frontend right panel shows result
        await self._broadcast_computed_field(
            field_id="is_true_credential",
            display_value="✅ Khớp" if matched else "❌ Không khớp",
            validated=matched,
        )

        if matched:
            return (
                f"Credential verified (attempt {attempt_no}). is_true_credential=true. "
                f"Tell the user you have verified their identity, then immediately call "
                f"lock_card with cccd='{cccd}'."
            )

        # Failure path — reset fields so user re-reads them, then LLM collects again
        for fid in ("cccd", "full_name", "card_last4"):
            if fid in self._step.fields:
                self._step.fields[fid] = FieldState()

        if attempt_no >= 2:
            return (
                f"Credential mismatch on attempt {attempt_no}. is_true_credential=false. "
                f"Verification has now failed twice. Apologize to the user, say you will "
                f"hand the call over to a human agent, then call escalate with "
                f"reason='credential verification failed twice'."
            )

        return (
            f"Credential mismatch on attempt {attempt_no}. is_true_credential=false. "
            f"Apologize, say you will re-verify, then ask the user to read CCCD, full name, "
            f"and last 4 digits again. Call fill_field for each one, then call check_credential again."
        )

    @function_tool
    async def lock_card(self, cccd: str) -> str:
        """Lock the credit card identified by CCCD. Only callable AFTER check_credential returned is_true_credential=true.

        Args:
            cccd: CCCD of the verified cardholder
        """
        from uuid import UUID
        from core.db.base import AsyncSessionLocal
        from core.db.models.credits import lock_credit

        if not self._step.computed_fields.get("is_true_credential"):
            return (
                "Refused: credential has not been verified. "
                "Call check_credential first."
            )

        if self._step.completed:
            return "Card already locked for this call."

        # H2: use the credit_id stashed when check_credential succeeded, instead
        # of re-looking up from (possibly cleared) collected_fields.
        credit_id_raw = self._step.computed_fields.get("credit_id")
        if not credit_id_raw:
            return (
                "Refused: missing verified credit id. "
                "Call check_credential first."
            )
        try:
            credit_id = UUID(credit_id_raw)
        except (TypeError, ValueError):
            return "Refused: stored credit id is invalid. Call check_credential first."

        try:
            async with AsyncSessionLocal() as session:
                await lock_credit(
                    session,
                    credit_id=credit_id,
                    reason="Customer reported lost card via voice agent",
                )
        except Exception:
            # N3: Do NOT leak exception text to the LLM.
            logger.exception("lock_card DB error")
            return (
                "Card lock failed due to an internal error. "
                "Apologize and call escalate."
            )

        self._step.completed = True
        await self._broadcast_card_locked(cccd)
        await self._broadcast_status(completed=True)

        logger.info("Card locked for cccd=%s", _mask_cccd(cccd))
        return (
            "Card successfully locked. Confirm to the user that the card is now blocked "
            "and no further transactions will be authorized, thank them, and say goodbye."
        )

    @function_tool
    async def escalate(self, reason: str = "") -> str:
        """Transfer to a human agent. Call when user requests human help or validation fails too many times.

        Args:
            reason: Why the escalation is needed
        """
        if self._step.escalation_requested:
            return "Escalation already in progress. Ask the user to please hold."

        self._step.escalated = True
        self._step.escalation_requested = True
        form_data = self._step.to_form_data()

        await escalate_to_human(
            flow_id=self._step.flow_id,
            session_id=self._step.session_id,
            reason=reason or "User requested human support",
            form_data=form_data,
        )
        await self._broadcast_escalation(
            "escalation-requested",
            reason=reason or "User requested human support",
        )

        # Kick off hold music asynchronously — must not block tool return
        asyncio.create_task(self._start_hold_music())

        return (
            "Escalation initiated. Tell the user a human agent will be with them shortly "
            "and they should please hold while music plays."
        )

    # ------------------------------------------------------------------
    # Hold music helpers
    # ------------------------------------------------------------------

    async def _start_hold_music(self) -> None:
        """Publish looping MP3 hold music into the room and stop on human join.

        Race-safe against _stop_hold_music: we register the participant_connected
        listener BEFORE playing the track, and we check whether a human is
        already in the room (or whether escalation was already cleared) before
        actually starting playback.
        """
        if self._hold_handle is not None:
            return  # Already playing

        if not os.path.exists(HOLD_MUSIC_PATH):
            logger.warning(
                "HOLD_MUSIC_PATH '%s' does not exist; skipping hold music", HOLD_MUSIC_PATH
            )
            return

        room = getattr(self.session.userdata, "room", None)
        if room is None:
            logger.warning("No room reference in session.userdata; skipping hold music")
            return

        # Register participant_connected listener FIRST, so a human who joins
        # between player.start() and play() is not missed (C2).
        if not self._hold_listener_registered:
            self._hold_listener_registered = True

            def _on_participant_connected(participant) -> None:
                identity = getattr(participant, "identity", "") or ""
                if not identity.startswith(HUMAN_IDENTITY_PREFIX):
                    return
                logger.info("Human operator joined (%s) — stopping hold music", identity)
                asyncio.create_task(self._stop_hold_music("human operator joined"))

            room.on("participant_connected", _on_participant_connected)

        # If a human operator is already in the room, do not start music at all.
        remote_participants = getattr(room, "remote_participants", {}) or {}
        for identity in remote_participants:
            if str(identity).startswith(HUMAN_IDENTITY_PREFIX):
                logger.info(
                    "Human operator '%s' already present — skipping hold music start",
                    identity,
                )
                self._step.escalation_requested = False
                await self._broadcast_escalation(
                    "escalation-cleared",
                    reason="human operator already present",
                )
                return

        # If escalation was cleared between create_task and now, abort.
        if not self._step.escalation_requested:
            logger.info("Escalation cleared before hold music start — aborting")
            return

        try:
            from livekit.agents import BackgroundAudioPlayer

            self._hold_player = BackgroundAudioPlayer()
            await self._hold_player.start(room=room, agent_session=self.session)
            self._hold_handle = self._hold_player.play(HOLD_MUSIC_PATH, loop=True)
            logger.info("Hold music started: %s", HOLD_MUSIC_PATH)
        except Exception:
            logger.exception("Failed to start hold music")
            return

        # If escalation got cleared by the listener while we were starting
        # playback, tear down immediately so music doesn't play forever.
        if not self._step.escalation_requested:
            logger.info("Escalation cleared during hold music start — tearing down")
            await self._stop_hold_music("escalation cleared during start")

    async def _stop_hold_music(self, reason: str) -> None:
        """Stop hold music and broadcast escalation-cleared."""
        try:
            if self._hold_handle is not None:
                self._hold_handle.stop()
                self._hold_handle = None
            if self._hold_player is not None:
                try:
                    await self._hold_player.aclose()
                except Exception:
                    pass
                self._hold_player = None
        except Exception:
            logger.exception("Failed while stopping hold music")

        # H1: Reset listener flag so a subsequent escalate re-registers.
        self._hold_listener_registered = False
        self._step.escalation_requested = False
        await self._broadcast_escalation("escalation-cleared", reason=reason)
