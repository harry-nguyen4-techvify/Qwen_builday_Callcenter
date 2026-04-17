"""
FastAPI backend for Flow Designer UI.

Start with:
    uvicorn api.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import sys
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Add project root to sys.path BEFORE any core imports
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from dotenv import load_dotenv

load_dotenv(dotenv_path=_PROJECT_ROOT / ".env")

from typing import Any
from contextlib import asynccontextmanager

import asyncio

from fastapi import FastAPI, HTTPException, UploadFile, File, Body, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import tempfile

from pydantic import BaseModel as PydanticBaseModel
from datetime import datetime as dt, timezone
from typing import Optional

from core.models.flow import FlowModel
from core.models.field_defs import FieldDefinition, FieldType, FieldConstraints
from core.store.flow_store import FlowStore
from core.designer.flow_designer import FlowDesigner, FlowDesignError
from core.compiler import FlowCompiler
from core.excel.parser import ExcelParser
from core.events.transcript_broadcaster import TranscriptBroadcaster
from core.events.form_broadcaster import FormStateBroadcaster
from core.translation import get_translator

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown events."""
    # Startup
    from core.db.base import init_db_async
    await init_db_async()
    logger.info("Database initialized")

    # Start transcript persister (background flush loop)
    from core.events.transcript_persister import get_persister
    persister = get_persister()
    await persister.start()
    logger.info("TranscriptPersister started")

    # Auto-seed credits on startup (always idempotent; toggle off via SEED_CREDITS=0)
    if os.environ.get("SEED_CREDITS", "1") != "0":
        from core.db.seed_credits import seed_mock_credits
        inserted = await seed_mock_credits()
        logger.info("Credits seed: %d new rows", inserted)
    yield
    # Shutdown
    await persister.stop()
    logger.info("TranscriptPersister stopped")


