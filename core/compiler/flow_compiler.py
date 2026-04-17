"""
FlowCompiler — converts a FlowModel (node graph) into a CompiledFlowSpec.

The compiler extracts structured field definitions from collect nodes,
excel configuration from fill_excel nodes, and then calls an LLM to
generate a domain-rich system prompt that the PromptFormAgent will use
at runtime.

Usage:
    compiler = FlowCompiler()
    spec = await compiler.compile(flow)
"""

from __future__ import annotations

import logging
import os

from core.models.flow import FlowModel
from core.compiler.models import FieldSpec, CompiledFlowSpec

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Scenario-specific post-injection — deterministic guidance appended to the
# LLM-generated system prompt so runtime tool behavior stays consistent.
# ---------------------------------------------------------------------------


_REPORT_LOST_CARD_GUIDANCE = """

[KỊCH BẢN: BÁO MẤT THẺ — QUY TẮC BẮT BUỘC]

Bạn có 3 tool bổ sung chỉ dùng cho kịch bản này:
- check_credential(cccd, full_name, card_last4): Tra cứu dữ liệu thẻ. Trả về is_true_credential True/False.
- lock_card(cccd): Khóa thẻ. CHỈ gọi sau khi check_credential trả về True.
- escalate(reason): Chuyển sang nhân viên hỗ trợ. Tự động bật nhạc chờ.

LUỒNG XÁC MINH (BẮT BUỘC):
1. Chào khách rồi lần lượt thu thập 3 trường qua fill_field: cccd, full_name, card_last4.
2. Sau khi đủ 3 trường, đọc lại ngắn gọn để khách xác nhận, sau đó gọi check_credential.
3. Nếu is_true_credential là True: nói Em xác minh xong rồi, em sẽ khóa thẻ ngay ạ, gọi lock_card(cccd), thông báo đã khóa xong, rồi tạm biệt.
4. Nếu is_true_credential là False: xin lỗi, nói Em xin anh chị đọc lại giúp em một lần nữa, xóa lại 3 trường và thu thập lại từ đầu.
5. Nếu sau lần thử lại lần 2 mà check_credential vẫn là False: nói Xin lỗi anh chị, em sẽ chuyển máy tới nhân viên hỗ trợ ngay ạ, rồi gọi escalate(reason equals credential verification failed twice). Sau đó giữ im lặng chờ nhân viên.
6. Nếu khách chủ động yêu cầu gặp nhân viên bất kỳ lúc nào: gọi escalate(reason equals user requested human).

RÀNG BUỘC BẢO MẬT:
- TUYỆT ĐỐI không đọc lại toàn bộ số CCCD hoặc số thẻ. Chỉ xác nhận 4 số cuối CCCD và 4 số cuối thẻ khi cần.
- KHÔNG gọi lock_card nếu check_credential chưa trả True.
- KHÔNG gọi submit_form trong kịch bản này. Hoàn tất bằng cách nói tạm biệt.
"""


def _inject_scenario_guidance(system_prompt: str, scenario: str) -> str:
    """Append deterministic scenario-specific rules after the LLM-generated prompt."""
    scenario = (scenario or "").strip()
    if scenario == "report_lost_card":
        return system_prompt.rstrip() + _REPORT_LOST_CARD_GUIDANCE
    return system_prompt


