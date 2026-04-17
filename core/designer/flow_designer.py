"""
FlowDesigner — design-time module that calls an OpenAI-compatible LLM
(e.g. Qwen via DashScope) to generate and refine FlowModel graphs.

Does NOT import anything from core/runtime/.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime

import openai
from pydantic import ValidationError

from core.models.field_defs import FieldDefinition
from core.models.flow import FlowModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt — module-level constant (single allocation, never recreated)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an expert conversation flow designer for voice agents that collect form data.
Task: given a list of form fields and a user persona prompt, output a complete flow JSON that guides a voice agent to ask questions and fill an Excel form.

=== REQUIRED JSON STRUCTURE ===
{
  "flow_id": "<slug>",
  "name": "<flow name>",
  "nodes": [...],
  "edges": [...],
  "cell_mapping": {"field_id": "cell_ref"},
  "settings": {"language": "en", "max_retries": 3, "tts_voice": "", "domain": "<short domain keyword, e.g. healthcare, banking, restaurant>", "agent_prompt": "<one sentence describing agent personality and role>"},
  "created_at": "<ISO8601>",
  "version": 1
}

=== NODE STRUCTURE (every node) ===
{
  "id": "node_<snake_case_name>",
  "type": "<node_type>",
  "name": "<Human readable name>",
  "position": {"x": <number>, "y": <number>},
  "prompt": "<English instruction for the runtime LLM>",
  "outputs": ["<port1>", "<port2>"],
  "config": { ... }
}

=== NODE TYPES (13 types) ===

1. start — entry point, always first node
   outputs: ["next"]
   config: {"flow_name": "Registration Form", "language": "en"}
   prompt: ""

2. greeting — opening message spoken to caller
   outputs: ["next"]
   config: {}
   prompt: a SHORT INTENT describing what the greeting should convey (NOT a script)
   prompt example: "Greet the user, introduce yourself as a bank assistant, ask if they are ready to provide information"

3. collect — collect exactly one form field from the caller
   outputs: ["collected", "retry", "escalate"]
   config: {
     "field_id": "full_name",
     "field_type": "text",
     "cell": "B3",
     "validation": {"required": true, "min_length": 2},
     "retry_limit": 3
   }
   prompt: a SHORT INTENT describing what information to collect and any relevant context (NOT a script)
   prompt example: "Ask for the user's full legal name as it appears on their ID"
   IMPORTANT: collect nodes MUST have a "retry" edge looping back to themselves
   IMPORTANT: collect nodes MUST have an "escalate" edge to an escalate node

4. condition — binary branch based on field value or LLM evaluation
   outputs: ["yes", "no"]
   config: {
     "field_id": "age",
     "operator": "gt",
     "value": "18",
     "prompt_eval": false
   }
   prompt: ""

5. switch — multi-way branch based on a field value
   outputs: ["<case_value_1>", "<case_value_2>", "default"]
   config: {
     "field_id": "patient_type",
     "cases": [
       {"match": "Inpatient", "output_port": "inpatient"},
       {"match": "Outpatient", "output_port": "outpatient"}
     ],
     "default_output": "default"
   }
   prompt: ""

6. escalate — transfer call to a human agent
   outputs: ["next"]
   config: {"reason_template": "User requested human assistance after too many retries.", "notify_log": true}
   prompt: a SHORT INTENT for the handoff message
   prompt example: "Apologize and inform user they are being transferred to a human agent"

7. summary — read back all collected data to the caller
   outputs: ["next"]
   config: {}
   prompt: a SHORT INTENT describing what to summarize
   prompt example: "Summarize all collected information and ask user to review"

8. confirm — ask caller to confirm collected data before submission
   outputs: ["confirmed", "rejected"]
   config: {"summary_fields": ["full_name", "date_of_birth", "phone"], "confirm_port": "confirmed", "reject_port": "rejected"}
   prompt: a SHORT INTENT for the confirmation step
   prompt example: "Ask user if the summarized information is correct and ready for submission"

9. fill_excel — write collected data to an Excel file
   outputs: ["done", "error"]
   config: {"template_path": "templates/{flow_id}.xlsx", "output_path": "filled/{flow_id}_{session_id}.xlsx"}
   prompt: ""

10. prompt — free-form announcement or instruction (no data collection)
    outputs: ["next"]
    config: {}
    prompt: a SHORT INTENT describing what to convey to the user
    prompt example: "Inform the user their reservation is confirmed for Monday at 7pm"

11. set_field — assign a computed or literal value to a field programmatically
    outputs: ["next"]
    config: {"field_id": "status", "value_expr": "confirmed"}
    prompt: ""

12. goto — unconditional jump to another node (used for looping)
    outputs: []
    config: {"target_node_id": "node_collect_full_name"}
    prompt: ""

13. end — end the conversation
    outputs: []
    config: {}
    prompt: a SHORT INTENT for the closing message
    prompt example: "Thank the user, confirm submission was successful, say goodbye"

=== EDGE FORMAT ===
Every edge must follow this exact structure:
{"id": "e1", "source": "node_id_A", "target": "node_id_B", "output": "port_name"}

IMPORTANT: Use "source" and "target" — NOT "from" or "to".
Edge "output" must match one of the source node's outputs ports exactly.

=== POSITIONING RULES ===
- Layout top-to-bottom with approximately 150px vertical spacing between nodes
- Start node at {"x": 400, "y": 0}
- Each subsequent node increases y by 150
- Side branches (escalate nodes) offset x by +300

=== CELL MAPPING ===
Map each collected field_id to its Excel cell reference:
{"full_name": "B3", "date_of_birth": "B5", "phone": "B7"}

=== MANDATORY RULES ===
- Flow MUST start with a "start" node and end with an "end" node
- Every "collect" node MUST have exactly one "retry" edge looping back to itself
- Every "collect" node MUST have exactly one "escalate" edge pointing to an escalate node
- Every "collect" node MUST have a "collected" edge pointing forward
- All node "id" values must be unique snake_case strings, e.g.: "node_collect_full_name"
- The "type" field in each node must be exactly one of the 13 types listed above

=== PROMPT STYLE (CRITICAL) ===
- Node "prompt" fields are INTENT DESCRIPTIONS, NOT scripts to read aloud.
- Write prompts as short guidance: WHAT to convey, not HOW to say it.
- The runtime agent will interpret these intents and speak naturally in the flow language.
- ALL intent prompts MUST be written in ENGLISH, regardless of the flow language. The runtime agent will adapt them.
- BAD: "Xin chào! Tôi là Ngọc, nhân viên ngân hàng. Vui lòng cho tôi biết họ và tên."
- GOOD: "Greet user, introduce as bank staff, ask for full legal name"
- BAD: "Vui lòng nói 'có' hoặc 'không'"
- GOOD: "Ask user to confirm the information is correct"
- Keep prompts under 20 words.

=== EXAMPLE FLOW (minimal) ===
A flow collecting full_name and phone:
- node_start (start) → node_greeting
- node_greeting (greeting) → node_collect_full_name
- node_collect_full_name (collect, field_id="full_name") → collected: node_collect_phone, retry: node_collect_full_name, escalate: node_escalate
- node_collect_phone (collect, field_id="phone") → collected: node_confirm, retry: node_collect_phone, escalate: node_escalate
- node_confirm (confirm) → confirmed: node_fill_excel, rejected: node_collect_full_name
- node_fill_excel (fill_excel) → done: node_end, error: node_escalate
- node_escalate (escalate) → next: node_end
- node_end (end)

Return ONLY the JSON object, no explanation, no markdown wrapper."""