app = FastAPI(title="Flow Designer API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Singletons
_store = FlowStore(base_dir=_PROJECT_ROOT)
_parser = ExcelParser()


# ---------------------------------------------------------------------------
# Response models for Calls API
# ---------------------------------------------------------------------------


class CallSummary(PydanticBaseModel):
    """Summary of a call for list views."""
    id: str
    caller_number: str
    customer_name: Optional[str] = None
    status: str
    disposition: Optional[str] = None
    direction: Optional[str] = None
    flow_id: Optional[str] = None
    flow_name: Optional[str] = None
    queued_at: dt
    answered_at: Optional[dt] = None
    ended_at: Optional[dt] = None
    duration_seconds: Optional[int] = None
    escalation_requested: bool = False
    card_locked: bool = False
    livekit_room: Optional[str] = None


class CallListResponse(PydanticBaseModel):
    """Response for listing calls with pagination."""
    calls: list[CallSummary]
    total: int
    limit: int
    offset: int


class CallUpdateRequest(PydanticBaseModel):
    """Request to update a call's status/disposition."""
    status: Optional[str] = None
    disposition: Optional[str] = None
    ended_at: Optional[dt] = None


class CallEventResponse(PydanticBaseModel):
    """A call event in the timeline."""
    id: str
    event_type: str
    timestamp: dt
    data: dict


# ---------------------------------------------------------------------------
# Routes — flows CRUD
# ---------------------------------------------------------------------------


@app.get("/api/flows")
async def list_flows() -> list[str]:
    """Return list of all flow IDs."""
    return _store.list()


@app.get("/api/flows/{flow_id}")
async def get_flow(flow_id: str) -> dict[str, Any]:
    """Return full FlowModel as JSON dict."""
    try:
        flow = _store.load(flow_id)
        return flow.model_dump()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")


@app.put("/api/flows/{flow_id}")
async def save_flow(flow_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Save (overwrite) a FlowModel, then auto-compile to .compiled.json."""
    try:
        # Ensure flow_id matches URL
        body["flow_id"] = flow_id
        flow = FlowModel.model_validate(body)
        _store.save(flow)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Auto-compile after save
    compiled_ok = False
    compile_error = ""
    try:
        compiler = FlowCompiler()
        spec = await compiler.compile(flow)
        _store.save_compiled(spec)
        compiled_ok = True
        logger.info("Auto-compiled flow '%s'", flow_id)
    except Exception as exc:
        compile_error = str(exc)
        logger.warning("Auto-compile failed for '%s': %s", flow_id, exc)

    result = flow.model_dump()
    result["_compiled"] = compiled_ok
    if compile_error:
        result["_compile_error"] = compile_error
    return result


@app.delete("/api/flows/{flow_id}")
async def delete_flow(flow_id: str) -> dict[str, str]:
    """Delete a flow JSON file."""
    flow_file = _store.flows_dir / f"{flow_id}.json"
    if not flow_file.exists():
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    flow_file.unlink()
    return {"deleted": flow_id}


# ---------------------------------------------------------------------------
# Routes — design / refine
# ---------------------------------------------------------------------------


class DesignRequest:
    pass


@app.post("/api/design")
async def design_flow(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """
    Generate a new flow from field definitions and a prompt.

    Body:
        fields: list of {id, label, cell_ref, type}
        prompt: str
        raw_text: str  (optional)
    """
    fields_raw: list[dict] = body.get("fields", [])
    user_prompt: str = body.get("prompt", "Collect form data via voice agent in Vietnamese")
    raw_text: str = body.get("raw_text", "")

    field_defs: list[FieldDefinition] = []
    for f in fields_raw:
        fd = FieldDefinition(
            id=f.get("id", "field"),
            label=f.get("label", ""),
            cell_ref=f.get("cell_ref", ""),
            type=FieldType(f.get("type", "text")),
            constraints=FieldConstraints(),
        )
        field_defs.append(fd)

    try:
        designer = FlowDesigner()
        flow = await designer.design(field_defs=field_defs, user_prompt=user_prompt, template_raw=raw_text)
        _store.save(flow)
        return flow.model_dump()
    except FlowDesignError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "raw": exc.raw_response})
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/flows/{flow_id}/refine")
async def refine_flow(flow_id: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """
    Refine an existing flow given user feedback.

    Body:
        feedback: str
    """
    try:
        current_flow = _store.load(flow_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")

    feedback: str = body.get("feedback", "")
    if not feedback.strip():
        raise HTTPException(status_code=422, detail="feedback cannot be empty")

    try:
        designer = FlowDesigner()
        refined = await designer.refine(current_flow=current_flow, user_feedback=feedback)
        _store.save(refined)
        return refined.model_dump()
    except FlowDesignError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "raw": exc.raw_response})
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Routes — Excel parsing
# ---------------------------------------------------------------------------


@app.post("/api/excel/cells")
async def parse_excel_cells(file: UploadFile = File(...)) -> dict[str, Any]:
    """
    Accept a multipart .xlsx upload and return cell data grouped by sheet.

    Returns:
        { sheet_name: [{coord, row, col, value}, ...], ... }
    """
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=422, detail="Only .xlsx files are supported")

    contents = await file.read()

    # Write to a temp file for openpyxl
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        result = _parser.parse(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # Group cells by sheet
    by_sheet: dict[str, list[dict]] = {}
    for ci in result.cells:
        entry = {
            "coord": ci.coord,
            "row": ci.row,
            "col": ci.col,
            "value": str(ci.value) if ci.value is not None else None,
            "is_label": ci.is_label,
        }
        by_sheet.setdefault(ci.sheet, []).append(entry)

    return by_sheet


# ---------------------------------------------------------------------------
# Routes — Call CRUD API
# ---------------------------------------------------------------------------


@app.get("/api/calls")
async def list_calls(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> CallListResponse:
    """
    List calls with optional status filter and pagination.

    Query params:
        status: Filter by status (ongoing, completed, escalated, failed)
        limit: Max results (default 50, max 100)
        offset: Skip N results

    Returns:
        CallListResponse with calls array and pagination info
    """
    from sqlalchemy import select as sa_select, func as sa_func
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call

    limit = min(limit, 100)  # Cap at 100

    async with AsyncSessionLocal() as session:
        # Base query
        query = sa_select(Call).order_by(Call.queued_at.desc())
        count_query = sa_select(sa_func.count(Call.id))

        # Apply status filter
        if status:
            if status == "ongoing":
                query = query.where(Call.status == "in_progress")
                count_query = count_query.where(Call.status == "in_progress")
            elif status in ("completed", "escalated", "failed"):
                query = query.where(Call.status == status)
                count_query = count_query.where(Call.status == status)

        # Get total count
        total_result = await session.execute(count_query)
        total = total_result.scalar_one()

        # Apply pagination
        query = query.offset(offset).limit(limit)
        result = await session.execute(query)
        calls = result.scalars().all()

        # Map to response
        call_summaries = []
        for c in calls:
            # Calculate duration
            duration = None
            if c.answered_at and c.ended_at:
                duration = int((c.ended_at - c.answered_at).total_seconds())
            elif c.answered_at:
                answered_utc = c.answered_at.replace(tzinfo=timezone.utc)
                duration = int((dt.now(timezone.utc) - answered_utc).total_seconds())

            # Get flow name from metadata or store
            flow_name = None
            if c.metadata_:
                flow_name = c.metadata_.get("flow_name")
            if not flow_name and c.flow_id:
                try:
                    flow = _store.load(c.flow_id)
                    flow_name = flow.name
                except FileNotFoundError:
                    flow_name = c.flow_id

            # Get customer name from metadata
            customer_name = c.metadata_.get("customer_name") if c.metadata_ else None

            md = c.metadata_ or {}
            call_summaries.append(CallSummary(
                id=str(c.id),
                caller_number=c.caller_number,
                customer_name=customer_name or c.caller_number,
                status=c.status,
                disposition=c.disposition,
                direction=c.direction,
                flow_id=c.flow_id,
                flow_name=flow_name,
                queued_at=c.queued_at,
                answered_at=c.answered_at,
                ended_at=c.ended_at,
                duration_seconds=duration,
                escalation_requested=bool(md.get("escalation_requested", False)),
                card_locked=bool(md.get("card_locked", False)),
                livekit_room=c.livekit_room,
            ))

        return CallListResponse(
            calls=call_summaries,
            total=total,
            limit=limit,
            offset=offset,
        )


@app.get("/api/calls/stream")
async def stream_calls():
    """
    SSE endpoint for real-time call updates.

    Streams call lifecycle events as Server-Sent Events.
    Sends heartbeat every 15 seconds to keep connection alive.

    Event types:
        call-started: New call created
        call-updated: Call status changed
        call-ended: Call completed/escalated/failed
        heartbeat: Keep-alive

    Event format:
        event: call-started
        data: {"type": "call-started", "call_id": "...", "call": {...}}
    """
    import json
    from core.events.call_broadcaster import CallBroadcaster

    async def event_generator():
        broadcaster = CallBroadcaster.get()
        subscriber = broadcaster.subscribe()

        try:
            while True:
                try:
                    event = await asyncio.wait_for(
                        subscriber.__anext__(),
                        timeout=15.0,
                    )
                    data = json.dumps(event.to_dict())
                    yield f"event: {event.type}\ndata: {data}\n\n"
                except asyncio.TimeoutError:
                    yield "event: heartbeat\ndata: {}\n\n"
                except StopAsyncIteration:
                    break
        except asyncio.CancelledError:
            logger.info("Call stream client disconnected")
        finally:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/calls/{call_id}")
async def get_call(call_id: str):
    """
    Get single call details with events timeline.

    Path params:
        call_id: UUID of the call or livekit_room name

    Returns:
        call: Call details
        events: List of CallEvent records
    """
    from sqlalchemy import select as sa_select
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call, CallEvent
    from uuid import UUID

    async with AsyncSessionLocal() as session:
        # Try to parse as UUID first
        call: Call | None = None
        try:
            call_uuid = UUID(call_id)
            result = await session.execute(
                sa_select(Call).where(Call.id == call_uuid)
            )
            call = result.scalar_one_or_none()
        except ValueError:
            pass

        # Fall back to livekit_room lookup
        if call is None:
            result = await session.execute(
                sa_select(Call).where(Call.livekit_room == call_id)
            )
            call = result.scalar_one_or_none()

        if not call:
            raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found")

        # Fetch events
        events_result = await session.execute(
            sa_select(CallEvent)
            .where(CallEvent.call_id == call.id)
            .order_by(CallEvent.timestamp)
        )
        events = events_result.scalars().all()

        # Build response
        flow_name = call.metadata_.get("flow_name") if call.metadata_ else None
        if not flow_name and call.flow_id:
            try:
                flow = _store.load(call.flow_id)
                flow_name = flow.name
            except FileNotFoundError:
                flow_name = call.flow_id

        return {
            "call": {
                "id": str(call.id),
                "direction": call.direction,
                "caller_number": call.caller_number,
                "callee_number": call.callee_number,
                "status": call.status,
                "disposition": call.disposition,
                "flow_id": call.flow_id,
                "flow_name": flow_name,
                "livekit_room": call.livekit_room,
                "queued_at": call.queued_at.isoformat(),
                "answered_at": call.answered_at.isoformat() if call.answered_at else None,
                "ended_at": call.ended_at.isoformat() if call.ended_at else None,
                "metadata": call.metadata_,
            },
            "events": [
                {
                    "id": str(e.id),
                    "event_type": e.event_type,
                    "timestamp": e.timestamp.isoformat(),
                    "data": e.data,
                }
                for e in events
            ],
        }


@app.patch("/api/calls/{call_id}")
async def update_call(call_id: str, body: CallUpdateRequest):
    """
    Update call status, disposition, or ended_at.

    Body:
        status: New status (completed, escalated, failed)
        disposition: Outcome (completed, escalated, dropped)
        ended_at: End timestamp (defaults to now if status terminal)

    Returns:
        Updated call details
    """
    from sqlalchemy import select as sa_select, update as sa_update
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call
    from uuid import UUID

    async with AsyncSessionLocal() as session:
        # Try to parse as UUID first
        call: Call | None = None
        try:
            call_uuid = UUID(call_id)
            result = await session.execute(
                sa_select(Call).where(Call.id == call_uuid)
            )
            call = result.scalar_one_or_none()
        except ValueError:
            pass

        # Fall back to livekit_room lookup
        if call is None:
            result = await session.execute(
                sa_select(Call).where(Call.livekit_room == call_id)
            )
            call = result.scalar_one_or_none()

        if not call:
            raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found")

        # Build update dict
        updates = {}
        if body.status:
            updates["status"] = body.status
        if body.disposition:
            updates["disposition"] = body.disposition
        if body.ended_at:
            updates["ended_at"] = body.ended_at
        elif body.status in ("completed", "escalated", "failed"):
            # Auto-set ended_at for terminal states
            updates["ended_at"] = dt.now(timezone.utc)

        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")

        # Apply update
        await session.execute(
            sa_update(Call).where(Call.id == call.id).values(**updates)
        )
        await session.commit()

        # Refresh to get updated values
        await session.refresh(call)

        # Emit call event for SSE subscribers
        from core.events.call_broadcaster import CallBroadcaster
        broadcaster = CallBroadcaster.get()

        if body.status in ("completed", "escalated", "failed"):
            await broadcaster.publish(
                event_type="call-ended",
                call_id=str(call.id),
                ended_at=call.ended_at.isoformat() if call.ended_at else None,
            )
        else:
            await broadcaster.publish(
                event_type="call-updated",
                call_id=str(call.id),
                call={
                    "id": str(call.id),
                    "status": call.status,
                    "disposition": call.disposition,
                    "ended_at": call.ended_at.isoformat() if call.ended_at else None,
                },
            )

        return {
            "id": str(call.id),
            "status": call.status,
            "disposition": call.disposition,
            "ended_at": call.ended_at.isoformat() if call.ended_at else None,
        }


# ---------------------------------------------------------------------------
# Routes — End Call (shutdown LiveKit room)
# ---------------------------------------------------------------------------


class EndCallRequest(PydanticBaseModel):
    """Request to end a call."""
    disposition: Optional[str] = "completed"  # completed, escalated, dropped


@app.post("/api/calls/{call_id}/end")
async def end_call(call_id: str, body: EndCallRequest = EndCallRequest()):
    """
    End a call and shutdown the LiveKit room.

    This endpoint:
    1. Updates the call status to completed/escalated/failed
    2. Deletes the LiveKit room (kicks all participants)
    3. Broadcasts call-ended event to SSE subscribers

    Path params:
        call_id: UUID of the call or livekit_room name

    Body:
        disposition: Outcome of the call (completed, escalated, dropped)

    Returns:
        id: Call ID
        status: Updated status
        disposition: Call disposition
        ended_at: Timestamp when call ended
        room_deleted: Whether LiveKit room was deleted
    """
    from sqlalchemy import select as sa_select, update as sa_update
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call
    from uuid import UUID

    async with AsyncSessionLocal() as session:
        call: Call | None = None

        # Try to parse as UUID first
        try:
            call_uuid = UUID(call_id)
            result = await session.execute(
                sa_select(Call).where(Call.id == call_uuid)
            )
            call = result.scalar_one_or_none()
        except ValueError:
            pass

        # Fall back to livekit_room lookup
        if call is None:
            result = await session.execute(
                sa_select(Call).where(Call.livekit_room == call_id)
            )
            call = result.scalar_one_or_none()

        if not call:
            raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found")

        # Check if already ended
        if call.status in ("completed", "escalated", "failed"):
            return {
                "id": str(call.id),
                "status": call.status,
                "disposition": call.disposition,
                "ended_at": call.ended_at.isoformat() if call.ended_at else None,
                "room_deleted": False,
                "message": "Call already ended",
            }

        room_name = call.livekit_room
        call_db_id = str(call.id)

        # Update DB status
        ended_at = dt.now(timezone.utc)
        status = "escalated" if body.disposition == "escalated" else "completed"

        await session.execute(
            sa_update(Call)
            .where(Call.id == call.id)
            .values(
                status=status,
                disposition=body.disposition,
                ended_at=ended_at,
            )
        )
        await session.commit()

    # Delete LiveKit room
    room_deleted = False
    if room_name:
        api = None
        try:
            from livekit.api import LiveKitAPI
            from livekit.api.room_service import DeleteRoomRequest

            api = LiveKitAPI()
            await api.room.delete_room(DeleteRoomRequest(room=room_name))
            room_deleted = True
            logger.info("Deleted LiveKit room: %s", room_name)
        except Exception as e:
            logger.warning("Failed to delete LiveKit room %s: %s", room_name, e)
        finally:
            if api:
                await api.aclose()

    # Broadcast call-ended event
    try:
        from core.events.call_broadcaster import CallBroadcaster
        await CallBroadcaster.get().publish(
            event_type="call-ended",
            call_id=call_db_id,
            ended_at=ended_at.isoformat(),
        )
    except Exception as e:
        logger.warning("Failed to broadcast call-ended event: %s", e)

    return {
        "id": call_db_id,
        "status": status,
        "disposition": body.disposition,
        "ended_at": ended_at.isoformat(),
        "room_deleted": room_deleted,
    }


# ---------------------------------------------------------------------------
# Routes — Escalation + card-locked (from agent worker)
# ---------------------------------------------------------------------------


class EscalationEventRequest(PydanticBaseModel):
    """Request to publish an escalation state change from the agent worker."""
    event_type: str  # escalation-requested | escalation-cleared
    reason: str | None = None


class CardLockedEventRequest(PydanticBaseModel):
    """Request to notify that a card has been locked (PII-safe)."""
    cccd_masked: str


def _require_worker_auth(x_worker_token: str | None) -> None:
    """Require a shared-secret header on worker-facing endpoints when
    `WORKER_API_TOKEN` env var is set. No-op if the env var is unset (dev mode).
    """
    expected = os.environ.get("WORKER_API_TOKEN")
    if not expected:
        return  # Auth disabled (dev default)
    if x_worker_token != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Worker-Token")


async def _resolve_call_by_any_id(session, call_id: str):
    """Helper — look up a Call by UUID first, then by livekit_room."""
    from sqlalchemy import select as sa_select
    from core.db.models.call import Call
    from uuid import UUID

    call = None
    try:
        call_uuid = UUID(call_id)
        result = await session.execute(sa_select(Call).where(Call.id == call_uuid))
        call = result.scalar_one_or_none()
    except ValueError:
        pass
    if call is None:
        result = await session.execute(
            sa_select(Call).where(Call.livekit_room == call_id)
        )
        call = result.scalar_one_or_none()
    return call


@app.post("/api/calls/{call_id}/escalation")
async def publish_escalation_event(
    call_id: str,
    body: EscalationEventRequest,
    x_worker_token: str | None = Header(default=None),
):
    """
    Receive an escalation state change from the agent worker and persist +
    broadcast it for SSE subscribers (CallsPage red-border indicator).

    Body:
        event_type: 'escalation-requested' | 'escalation-cleared'
        reason: optional reason string

    Returns:
        status: ok
        call_id: call id used in request
    """
    _require_worker_auth(x_worker_token)
    from core.db.base import AsyncSessionLocal
    from core.events.call_broadcaster import CallBroadcaster

    event_type = body.event_type.strip()
    requested = event_type == "escalation-requested"
    cleared = event_type == "escalation-cleared"
    if not (requested or cleared):
        raise HTTPException(
            status_code=422,
            detail="event_type must be 'escalation-requested' or 'escalation-cleared'",
        )

    async with AsyncSessionLocal() as session:
        call = await _resolve_call_by_any_id(session, call_id)
        call_db_id: str | None = None
        if call is not None:
            md = dict(call.metadata_ or {})
            md["escalation_requested"] = requested
            if requested and body.reason:
                md["escalation_reason"] = body.reason
            call.metadata_ = md
            # Also update the typed field for compat
            if requested:
                call.was_escalated = True
                if body.reason:
                    call.escalation_reason = body.reason
            await session.commit()
            call_db_id = str(call.id)

    broadcaster = CallBroadcaster.get()
    broadcast_type = (
        "call-escalation-requested" if requested else "call-escalation-cleared"
    )
    await broadcaster.publish(
        event_type=broadcast_type,
        call_id=call_db_id or call_id,
        reason=body.reason,
    )
    return {"status": "ok", "call_id": call_db_id or call_id, "event_type": event_type}


@app.post("/api/calls/{call_id}/card-locked")
async def publish_card_locked_event(
    call_id: str,
    body: CardLockedEventRequest,
    x_worker_token: str | None = Header(default=None),
):
    """
    Receive a card-locked notification from the agent worker, stamp metadata,
    and broadcast a 'call-card-locked' SSE event for the frontend badge.
    """
    _require_worker_auth(x_worker_token)
    from core.db.base import AsyncSessionLocal
    from core.events.call_broadcaster import CallBroadcaster

    async with AsyncSessionLocal() as session:
        call = await _resolve_call_by_any_id(session, call_id)
        call_db_id: str | None = None
        if call is not None:
            md = dict(call.metadata_ or {})
            md["card_locked"] = True
            md["card_cccd_masked"] = body.cccd_masked
            call.metadata_ = md
            await session.commit()
            call_db_id = str(call.id)

    await CallBroadcaster.get().publish(
        event_type="call-card-locked",
        call_id=call_db_id or call_id,
        reason=body.cccd_masked,
    )
    return {"status": "ok", "call_id": call_db_id or call_id}


# ---------------------------------------------------------------------------
# Routes — Transcript publishing (for agent worker)
# ---------------------------------------------------------------------------


class TranscriptPublishRequest(PydanticBaseModel):
    """Request to publish a transcript event from agent worker."""
    role: str  # agent, customer, system
    text: str
    is_final: bool = True


@app.post("/api/calls/{call_id}/transcript")
async def publish_transcript(call_id: str, body: TranscriptPublishRequest):
    """
    Publish a transcript event from the agent worker.

    This endpoint allows the agent process to send transcript events
    to the TranscriptBroadcaster for SSE streaming to frontend.

    Body:
        role: Speaker role (agent, customer, system)
        text: The transcript text
        is_final: Whether this is final (default: true)

    Returns:
        status: ok
    """
    broadcaster = TranscriptBroadcaster.get()
    await broadcaster.publish(
        call_id=call_id,
        role=body.role,
        text=body.text,
        is_final=body.is_final,
    )
    return {"status": "ok", "call_id": call_id}


# ---------------------------------------------------------------------------
# Routes — Form state publishing (for agent worker)
# ---------------------------------------------------------------------------


class FormEventRequest(PydanticBaseModel):
    """Request to publish a form event from agent worker."""
    event_type: str  # form-init, field-update, form-confirmed, form-completed
    fields: list[dict] | None = None  # For form-init: [{id, label, field_type}]
    field_id: str | None = None  # For field-update
    value: str | None = None
    validated: bool = False
    attempts: int = 0
    confirmed: bool = False
    completed: bool = False


@app.post("/api/calls/{call_id}/form")
async def publish_form_event(call_id: str, body: FormEventRequest):
    """
    Receive form event from agent worker and broadcast to SSE subscribers.

    Note: call_id here is the session_id/room_name from the agent,
    NOT the database UUID.
    """
    logger.info(
        "Form event received: call_id=%s event_type=%s field_id=%s",
        call_id, body.event_type, body.field_id,
    )
    broadcaster = FormStateBroadcaster.get()
    await broadcaster.publish(
        call_id=call_id,
        event_type=body.event_type,
        fields=body.fields,
        field_id=body.field_id,
        value=body.value,
        validated=body.validated,
        attempts=body.attempts,
        confirmed=body.confirmed,
        completed=body.completed,
    )
    return {"status": "ok", "call_id": call_id, "event_type": body.event_type}


# ---------------------------------------------------------------------------
# Routes — Form state SSE streaming
# ---------------------------------------------------------------------------


@app.get("/api/calls/{call_id}/form/stream")
async def stream_form_state(call_id: str):
    """
    SSE endpoint for real-time form state streaming.

    Streams form events as Server-Sent Events.
    Sends heartbeat every 15 seconds.

    Event types:
        form-init: Initial field definitions
        field-update: Field value changed
        form-confirmed: User confirmed data
        form-completed: Form submitted
        heartbeat: Keep-alive
    """
    import json
    from sqlalchemy import select as sa_select
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call
    from uuid import UUID

    # Resolve call_id (UUID) to livekit_room (session_id used by agent)
    room_name = call_id  # Default to call_id if not found
    async with AsyncSessionLocal() as session:
        call: Call | None = None
        try:
            call_uuid = UUID(call_id)
            result = await session.execute(
                sa_select(Call).where(Call.id == call_uuid)
            )
            call = result.scalar_one_or_none()
        except ValueError:
            # Not a UUID, might be room name directly
            pass

        if call and call.livekit_room:
            room_name = call.livekit_room

    logger.info("Form SSE stream: call_id=%s resolved to room_name=%s", call_id, room_name)

    async def event_generator():
        broadcaster = FormStateBroadcaster.get()
        subscriber = broadcaster.subscribe(room_name)

        try:
            while True:
                try:
                    event = await asyncio.wait_for(
                        subscriber.__anext__(),
                        timeout=15.0,
                    )
                    data = json.dumps(event.model_dump(), default=str)
                    yield f"event: {event.event_type}\ndata: {data}\n\n"
                except asyncio.TimeoutError:
                    yield "event: heartbeat\ndata: {}\n\n"
                except StopAsyncIteration:
                    break
        except asyncio.CancelledError:
            logger.info("Form stream client disconnected for room=%s", room_name)
        finally:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Routes — Transcript SSE streaming
# ---------------------------------------------------------------------------


@app.get("/api/calls/{call_id}/transcript/stream")
async def stream_transcript(call_id: str):
    """
    SSE endpoint for real-time transcript streaming.

    Streams transcript events as Server-Sent Events.
    Sends heartbeat every 15 seconds to keep connection alive.

    Event format:
        event: transcript
        data: {"call_id": "...", "role": "customer", "text": "...", ...}

        event: heartbeat
        data: {}
    """

    async def event_generator():
        broadcaster = TranscriptBroadcaster.get()
        subscriber = broadcaster.subscribe(call_id)

        try:
            while True:
                try:
                    # Wait for event with timeout for heartbeat
                    event = await asyncio.wait_for(
                        subscriber.__anext__(),
                        timeout=15.0,
                    )
                    data = event.model_dump_json()
                    yield f"event: transcript\ndata: {data}\n\n"
                except asyncio.TimeoutError:
                    # Send heartbeat to keep connection alive
                    yield "event: heartbeat\ndata: {}\n\n"
                except StopAsyncIteration:
                    break
        except asyncio.CancelledError:
            # Client disconnected
            logger.info("SSE client disconnected for call_id=%s", call_id)
        finally:
            # Cleanup handled by subscriber context manager
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


# ---------------------------------------------------------------------------
# Routes — Transcript history (persisted)
# ---------------------------------------------------------------------------


@app.get("/api/calls/{call_id}/transcript")
async def get_transcript(call_id: str):
    """
    Return persisted transcript turns for a call.

    Requires the call to have been active with TranscriptPersister running.
    Returns 404 if no transcript exists for the given call_id.

    Returns:
        call_id: Echo of request call_id
        turns: List of turn dicts with role, text, timestamp, translation
    """
    from sqlalchemy import select as sa_select
    from core.db.base import AsyncSessionLocal
    from core.db.models.conversation import ConversationHistory, ConversationTurn
    from uuid import UUID

    # Try to match call_id as UUID or as caller_number (stub calls)
    async with AsyncSessionLocal() as session:
        call_uuid: UUID | None = None
        try:
            call_uuid = UUID(call_id)
        except ValueError:
            pass

        conv_id: UUID | None = None

        if call_uuid is not None:
            row = await session.execute(
                sa_select(ConversationHistory.id).where(
                    ConversationHistory.call_id == call_uuid
                )
            )
            conv_id = row.scalar_one_or_none()

        if conv_id is None:
            # Fall back: find via stub Call created by persister
            from core.db.models.call import Call
            call_row = await session.execute(
                sa_select(Call.id).where(Call.caller_number == call_id)
            )
            stub_call_id = call_row.scalar_one_or_none()
            if stub_call_id is not None:
                row2 = await session.execute(
                    sa_select(ConversationHistory.id).where(
                        ConversationHistory.call_id == stub_call_id
                    )
                )
                conv_id = row2.scalar_one_or_none()

        if conv_id is None:
            raise HTTPException(404, f"No transcript found for call '{call_id}'")

        turns_result = await session.execute(
            sa_select(ConversationTurn)
            .where(ConversationTurn.conversation_id == conv_id)
            .order_by(ConversationTurn.turn_index)
        )
        turns = turns_result.scalars().all()

        return {
            "call_id": call_id,
            "turns": [
                {
                    "turn_index": t.turn_index,
                    "role": t.role,
                    "text": t.text,
                    "timestamp": t.timestamp.isoformat(),
                    "translation": t.translation,
                    "is_translated": t.is_translated,
                }
                for t in turns
            ],
        }


@app.post("/api/calls/{call_id}/transcript/translate")
async def translate_untranslated_turns(
    call_id: str,
    source_lang: str = "vi",
    target_lang: str = "en",
):
    """
    Translate all untranslated turns for a call.

    Finds turns where is_translated=False, translates them,
    and saves the translation back to the database.

    Returns list of newly translated turns.
    """
    from sqlalchemy import select as sa_select
    from core.db.base import AsyncSessionLocal
    from core.db.models.conversation import ConversationHistory, ConversationTurn
    from uuid import UUID

    async with AsyncSessionLocal() as session:
        call_uuid: UUID | None = None
        try:
            call_uuid = UUID(call_id)
        except ValueError:
            pass

        conv_id: UUID | None = None

        if call_uuid is not None:
            row = await session.execute(
                sa_select(ConversationHistory.id).where(
                    ConversationHistory.call_id == call_uuid
                )
            )
            conv_id = row.scalar_one_or_none()

        if conv_id is None:
            from core.db.models.call import Call
            call_row = await session.execute(
                sa_select(Call.id).where(Call.caller_number == call_id)
            )
            stub_call_id = call_row.scalar_one_or_none()
            if stub_call_id is not None:
                row2 = await session.execute(
                    sa_select(ConversationHistory.id).where(
                        ConversationHistory.call_id == stub_call_id
                    )
                )
                conv_id = row2.scalar_one_or_none()

        if conv_id is None:
            raise HTTPException(404, f"No transcript found for call '{call_id}'")

        # Find untranslated turns
        turns_result = await session.execute(
            sa_select(ConversationTurn)
            .where(
                ConversationTurn.conversation_id == conv_id,
                ConversationTurn.is_translated == False,
            )
            .order_by(ConversationTurn.turn_index)
        )
        untranslated_turns = turns_result.scalars().all()

        if not untranslated_turns:
            return {"call_id": call_id, "translated_count": 0, "turns": []}

        translator = get_translator()
        translated_turns = []

        for turn in untranslated_turns:
            if not turn.text or not turn.text.strip():
                turn.is_translated = True
                continue

            try:
                translation = await translator.translate(
                    text=turn.text,
                    source=source_lang,
                    target=target_lang,
                    use_cache=True,
                )
                if translation and translation != turn.text:
                    turn.translation = translation
                    turn.translation_source = source_lang
                    turn.translation_target = target_lang
                turn.is_translated = True
                translated_turns.append({
                    "turn_index": turn.turn_index,
                    "role": turn.role,
                    "text": turn.text,
                    "translation": turn.translation,
                })
            except Exception as e:
                logger.warning(
                    "Failed to translate turn %d for call %s: %s",
                    turn.turn_index, call_id, e
                )

        await session.commit()

        return {
            "call_id": call_id,
            "translated_count": len(translated_turns),
            "turns": translated_turns,
        }


# ---------------------------------------------------------------------------
# Routes — Translation
# ---------------------------------------------------------------------------


class TranslateRequest(PydanticBaseModel):
    """Request model for translation endpoint."""
    text: str
    target_lang: str = "en"
    source_lang: str = "vi"


class TranslateResponse(PydanticBaseModel):
    """Response model for translation endpoint."""
    translated: str
    source_lang: str
    target_lang: str
    cached: bool = False


class TranslationConfigRequest(PydanticBaseModel):
    """Request to configure translation for a call."""
    enabled: bool
    source: str = "vi"
    target: str = "en"


@app.post("/api/translate")
async def translate_text(request: TranslateRequest) -> TranslateResponse:
    """
    Translate text using Qwen MT Flash.

    Request body:
        text: Text to translate
        target_lang: Target language code (default: en)
        source_lang: Source language code (default: vi)

    Returns:
        translated: Translated text
        source_lang: Source language used
        target_lang: Target language used
        cached: Whether result was from cache
    """
    if not request.text.strip():
        raise HTTPException(status_code=422, detail="text cannot be empty")

    translator = get_translator()

    # Check cache first to report if cached
    cache = translator._cache
    cached = cache.get(request.text, request.source_lang, request.target_lang) is not None

    translated = await translator.translate(
        text=request.text,
        source=request.source_lang,
        target=request.target_lang,
        use_cache=True,
    )

    return TranslateResponse(
        translated=translated,
        source_lang=request.source_lang,
        target_lang=request.target_lang,
        cached=cached,
    )


@app.post("/api/translate/stream")
async def translate_text_streaming(request: TranslateRequest):
    """
    Translate text with streaming response (SSE).

    Streams translation chunks as they arrive from the model.
    Useful for long texts where you want to show progress.

    Event format:
        event: chunk
        data: {"text": "partial translation..."}

        event: done
        data: {"text": "full translation"}
    """
    if not request.text.strip():
        raise HTTPException(status_code=422, detail="text cannot be empty")

    async def stream_generator():
        translator = get_translator()
        full_text = ""

        try:
            async for chunk in translator.translate_streaming(
                text=request.text,
                source=request.source_lang,
                target=request.target_lang,
            ):
                full_text += chunk
                yield f"event: chunk\ndata: {{\"text\": {repr(chunk)}}}\n\n"

            # Send completion event
            yield f"event: done\ndata: {{\"text\": {repr(full_text)}}}\n\n"

        except Exception as e:
            logger.error("Streaming translation error: %s", e)
            yield f"event: error\ndata: {{\"error\": {repr(str(e))}}}\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/calls/{call_id}/translation")
async def configure_translation(call_id: str, config: TranslationConfigRequest):
    """
    Enable/disable translation for a call's transcript stream.

    When enabled, final transcripts will include translation.

    Request body:
        enabled: Whether to enable translation
        source: Source language code (default: vi)
        target: Target language code (default: en)

    Returns:
        status: ok
        call_id: The call ID
        enabled/source/target: Echo of configuration
    """
    broadcaster = TranscriptBroadcaster.get()
    broadcaster.set_translation(
        call_id=call_id,
        enabled=config.enabled,
        source=config.source,
        target=config.target,
    )

    return {
        "status": "ok",
        "call_id": call_id,
        **config.model_dump(),
    }


@app.get("/api/translate/stats")
async def get_translation_stats():
    """
    Get translation cache statistics.

    Returns:
        size: Current number of cached entries
        maxsize: Maximum cache size
        hits: Cache hits
        misses: Cache misses
        hit_rate_percent: Cache hit rate percentage
    """
    translator = get_translator()
    return translator.cache_stats


# ---------------------------------------------------------------------------
# Routes — LiveKit room token
# ---------------------------------------------------------------------------


@app.get("/api/calls/{call_id}/token")
async def get_room_token(call_id: str):
    """
    Generate a LiveKit room token for frontend to join as listener.

    The token allows subscribing to audio but not publishing.
    This enables the frontend to hear the conversation in real-time.

    Path params:
        call_id: UUID of the call or livekit_room name

    Returns:
        token: JWT token for LiveKit
        url: LiveKit server URL
        room: LiveKit room name (from call.livekit_room)
        active: Whether the room is currently active in LiveKit

    Errors:
        404: Call not found
        400: Call has no LiveKit room or call has ended
        410: Room no longer exists in LiveKit (call ended)
    """
    try:
        from livekit.api import AccessToken, VideoGrants, LiveKitAPI
        from livekit.api.room_service import ListRoomsRequest
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="livekit-api package not installed",
        )

    api_key = os.environ.get("LIVEKIT_API_KEY")
    api_secret = os.environ.get("LIVEKIT_API_SECRET")
    livekit_url = os.environ.get("LIVEKIT_URL")

    if not all([api_key, api_secret, livekit_url]):
        raise HTTPException(
            status_code=500,
            detail="LiveKit environment variables not configured",
        )

    # Look up the call to get the actual LiveKit room name
    from sqlalchemy import select as sa_select
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call
    from uuid import UUID

    async with AsyncSessionLocal() as session:
        call: Call | None = None

        # Try to parse as UUID first
        try:
            call_uuid = UUID(call_id)
            result = await session.execute(
                sa_select(Call).where(Call.id == call_uuid)
            )
            call = result.scalar_one_or_none()
        except ValueError:
            pass

        # Fall back to livekit_room lookup
        if call is None:
            result = await session.execute(
                sa_select(Call).where(Call.livekit_room == call_id)
            )
            call = result.scalar_one_or_none()

        if not call:
            raise HTTPException(status_code=404, detail=f"Call '{call_id}' not found")

        if not call.livekit_room:
            raise HTTPException(
                status_code=400,
                detail=f"Call '{call_id}' has no LiveKit room associated",
            )

        # Check if call has already ended (terminal status)
        if call.status in ("completed", "escalated", "failed"):
            raise HTTPException(
                status_code=410,
                detail=f"Call has ended (status: {call.status}). Room no longer available.",
            )

        room_name = call.livekit_room

    # Verify room actually exists in LiveKit server
    try:
        api = LiveKitAPI()
        rooms_response = await api.room.list_rooms(ListRoomsRequest(names=[room_name]))
        await api.aclose()

        room_exists = any(r.name == room_name for r in rooms_response.rooms)

        if not room_exists:
            # Room doesn't exist in LiveKit - update DB status
            async with AsyncSessionLocal() as session:
                from sqlalchemy import update as sa_update
                await session.execute(
                    sa_update(Call)
                    .where(Call.livekit_room == room_name)
                    .values(status="completed", ended_at=dt.now(timezone.utc))
                )
                await session.commit()

            raise HTTPException(
                status_code=410,
                detail="Room no longer exists in LiveKit. Call has ended.",
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Failed to verify room existence in LiveKit: %s", e)
        # Continue anyway - let the client try to connect

    # Create access token for the actual LiveKit room (builder pattern for livekit-api 1.1.0+)
    token = (
        AccessToken(api_key=api_key, api_secret=api_secret)
        .with_identity(f"web-{call_id}")
        .with_name(f"Web Listener ({call_id})")
        .with_grants(VideoGrants(
            room=room_name,  # Use actual livekit_room, not call_id
            room_join=True,
            can_subscribe=True,
            can_publish=False,  # Listen only
        ))
    )

    return {
        "token": token.to_jwt(),
        "url": livekit_url,
        "room": room_name,
        "active": True,
    }


# ---------------------------------------------------------------------------
# Routes — Phone Simulator
# ---------------------------------------------------------------------------


@app.post("/api/simulator/call")
async def create_simulator_call(body: dict = Body(default={})):
    """
    Create a LiveKit room and dispatch an agent for phone simulation.

    Request body (optional):
        flow_id: Flow to use (uses first available if not provided)
        agent_name: Agent to dispatch (default: "form-agent", can use "simple-agent")

    Returns:
        call_id: Unique call identifier
        db_id: Database UUID for the call record
        room_name: LiveKit room name
        token: JWT token for participant
        url: LiveKit server URL
    """
    import secrets
    import time
    from uuid import uuid4

    try:
        from livekit.api import AccessToken, VideoGrants
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="livekit-api package not installed",
        )

    api_key = os.environ.get("LIVEKIT_API_KEY")
    api_secret = os.environ.get("LIVEKIT_API_SECRET")
    livekit_url = os.environ.get("LIVEKIT_URL")

    if not all([api_key, api_secret, livekit_url]):
        raise HTTPException(
            status_code=500,
            detail="LiveKit environment variables not configured",
        )

    # Always use form-agent, default to loan_intake_form
    agent_name = "form-agent"  # Force form-agent

    # Determine flow_id
    flow_id = body.get("flow_id")
    flow_name = "Loan Intake Form"

    if not flow_id:
        flow_id = "loan_intake_form"  # Default flow
        # Fallback to first available if loan_intake_form doesn't exist
        try:
            _store.load(flow_id)
        except FileNotFoundError:
            flows = _store.list()
            if not flows:
                raise HTTPException(
                    status_code=400,
                    detail="No flows available. Create a flow first.",
                )
            flow_id = flows[0]

    # Verify flow exists and get flow name
    try:
        flow = _store.load(flow_id)
        flow_name = flow.name
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Flow '{flow_id}' not found",
        )

    # Generate unique call_id
    timestamp = int(time.time())
    random_suffix = secrets.token_hex(4)
    call_id = f"sim-{timestamp}-{random_suffix}"
    user_identity = f"sim-user-{call_id}"

    # Create Call DB record before LiveKit room
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call
    from sqlalchemy import update as sa_update

    async with AsyncSessionLocal() as session:
        call_record = Call(
            id=uuid4(),
            direction="inbound",
            caller_number=user_identity,
            callee_number="agent",
            status="in_progress",
            flow_id=flow_id,
            livekit_room=call_id,
            simulator_user_identity=user_identity,
            metadata_={"flow_name": flow_name, "source": "simulator"},
        )
        session.add(call_record)
        await session.commit()
        db_call_id = str(call_record.id)

    # Create LiveKit room and dispatch agent via API (more reliable than token-based)
    import json
    from livekit.api import LiveKitAPI
    from livekit.api.room_service import CreateRoomRequest
    from livekit.api.agent_dispatch_service import CreateAgentDispatchRequest

    metadata = json.dumps({"flow_id": flow_id}) if flow_id else "{}"

    try:
        lk_api = LiveKitAPI()
        # Create room
        await lk_api.room.create_room(CreateRoomRequest(name=call_id))
        logger.info("Created LiveKit room: %s", call_id)

        # Dispatch agent via API
        await lk_api.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(
                room=call_id,
                agent_name=agent_name,
                metadata=metadata,
            )
        )
        logger.info("Dispatched agent '%s' to room '%s'", agent_name, call_id)
        await lk_api.aclose()
    except Exception as e:
        logger.error("Failed to create room/dispatch agent: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to dispatch agent: {e}")

    # Emit call-started event for SSE subscribers
    try:
        from core.events.call_broadcaster import CallBroadcaster
        await CallBroadcaster.get().publish(
            event_type="call-started",
            call_id=db_call_id,
            call={
                "id": db_call_id,
                "caller_number": call_record.caller_number,
                "customer_name": call_record.caller_number,
                "status": call_record.status,
                "flow_id": call_record.flow_id,
                "flow_name": flow_name,
                "queued_at": call_record.queued_at.isoformat(),
                "livekit_room": call_id,
            },
        )
    except Exception as e:
        logger.warning("Failed to emit call-started event: %s", e)

    # Generate participant token (no room_config needed - agent already dispatched via API)
    token = (
        AccessToken(api_key=api_key, api_secret=api_secret)
        .with_identity(user_identity)
        .with_name("Simulator User")
        .with_grants(VideoGrants(
            room=call_id,
            room_join=True,
            can_subscribe=True,
            can_publish=True,  # User needs to publish audio
        ))
    )

    return {
        "call_id": call_id,
        "db_id": db_call_id,
        "room_name": call_id,
        "token": token.to_jwt(),
        "url": livekit_url,
    }


@app.post("/api/simulator/simple-call")
async def create_simple_simulator_call():
    """
    DEPRECATED: Use /api/simulator/call instead.
    Simple agent has been removed in favor of flow agent.
    """
    raise HTTPException(
        status_code=410,
        detail="This endpoint is deprecated. Use POST /api/simulator/call instead, which now uses form-agent with loan_intake_form by default.",
    )





@app.post("/api/simulator/v2/call")
async def create_simulator_call_v2(body: dict = Body(default={})):
    """
    Phone Simulator V2 — dispatches the `report_lost_card` flow by default.

    Same mechanics as /api/simulator/call but forces flow_id='report_lost_card'
    unless the caller overrides it. Stored metadata includes
    scenario='report_lost_card' + source='simulator-v2'.

    Request body (optional):
        flow_id: Override flow id (defaults to 'report_lost_card')
    """
    import secrets
    import time
    from uuid import uuid4

    try:
        from livekit.api import AccessToken, VideoGrants
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="livekit-api package not installed",
        )

    api_key = os.environ.get("LIVEKIT_API_KEY")
    api_secret = os.environ.get("LIVEKIT_API_SECRET")
    livekit_url = os.environ.get("LIVEKIT_URL")
    if not all([api_key, api_secret, livekit_url]):
        raise HTTPException(
            status_code=500,
            detail="LiveKit environment variables not configured",
        )

    flow_id = body.get("flow_id") or "report_lost_card"
    try:
        flow = _store.load(flow_id)
        flow_name = flow.name
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")

    timestamp = int(time.time())
    random_suffix = secrets.token_hex(4)
    call_id = f"simv2-{timestamp}-{random_suffix}"
    user_identity = f"sim-user-{call_id}"

    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call

    async with AsyncSessionLocal() as session:
        call_record = Call(
            id=uuid4(),
            direction="inbound",
            caller_number=user_identity,
            callee_number="agent",
            status="in_progress",
            flow_id=flow_id,
            livekit_room=call_id,
            simulator_user_identity=user_identity,
            metadata_={
                "flow_name": flow_name,
                "source": "simulator-v2",
                "scenario": "report_lost_card",
            },
        )
        session.add(call_record)
        await session.commit()
        db_call_id = str(call_record.id)

    import json
    from livekit.api import LiveKitAPI
    from livekit.api.room_service import CreateRoomRequest
    from livekit.api.agent_dispatch_service import CreateAgentDispatchRequest

    metadata = json.dumps({"flow_id": flow_id})

    try:
        lk_api = LiveKitAPI()
        await lk_api.room.create_room(CreateRoomRequest(name=call_id))
        await lk_api.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(
                room=call_id,
                agent_name="form-agent",
                metadata=metadata,
            )
        )
        await lk_api.aclose()
    except Exception as e:
        logger.error("v2 simulator failed to dispatch: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to dispatch agent: {e}")

    try:
        from core.events.call_broadcaster import CallBroadcaster
        await CallBroadcaster.get().publish(
            event_type="call-started",
            call_id=db_call_id,
            call={
                "id": db_call_id,
                "caller_number": call_record.caller_number,
                "customer_name": call_record.caller_number,
                "status": call_record.status,
                "flow_id": flow_id,
                "flow_name": flow_name,
                "queued_at": call_record.queued_at.isoformat(),
                "livekit_room": call_id,
                "scenario": "report_lost_card",
            },
        )
    except Exception as e:
        logger.warning("v2 simulator: failed to emit call-started: %s", e)

    token = (
        AccessToken(api_key=api_key, api_secret=api_secret)
        .with_identity(user_identity)
        .with_name("Simulator V2 User")
        .with_grants(VideoGrants(
            room=call_id,
            room_join=True,
            can_subscribe=True,
            can_publish=True,
        ))
    )

    return {
        "call_id": call_id,
        "db_id": db_call_id,
        "room_name": call_id,
        "token": token.to_jwt(),
        "url": livekit_url,
        "scenario": "report_lost_card",
    }


# ---------------------------------------------------------------------------
# Routes — Human operator "Join as human" token
# ---------------------------------------------------------------------------


@app.get("/api/calls/{call_id}/human-token")
async def get_human_operator_token(call_id: str):
    """
    Issue a LiveKit token for a human operator to join an escalated call.

    Identity starts with `human-agent-` so the agent-side
    participant_connected listener will auto-stop the hold music.

    Returns:
        token: JWT with can_publish=True, can_subscribe=True
        url: LiveKit server URL
        room: LiveKit room name
        identity: generated human operator identity
    """
    import secrets
    try:
        from livekit.api import AccessToken, VideoGrants
    except ImportError:
        raise HTTPException(500, "livekit-api package not installed")

    api_key = os.environ.get("LIVEKIT_API_KEY")
    api_secret = os.environ.get("LIVEKIT_API_SECRET")
    livekit_url = os.environ.get("LIVEKIT_URL")
    if not all([api_key, api_secret, livekit_url]):
        raise HTTPException(500, "LiveKit environment variables not configured")

    from core.db.base import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        call = await _resolve_call_by_any_id(session, call_id)
        if not call:
            raise HTTPException(404, f"Call '{call_id}' not found")
        if not call.livekit_room:
            raise HTTPException(400, f"Call '{call_id}' has no LiveKit room")
        # H3: An escalation request is the PRIMARY reason an operator joins,
        # so status='escalated' must NOT block token issuance here; only
        # terminal non-escalation states should.
        if call.status in ("completed", "failed"):
            raise HTTPException(410, f"Call has ended (status: {call.status})")
        room_name = call.livekit_room

    identity = f"human-agent-{secrets.token_hex(4)}"
    token = (
        AccessToken(api_key=api_key, api_secret=api_secret)
        .with_identity(identity)
        .with_name("Human Operator")
        .with_grants(VideoGrants(
            room=room_name,
            room_join=True,
            can_subscribe=True,
            can_publish=True,
        ))
    )

    return {
        "token": token.to_jwt(),
        "url": livekit_url,
        "room": room_name,
        "identity": identity,
    }


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------


@app.get("/api/analytics")
async def get_analytics(days: int = 30) -> dict[str, Any]:
    """
    Aggregate analytics over the last `days` for the dashboard.

    Returns KPIs, time-series (calls per day), status/disposition/direction
    breakdowns, top queues, top agents, hourly heatmap, escalation reasons.
    """
    from collections import defaultdict
    from datetime import timedelta as _td

    from sqlalchemy import select as _select
    from core.db.base import AsyncSessionLocal
    from core.db.models.agent import Agent as _Agent
    from core.db.models.call import Call as _Call
    from core.db.models.customer import Customer as _Customer
    from core.db.models.queue import Queue as _Queue

    days = max(1, min(days, 90))
    now = dt.now(timezone.utc)
    since = now - _td(days=days)

    def _to_naive_utc(d):
        """Normalize DB timestamps (stored naive in SQLite) for comparison."""
        if d is None:
            return None
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d

    async with AsyncSessionLocal() as session:
        calls_res = await session.execute(_select(_Call))
        all_calls = list(calls_res.scalars().all())
        agents_res = await session.execute(_select(_Agent))
        agents = list(agents_res.scalars().all())
        queues_res = await session.execute(_select(_Queue))
        queues = list(queues_res.scalars().all())
        customers_res = await session.execute(_select(_Customer))
        customers = list(customers_res.scalars().all())

    queue_by_id = {str(q.id): q.name for q in queues}
    agent_by_id = {str(a.id): a.name for a in agents}

    # Filter window
    window_calls = [c for c in all_calls if _to_naive_utc(c.queued_at) >= since]

    # KPIs
    total = len(window_calls)
    completed = sum(1 for c in window_calls if c.status == "completed")
    escalated = sum(1 for c in window_calls if c.status == "escalated" or c.was_escalated)
    failed = sum(1 for c in window_calls if c.status in ("failed", "abandoned"))
    in_progress = sum(1 for c in window_calls if c.status == "in_progress")
    form_filled = sum(1 for c in window_calls if c.disposition == "form_filled")

    talk_durations = [
        c.talk_duration
        for c in window_calls
        if c.talk_duration and c.status != "in_progress"
    ]
    wait_durations = [c.wait_duration for c in window_calls if c.wait_duration]
    avg_talk = int(sum(talk_durations) / len(talk_durations)) if talk_durations else 0
    avg_wait = int(sum(wait_durations) / len(wait_durations)) if wait_durations else 0

    csats = [
        c.metadata_.get("csat")
        for c in window_calls
        if c.metadata_ and c.metadata_.get("csat") is not None
    ]
    avg_csat = round(sum(csats) / len(csats), 2) if csats else None

    completion_rate = round(completed / total * 100, 1) if total else 0.0
    escalation_rate = round(escalated / total * 100, 1) if total else 0.0

    # Time series — calls per day
    per_day_total = defaultdict(int)
    per_day_completed = defaultdict(int)
    per_day_escalated = defaultdict(int)
    for c in window_calls:
        d = _to_naive_utc(c.queued_at).date().isoformat()
        per_day_total[d] += 1
        if c.status == "completed":
            per_day_completed[d] += 1
        if c.status == "escalated" or c.was_escalated:
            per_day_escalated[d] += 1

    series = []
    for i in range(days - 1, -1, -1):
        d = (now - _td(days=i)).date().isoformat()
        series.append({
            "date": d,
            "total": per_day_total.get(d, 0),
            "completed": per_day_completed.get(d, 0),
            "escalated": per_day_escalated.get(d, 0),
        })

    # Status breakdown
    status_counts = defaultdict(int)
    for c in window_calls:
        status_counts[c.status] += 1
    status_breakdown = [
        {"label": k, "value": v} for k, v in sorted(status_counts.items(), key=lambda x: -x[1])
    ]

    # Disposition breakdown
    disp_counts = defaultdict(int)
    for c in window_calls:
        if c.disposition:
            disp_counts[c.disposition] += 1
    disposition_breakdown = [
        {"label": k, "value": v} for k, v in sorted(disp_counts.items(), key=lambda x: -x[1])
    ]

    # Direction
    direction_counts = defaultdict(int)
    for c in window_calls:
        direction_counts[c.direction] += 1
    direction_breakdown = [
        {"label": k, "value": v} for k, v in sorted(direction_counts.items(), key=lambda x: -x[1])
    ]

    # Top queues
    queue_counts = defaultdict(int)
    for c in window_calls:
        qname = queue_by_id.get(str(c.queue_id)) if c.queue_id else "Unassigned"
        queue_counts[qname or "Unassigned"] += 1
    top_queues = sorted(
        [{"label": k, "value": v} for k, v in queue_counts.items()],
        key=lambda x: -x["value"],
    )[:6]

    # Top agents (by handled calls)
    agent_counts = defaultdict(int)
    agent_talk = defaultdict(int)
    for c in window_calls:
        if not c.agent_id:
            continue
        name = agent_by_id.get(str(c.agent_id), "Unknown")
        agent_counts[name] += 1
        if c.talk_duration:
            agent_talk[name] += c.talk_duration
    top_agents = sorted(
        [
            {
                "label": name,
                "calls": count,
                "avg_talk": int(agent_talk[name] / count) if count else 0,
            }
            for name, count in agent_counts.items()
        ],
        key=lambda x: -x["calls"],
    )[:8]

    # Hourly heatmap (24 buckets)
    hourly = [0] * 24
    for c in window_calls:
        hourly[_to_naive_utc(c.queued_at).hour] += 1

    # Escalation reasons
    reason_counts = defaultdict(int)
    for c in window_calls:
        if c.escalation_reason:
            reason_counts[c.escalation_reason] += 1
    escalation_reasons = sorted(
        [{"label": k, "value": v} for k, v in reason_counts.items()],
        key=lambda x: -x["value"],
    )

    # Flow usage
    flow_counts = defaultdict(int)
    for c in window_calls:
        if c.flow_id:
            flow_counts[c.flow_id] += 1
    flow_breakdown = sorted(
        [{"label": k, "value": v} for k, v in flow_counts.items()],
        key=lambda x: -x["value"],
    )[:6]

    # Agent status snapshot
    agent_status_counts = defaultdict(int)
    for a in agents:
        agent_status_counts[a.status] += 1

    return {
        "generated_at": now.isoformat(),
        "window_days": days,
        "kpis": {
            "total_calls": total,
            "completed": completed,
            "escalated": escalated,
            "failed": failed,
            "in_progress": in_progress,
            "form_filled": form_filled,
            "completion_rate": completion_rate,
            "escalation_rate": escalation_rate,
            "avg_talk_seconds": avg_talk,
            "avg_wait_seconds": avg_wait,
            "avg_csat": avg_csat,
            "total_customers": len(customers),
            "total_agents": len(agents),
            "active_agents": sum(
                1 for a in agents if a.status in ("online", "busy", "after_call_work")
            ),
        },
        "series": series,
        "status_breakdown": status_breakdown,
        "disposition_breakdown": disposition_breakdown,
        "direction_breakdown": direction_breakdown,
        "top_queues": top_queues,
        "top_agents": top_agents,
        "hourly": hourly,
        "escalation_reasons": escalation_reasons,
        "flow_breakdown": flow_breakdown,
        "agent_status": [
            {"label": k, "value": v}
            for k, v in sorted(agent_status_counts.items(), key=lambda x: -x[1])
        ],
    }

# ---------------------------------------------------------------------------
# Routes — Outbound Calls (call dispatch → ringing → answer)
# ---------------------------------------------------------------------------


def _sanitize_phone_for_room(phone: str) -> str:
    """LiveKit room names only allow [A-Za-z0-9._-]. Strip other chars."""
    import re
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "", phone)
    return cleaned or "anon"


@app.post("/api/calls/outbound")
async def create_outbound_call(body: dict = Body(...)):
    """
    Create an outbound call: dispatches an agent to a LiveKit room and
    marks the call as 'ringing'. The target simulator phone listens on
    /api/calls/stream and pops an incoming-call UI; on answer, it calls
    /api/calls/{id}/answer to obtain a LiveKit token.

    Request body:
        flow_id: Flow to use (required)
        phone_number: Phone number to "call" (required, also used as display name)

    Returns:
        id: DB UUID of the call record
        call_id: Legacy identifier (also db id)
        room_name: LiveKit room name
    """
    import secrets
    import time
    from uuid import uuid4

    try:
        from livekit.api import LiveKitAPI
        from livekit.api.room_service import CreateRoomRequest
        from livekit.api.agent_dispatch_service import CreateAgentDispatchRequest
    except ImportError:
        raise HTTPException(status_code=500, detail="livekit-api package not installed")

    phone_number = (body.get("phone_number") or "").strip()
    flow_id = (body.get("flow_id") or "").strip()

    if not phone_number:
        raise HTTPException(status_code=422, detail="phone_number is required")
    if not flow_id:
        raise HTTPException(status_code=422, detail="flow_id is required")

    api_key = os.environ.get("LIVEKIT_API_KEY")
    api_secret = os.environ.get("LIVEKIT_API_SECRET")
    livekit_url = os.environ.get("LIVEKIT_URL")
    if not all([api_key, api_secret, livekit_url]):
        raise HTTPException(
            status_code=500, detail="LiveKit environment variables not configured"
        )

    # Verify flow exists
    try:
        flow = _store.load(flow_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Flow '{flow_id}' not found")
    flow_name = flow.name

    # Unique room name — blend phone number with timestamp for uniqueness
    timestamp = int(time.time())
    suffix = secrets.token_hex(3)
    room_name = f"out-{_sanitize_phone_for_room(phone_number)}-{timestamp}-{suffix}"
    user_identity = f"sim-{_sanitize_phone_for_room(phone_number)}-{suffix}"

    # Create Call DB record
    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call

    async with AsyncSessionLocal() as session:
        call_record = Call(
            id=uuid4(),
            direction="outbound",
            caller_number=phone_number,
            callee_number=phone_number,
            status="ringing",
            flow_id=flow_id,
            livekit_room=room_name,
            simulator_user_identity=user_identity,
            metadata_={
                "flow_name": flow_name,
                "customer_name": phone_number,
                "source": "outbound",
                "phone_number": phone_number,
            },
        )
        session.add(call_record)
        await session.commit()
        db_call_id = str(call_record.id)
        queued_at_iso = call_record.queued_at.isoformat()

    # Create LiveKit room and dispatch agent. Agent will wait for participant.
    import json as _json
    metadata = _json.dumps({"flow_id": flow_id})

    try:
        lk_api = LiveKitAPI()
        await lk_api.room.create_room(CreateRoomRequest(name=room_name))
        await lk_api.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(
                room=room_name,
                agent_name="form-agent",
                metadata=metadata,
            )
        )
        await lk_api.aclose()
        logger.info("Outbound call %s dispatched to room %s", db_call_id, room_name)
    except Exception as e:
        logger.error("Failed to create outbound call room: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to dispatch agent: {e}")

    # Broadcast incoming-call event so simulator phones can ring
    try:
        from core.events.call_broadcaster import CallBroadcaster
        payload = {
            "id": db_call_id,
            "caller_number": phone_number,
            "customer_name": phone_number,
            "status": "ringing",
            "direction": "outbound",
            "flow_id": flow_id,
            "flow_name": flow_name,
            "queued_at": queued_at_iso,
            "livekit_room": room_name,
        }
        broadcaster = CallBroadcaster.get()
        # Emit both for legacy subscribers and for simulator pages
        await broadcaster.publish(
            event_type="call-started", call_id=db_call_id, call=payload
        )
        await broadcaster.publish(
            event_type="incoming-call", call_id=db_call_id, call=payload
        )
    except Exception as e:
        logger.warning("Failed to emit outbound call events: %s", e)

    return {
        "id": db_call_id,
        "call_id": db_call_id,
        "room_name": room_name,
        "phone_number": phone_number,
        "flow_id": flow_id,
        "flow_name": flow_name,
    }


@app.post("/api/calls/{call_id}/answer")
async def answer_call(call_id: str):
    """
    Simulator "picks up" an incoming call. Returns a LiveKit token for the
    simulator to connect to the already-running room, and marks the call
    as in_progress.
    """
    from datetime import datetime, timezone
    from uuid import UUID

    try:
        from livekit.api import AccessToken, VideoGrants
    except ImportError:
        raise HTTPException(status_code=500, detail="livekit-api package not installed")

    api_key = os.environ.get("LIVEKIT_API_KEY")
    api_secret = os.environ.get("LIVEKIT_API_SECRET")
    livekit_url = os.environ.get("LIVEKIT_URL")
    if not all([api_key, api_secret, livekit_url]):
        raise HTTPException(
            status_code=500, detail="LiveKit environment variables not configured"
        )

    from core.db.base import AsyncSessionLocal
    from core.db.models.call import Call
    from sqlalchemy import select as sa_select

    try:
        call_uuid = UUID(call_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid call_id format")

    async with AsyncSessionLocal() as session:
        result = await session.execute(sa_select(Call).where(Call.id == call_uuid))
        call = result.scalar_one_or_none()
        if call is None:
            raise HTTPException(status_code=404, detail="Call not found")
        if not call.livekit_room or not call.simulator_user_identity:
            raise HTTPException(
                status_code=400, detail="Call has no active LiveKit room"
            )
        if call.status not in ("ringing", "in_progress"):
            raise HTTPException(
                status_code=409, detail=f"Cannot answer call in status '{call.status}'"
            )

        room_name = call.livekit_room
        user_identity = call.simulator_user_identity
        phone_number = call.caller_number

        # Mark as answered (idempotent)
        if call.status == "ringing":
            call.status = "in_progress"
            call.answered_at = datetime.now(timezone.utc)
            await session.commit()

    # Generate token
    token = (
        AccessToken(api_key=api_key, api_secret=api_secret)
        .with_identity(user_identity)
        .with_name(phone_number)
        .with_grants(VideoGrants(
            room=room_name,
            room_join=True,
            can_subscribe=True,
            can_publish=True,
        ))
    )

    # Broadcast status update
    try:
        from core.events.call_broadcaster import CallBroadcaster
        broadcaster = CallBroadcaster.get()
        await broadcaster.publish(
            event_type="call-updated",
            call_id=call_id,
            call={"id": call_id, "status": "in_progress"},
        )
        await broadcaster.publish(
            event_type="call-answered",
            call_id=call_id,
            call={"id": call_id, "status": "in_progress"},
        )
    except Exception as e:
        logger.warning("Failed to emit call-answered event: %s", e)

    return {
        "call_id": call_id,
        "room_name": room_name,
        "token": token.to_jwt(),
        "url": livekit_url,
    }