class FlowCompiler:
    """Compiles a FlowModel (node graph) into a CompiledFlowSpec (prompt + fields)."""

    def __init__(self) -> None:
        api_key = os.environ.get("FLOW_DESIGNER_API_KEY")
        base_url = os.environ.get("FLOW_DESIGNER_BASE_URL")
        model = os.environ.get("FLOW_DESIGNER_MODEL")
        missing = [
            name for name, val in [
                ("FLOW_DESIGNER_API_KEY", api_key),
                ("FLOW_DESIGNER_BASE_URL", base_url),
                ("FLOW_DESIGNER_MODEL", model),
            ] if not val
        ]
        if missing:
            raise RuntimeError(f"Missing env vars: {', '.join(missing)}")

        from openai import AsyncOpenAI
        self._model: str = model  # type: ignore[assignment]
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def compile(self, flow: FlowModel) -> CompiledFlowSpec:
        """
        Compile a JSON flow into a runtime-ready CompiledFlowSpec.

        Steps:
          1. Extract fields from collect nodes
          2. Extract excel config from fill_excel node
          3. Build human-readable flow description
          4. Extract branching rules from condition/switch nodes
          5. Generate domain-rich system prompt via LLM
        """
        fields = self._extract_fields(flow)
        excel_template, excel_output = self._extract_excel_config(flow)
        node_descriptions = self._describe_flow(flow)
        branching_rules = self._extract_branching_rules(flow)

        logger.info(
            "Compiling flow '%s': %d fields, template=%s",
            flow.flow_id, len(fields), excel_template or "(none)",
        )

        system_prompt = await self._generate_prompt(
            flow, fields, node_descriptions, branching_rules,
        )

        # Append deterministic scenario guidance to keep runtime tool behavior
        # consistent even if the LLM drifts.
        system_prompt = _inject_scenario_guidance(system_prompt, flow.settings.scenario)

        return CompiledFlowSpec(
            flow_id=flow.flow_id,
            system_prompt=system_prompt,
            fields=fields,
            cell_mapping=flow.cell_mapping,
            excel_template=excel_template,
            excel_output=excel_output,
            language=flow.settings.language,
            max_retries=flow.settings.max_retries,
            scenario=flow.settings.scenario,
        )

    # ------------------------------------------------------------------
    # Field extraction
    # ------------------------------------------------------------------

    def _extract_fields(self, flow: FlowModel) -> list[FieldSpec]:
        """Extract FieldSpec from every collect node, preserving edge order."""
        # Build adjacency for edge-order traversal
        edges = {(e.source, e.output): e.target for e in flow.edges}
        nodes = {n.id: n for n in flow.nodes}

        # Build outgoing map: node_id -> [target_id, ...]
        outgoing: dict[str, list[str]] = {}
        for e in flow.edges:
            outgoing.setdefault(e.source, []).append(e.target)

        # BFS from start to find collect nodes in flow order
        ordered_collect_ids: list[str] = []
        start = next((n for n in flow.nodes if n.type == "start"), None)
        if start:
            from collections import deque
            visited: set[str] = set()
            queue: deque[str] = deque([start.id])
            while queue:
                current_id = queue.popleft()
                if current_id in visited:
                    continue
                visited.add(current_id)
                node = nodes.get(current_id)
                if not node:
                    continue
                if node.type == "collect":
                    ordered_collect_ids.append(current_id)
                # Follow ALL actual edges (handles goto, condition, switch, etc.)
                for target in outgoing.get(current_id, []):
                    if target not in visited:
                        queue.append(target)

        # Build FieldSpec list in discovered order, then append any
        # collect nodes not reachable from start (shouldn't happen, but safe).
        seen_ids: set[str] = set()
        fields: list[FieldSpec] = []

        for nid in ordered_collect_ids:
            node = nodes[nid]
            if nid in seen_ids:
                continue
            seen_ids.add(nid)
            cfg = node.config
            fields.append(FieldSpec(
                id=cfg.field_id,
                label=node.name,
                field_type=cfg.field_type,
                constraints=cfg.validation,
                cell_ref=cfg.cell,
                prompt_hint=node.prompt,
                retry_limit=cfg.retry_limit,
                options=cfg.options,
            ))

        # Catch any orphan collect nodes
        for node in flow.nodes:
            if node.type == "collect" and node.id not in seen_ids:
                cfg = node.config
                fields.append(FieldSpec(
                    id=cfg.field_id,
                    label=node.name,
                    field_type=cfg.field_type,
                    constraints=cfg.validation,
                    cell_ref=cfg.cell,
                    prompt_hint=node.prompt,
                    retry_limit=cfg.retry_limit,
                    options=cfg.options,
                ))

        return fields

    # ------------------------------------------------------------------
    # Excel config extraction
    # ------------------------------------------------------------------

    def _extract_excel_config(self, flow: FlowModel) -> tuple[str, str]:
        """Find the first fill_excel node and extract template/output paths."""
        for node in flow.nodes:
            if node.type == "fill_excel":
                return node.config.template_path, node.config.output_path
        return "", ""

    # ------------------------------------------------------------------
    # Flow description (human-readable)
    # ------------------------------------------------------------------

    def _describe_flow(self, flow: FlowModel) -> str:
        """Create a human-readable description via DFS, including branches."""
        # Build outgoing edges: node_id -> [(port, target_id), ...]
        outgoing: dict[str, list[tuple[str, str]]] = {}
        for e in flow.edges:
            outgoing.setdefault(e.source, []).append((e.output, e.target))
        nodes = {n.id: n for n in flow.nodes}

        start = next((n for n in flow.nodes if n.type == "start"), None)
        if not start:
            return ""

        lines: list[str] = []
        visited: set[str] = set()

        def _describe_node(node) -> str:
            t = node.type
            if t == "start":
                return f"Start: {node.config.flow_name or flow.name}"
            if t == "greeting":
                return f"Greeting (intent: {node.prompt})"
            if t == "collect":
                return f"Collect '{node.name}' ({node.config.field_id}) — intent: {node.prompt}"
            if t == "summary":
                return f"Summarize (intent: {node.prompt})" if node.prompt else "Summarize all collected data and ask user to review"
            if t == "confirm":
                return f"Confirm (intent: {node.prompt})" if node.prompt else "Ask user to confirm the summary is correct"
            if t == "end":
                return f"End conversation (intent: {node.prompt})"
            if t == "prompt":
                return f"Convey to user (intent: {node.prompt})"
            if t == "fill_excel":
                return "Fill Excel template"
            if t == "escalate":
                return f"Transfer to human (intent: {node.prompt})"
            if t == "set_field":
                return f"Set {node.config.field_id} = {node.config.value_expr}"
            return f"{t} (intent: {node.prompt})"

        def _walk(node_id: str, indent: int) -> None:
            if node_id in visited:
                return
            visited.add(node_id)
            node = nodes.get(node_id)
            if not node:
                return

            prefix = "  " * indent + "- "

            # Condition/switch: describe branches inline
            if node.type == "condition":
                cfg = node.config
                question = cfg.prompt_eval_question or f"{cfg.field_id} {cfg.operator} '{cfg.value}'"
                lines.append(f"{prefix}Condition: {question}")
                for port, target_id in outgoing.get(node_id, []):
                    lines.append(f"  {prefix}If {port}:")
                    _walk(target_id, indent + 2)
                return

            if node.type == "switch":
                cfg = node.config
                lines.append(f"{prefix}Switch on {cfg.field_id}:")
                for port, target_id in outgoing.get(node_id, []):
                    lines.append(f"  {prefix}Case '{port}':")
                    _walk(target_id, indent + 2)
                return

            lines.append(f"{prefix}{_describe_node(node)}")

            # Follow all outgoing edges; skip retry self-loops
            targets = outgoing.get(node_id, [])
            non_loop = [
                (port, tid) for port, tid in targets
                if tid != node_id and port not in ("retry",)
            ]

            if len(non_loop) == 1:
                _walk(non_loop[0][1], indent)
            elif len(non_loop) > 1:
                for port, tid in non_loop:
                    if tid in visited:
                        # Already-visited target (e.g. confirm→rejected loops back)
                        target_node = nodes.get(tid)
                        label = target_node.name if target_node else tid
                        lines.append(f"  {prefix}[If {port}: go back to '{label}']")
                    else:
                        _walk(tid, indent)

        _walk(start.id, 0)

        # Append any unvisited escalate nodes
        for node in flow.nodes:
            if node.type == "escalate" and node.id not in visited:
                lines.append(f"- {_describe_node(node)}")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Branching rules extraction
    # ------------------------------------------------------------------

    def _extract_branching_rules(self, flow: FlowModel) -> str:
        """Convert condition/switch nodes to natural language rules with branch content."""
        edges = {(e.source, e.output): e.target for e in flow.edges}
        nodes = {n.id: n for n in flow.nodes}

        # Build outgoing map for forward walks
        outgoing: dict[str, list[tuple[str, str]]] = {}
        for e in flow.edges:
            outgoing.setdefault(e.source, []).append((e.output, e.target))

        def _first_prompt_on_path(start_id: str) -> str:
            """Walk forward from start_id to find the first node with a prompt."""
            visited_inner: set[str] = set()
            current = start_id
            while current and current not in visited_inner:
                visited_inner.add(current)
                node = nodes.get(current)
                if not node:
                    break
                if node.prompt:
                    return node.prompt
                # Follow first actual edge
                targets = outgoing.get(current, [])
                found = False
                for _, tgt in targets:
                    if tgt not in visited_inner:
                        current = tgt
                        found = True
                        break
                if not found:
                    break
            return "(no content)"

        rules: list[str] = []
        for node in flow.nodes:
            if node.type == "condition":
                cfg = node.config
                question = cfg.prompt_eval_question or f"{cfg.field_id} {cfg.operator} '{cfg.value}'"
                yes_target = edges.get((node.id, "yes"))
                no_target = edges.get((node.id, "no"))
                yes_text = _first_prompt_on_path(yes_target) if yes_target else "(no path)"
                no_text = _first_prompt_on_path(no_target) if no_target else "(no path)"
                rules.append(
                    f"- Condition: {question}\n"
                    f"  If YES: \"{yes_text}\"\n"
                    f"  If NO: \"{no_text}\""
                )
            elif node.type == "switch":
                cfg = node.config
                case_lines = []
                for case in cfg.cases:
                    target = edges.get((node.id, case.output_port))
                    text = _first_prompt_on_path(target) if target else "(no path)"
                    case_lines.append(f"  If {cfg.field_id} = '{case.match}': \"{text}\"")
                default_target = edges.get((node.id, cfg.default_output))
                if default_target:
                    text = _first_prompt_on_path(default_target)
                    case_lines.append(f"  Default: \"{text}\"")
                rules.append(
                    f"- Switch on {cfg.field_id}:\n" + "\n".join(case_lines)
                )
            elif node.type == "confirm":
                reject_target = edges.get((node.id, "rejected"))
                if reject_target:
                    target_node = nodes.get(reject_target)
                    label = target_node.name if target_node else reject_target
                    rules.append(
                        f"- If user rejects confirmation: go back to '{label}' and re-collect"
                    )
        return "\n".join(rules) if rules else "None"

    # ------------------------------------------------------------------
    # LLM-based prompt generation
    # ------------------------------------------------------------------

    async def _generate_prompt(
        self,
        flow: FlowModel,
        fields: list[FieldSpec],
        node_descriptions: str,
        branching_rules: str,
    ) -> str:
        """Call LLM to generate a domain-rich system prompt."""

        field_descriptions = "\n".join(
            f"- {f.id} ({f.label}): type={f.field_type.value}, "
            f"intent=\"{f.prompt_hint}\", "
            f"required={f.constraints.required}, "
            f"retry_limit={f.retry_limit}"
            + (f", options={f.options}" if f.options else "")
            + (
                f", date_format={f.constraints.date_format}"
                if f.field_type.value == "date"
                else ""
            )
            for f in fields
        )

        lang_map = {
            "vi": "Vietnamese",
            "en": "English",
            "ja": "Japanese",
            "ko": "Korean",
            "zh": "Chinese",
        }
        lang_name = lang_map.get(flow.settings.language, flow.settings.language)

        user_message = (
            "You are a prompt engineer. Generate a comprehensive system prompt "
            "for a voice form-filling agent.\n\n"
            f"Flow name: {flow.name}\n"
            f"Domain: {flow.settings.domain or 'general'}\n"
            f"Language: {lang_name} ({flow.settings.language})\n"
            f"Agent personality: "
            f"{flow.settings.agent_prompt or 'professional and friendly voice assistant'}\n\n"
            f"Flow steps:\n{node_descriptions}\n\n"
            f"Fields to collect (in order):\n{field_descriptions}\n\n"
            f"Branching rules:\n{branching_rules}\n\n"
            "The agent has these tools:\n"
            "- fill_field(field_id, value): Record a validated field value\n"
            "- confirm_data(): Mark data as confirmed after user agrees\n"
            "- submit_form(): Submit the completed form "
            "(requires all fields + confirmation)\n"
            "- escalate(reason): Transfer to human support\n\n"
            f"Generate a system prompt in {lang_name} that:\n"
            f'1. Establishes deep domain knowledge specific to '
            f'"{flow.settings.domain or "general"}" -- NOT generic\n'
            f"2. Defines personality and natural conversation style in {lang_name}\n"
            "3. For each field, describe the INTENT and context (what info is needed, "
            "why, acceptable formats). Do NOT copy the prompt text verbatim as a script. "
            "The agent must speak NATURALLY and conversationally, like a real human -- "
            "not read a script or give commands like 'Vui lòng nói có hoặc không'\n"
            "4. Specifies the flow: greet -> collect each field -> "
            "summarize -> confirm -> submit\n"
            "5. Includes rules for: user corrections, off-topic handling, "
            "unclear answers, escalation\n"
            "6. CRITICAL: Instructs the agent to call fill_field after EACH "
            "answer, confirm_data after user confirms summary, submit_form "
            "only after confirm_data\n"
            "7. CRITICAL: The agent must NEVER skip calling tools -- every "
            "field value MUST go through fill_field\n"
            "8. CRITICAL LATENCY RULE: The agent must NEVER call a tool silently. "
            "Before EVERY tool call, the agent MUST say a brief natural acknowledgment "
            "(under 10 words) so the user hears a response immediately while the tool executes. "
            "Examples: 'Vâng, em ghi nhận ạ.', 'Được rồi ạ.', 'Dạ em lưu lại nhé.' "
            "Vary naturally, never repeat the same phrase twice in a row.\n\n"
            "IMPORTANT STYLE RULES:\n"
            "- The prompt texts in 'Flow steps' and 'Fields' above are INTENT DESCRIPTIONS "
            "from a flow designer, NOT scripts to read aloud.\n"
            "- The agent must NEVER read prompts verbatim. Instead, understand the intent "
            "and express it naturally, like a real person having a conversation.\n"
            "- BAD: 'Vui lòng cho biết họ và tên đầy đủ của mình?'\n"
            "- GOOD: Guide the agent to naturally ask for the user's full name in context, "
            "e.g. after greeting, smoothly transition to 'Cho em xin tên đầy đủ của anh/chị nhé'\n"
            "- The agent should sound warm, human, and adaptive -- not like a form being read aloud.\n"
            "- CRITICAL: This is a VOICE agent using TTS. The system prompt MUST instruct the agent "
            "to output PLAIN TEXT ONLY with NO special characters. "
            "Forbidden characters that TTS reads literally: / () * : # - ** bullet points, numbered lists. "
            "The agent must NEVER use colons, slashes, parentheses, or asterisks in its speech. "
            "Instead of 'Họ tên: Nguyễn Văn A' say 'Họ tên là Nguyễn Văn A'. "
            "Instead of '15/09/1990' say '15 tháng 9 năm 1990'. "
            "Instead of 'CCCD: 070809112233' say 'Số căn cước công dân là 070809112233'. "
            "Replace ALL colons with the word 'là', ALL date slashes with 'tháng' and 'năm', "
            "and remove ALL parentheses and asterisks. This applies everywhere including "
            "when summarizing data back to the user.\n\n"
            "Output ONLY the system prompt text in plain text, nothing else."
        )

        try:
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": user_message}],
                temperature=0.7,
            )
            prompt_text = response.choices[0].message.content.strip()
            logger.info(
                "Generated system prompt for '%s' (%d chars)",
                flow.flow_id, len(prompt_text),
            )
            return prompt_text
        except Exception:
            logger.exception("LLM call failed during flow compilation")
            raise
