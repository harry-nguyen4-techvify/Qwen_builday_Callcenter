from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field

from .field_defs import FieldType, FieldConstraints


# ---------------------------------------------------------------------------
# Position
# ---------------------------------------------------------------------------

class NodePosition(BaseModel):
    x: float
    y: float


# ---------------------------------------------------------------------------
# Base node (shared fields, not instantiated directly)
# ---------------------------------------------------------------------------

class BaseNode(BaseModel):
    id: str
    name: str
    position: NodePosition
    prompt: str = ""
    outputs: list[str] = []


# ---------------------------------------------------------------------------
# Config models — one per node type
# ---------------------------------------------------------------------------

class StartConfig(BaseModel):
    flow_name: str = ""
    language: str = "en"


class GreetingConfig(BaseModel):
    pass


class CollectConfig(BaseModel):
    field_id: str
    field_type: FieldType = FieldType.TEXT
    cell: str = ""
    validation: FieldConstraints = FieldConstraints()
    retry_limit: int = 3
    options: list[str] = []
    required: bool = True


class ConditionConfig(BaseModel):
    field_id: str
    operator: Literal["eq", "ne", "gt", "lt", "in", "regex", "exists"] = "eq"
    value: str | None = None
    prompt_eval: bool = False
    prompt_eval_question: str = ""


class SwitchCase(BaseModel):
    match: str
    output_port: str


class SwitchConfig(BaseModel):
    field_id: str
    cases: list[SwitchCase] = []
    default_output: str = "default"


class EscalateConfig(BaseModel):
    reason_template: str = ""
    notify_log: bool = True


class SummaryConfig(BaseModel):
    pass


class ConfirmConfig(BaseModel):
    summary_fields: list[str] = []
    confirm_port: str = "confirmed"
    reject_port: str = "rejected"


class FillExcelConfig(BaseModel):
    template_path: str = ""
    output_path: str = ""


class PromptConfig(BaseModel):
    pass


class SetFieldConfig(BaseModel):
    field_id: str
    value_expr: str = ""


class GotoConfig(BaseModel):
    target_node_id: str


class EndConfig(BaseModel):
    pass


# ---------------------------------------------------------------------------
# Node types — each carries a Literal "type" discriminator field
# ---------------------------------------------------------------------------

class StartNode(BaseNode):
    type: Literal["start"] = "start"
    config: StartConfig = StartConfig()


class GreetingNode(BaseNode):
    type: Literal["greeting"] = "greeting"
    config: GreetingConfig = GreetingConfig()


class CollectNode(BaseNode):
    type: Literal["collect"] = "collect"
    config: CollectConfig


class ConditionNode(BaseNode):
    type: Literal["condition"] = "condition"
    config: ConditionConfig


class SwitchNode(BaseNode):
    type: Literal["switch"] = "switch"
    config: SwitchConfig


class EscalateNode(BaseNode):
    type: Literal["escalate"] = "escalate"
    config: EscalateConfig = EscalateConfig()


class SummaryNode(BaseNode):
    type: Literal["summary"] = "summary"
    config: SummaryConfig = SummaryConfig()


class ConfirmNode(BaseNode):
    type: Literal["confirm"] = "confirm"
    config: ConfirmConfig = ConfirmConfig()


class FillExcelNode(BaseNode):
    type: Literal["fill_excel"] = "fill_excel"
    config: FillExcelConfig = FillExcelConfig()


class PromptNode(BaseNode):
    type: Literal["prompt"] = "prompt"
    config: PromptConfig = PromptConfig()


class SetFieldNode(BaseNode):
    type: Literal["set_field"] = "set_field"
    config: SetFieldConfig


class GotoNode(BaseNode):
    type: Literal["goto"] = "goto"
    config: GotoConfig


class EndNode(BaseNode):
    type: Literal["end"] = "end"
    config: EndConfig = EndConfig()


# ---------------------------------------------------------------------------
# Discriminated union over all 13 node types
# ---------------------------------------------------------------------------

AnyNode = Annotated[
    Union[
        StartNode,
        GreetingNode,
        CollectNode,
        ConditionNode,
        SwitchNode,
        EscalateNode,
        SummaryNode,
        ConfirmNode,
        FillExcelNode,
        PromptNode,
        SetFieldNode,
        GotoNode,
        EndNode,
    ],
    Field(discriminator="type"),
]