# ---------------------------------------------------------------------------
# Exception
# ---------------------------------------------------------------------------

class FlowDesignError(Exception):
    """Raised when the LLM returns output that cannot be parsed/validated."""

    def __init__(self, message: str, raw_response: str = "") -> None:
        super().__init__(message)
        self.raw_response = raw_response


# ---------------------------------------------------------------------------
# FlowDesigner
# ---------------------------------------------------------------------------

class FlowDesigner:
    """Design-time class: calls an OpenAI-compatible LLM to generate FlowModel."""

    def __init__(self) -> None:
        api_key = os.environ.get("FLOW_DESIGNER_API_KEY")
        base_url = os.environ.get("FLOW_DESIGNER_BASE_URL")
        model = os.environ.get("FLOW_DESIGNER_MODEL")

        missing = [
            name
            for name, val in [
                ("FLOW_DESIGNER_API_KEY", api_key),
                ("FLOW_DESIGNER_BASE_URL", base_url),
                ("FLOW_DESIGNER_MODEL", model),
            ]
            if not val
        ]
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}"
            )

        self._model: str = model  # type: ignore[assignment]
        self._client = openai.AsyncOpenAI(base_url=base_url, api_key=api_key)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_fences(raw: str) -> str:
        """Remove markdown code fences that some LLMs emit despite instructions."""
        return (
            raw.strip()
            .removeprefix("```json")
            .removeprefix("```")
            .removesuffix("```")
            .strip()
        )

    async def _call_and_validate(self, messages: list[dict]) -> FlowModel:
        """Call the LLM and validate the response as a FlowModel.

        Attempts up to 2 times. On first failure appends an error hint and
        retries. On second failure raises FlowDesignError.
        """
        raw = ""
        for attempt in range(2):
            start_time = asyncio.get_event_loop().time()
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.3,
            )
            elapsed = asyncio.get_event_loop().time() - start_time
            raw = resp.choices[0].message.content or ""
            tokens = resp.usage.total_tokens if resp.usage else 0
            logger.debug(
                "FlowDesigner LLM call attempt=%d: %.2fs, tokens=%d",
                attempt + 1,
                elapsed,
                tokens,
            )

            try:
                cleaned = self._strip_fences(raw)
                data = json.loads(cleaned)
                return FlowModel.model_validate(data)
            except (json.JSONDecodeError, ValidationError) as exc:
                if attempt == 1:
                    raise FlowDesignError(str(exc), raw_response=raw) from exc
                # First failure: give the LLM a correction hint and retry
                messages = list(messages)  # shallow copy to avoid mutating caller's list
                messages.append({"role": "assistant", "content": raw})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"The JSON you returned was invalid: {exc}. "
                            "Please fix all issues and return valid JSON only, "
                            "with no markdown wrapper."
                        ),
                    }
                )

        # Unreachable — loop always raises or returns above
        raise FlowDesignError("Unexpected exit from retry loop", raw_response=raw)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def design(
        self,
        field_defs: list[FieldDefinition],
        user_prompt: str,
        template_raw: str = "",
    ) -> FlowModel:
        """Generate a new FlowModel from field definitions and a user prompt."""
        # Cap template_raw to avoid token limit issues
        capped_template = template_raw[:3000] if template_raw else ""

        messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Fields to collect:\n"
                    f"{json.dumps([fd.model_dump() for fd in field_defs], indent=2)}\n\n"
                    "Excel structure:\n"
                    f"{capped_template}\n\n"
                    "User persona / requirements:\n"
                    f"{user_prompt}\n\n"
                    "Generate the complete flow JSON."
                ),
            },
        ]

        flow = await self._call_and_validate(messages)

        if not flow.created_at:
            flow.created_at = datetime.utcnow().isoformat()

        return flow

    async def refine(
        self,
        current_flow: FlowModel,
        user_feedback: str,
    ) -> FlowModel:
        """Refine an existing flow based on user feedback.

        Increments version and preserves the original flow_id.
        """
        messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Current flow:\n"
                    f"{current_flow.model_dump_json(indent=2)}\n\n"
                    "Requested changes:\n"
                    f"{user_feedback}\n\n"
                    "Return the complete updated flow JSON."
                ),
            },
        ]

        flow = await self._call_and_validate(messages)

        # Always preserve original identity and bump version
        flow.flow_id = current_flow.flow_id
        flow.version = current_flow.version + 1

        return flow
