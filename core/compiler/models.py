from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field

from core.models.field_defs import FieldType, FieldConstraints


@dataclass
class FieldSpec:
    """Field definition extracted from a collect node."""
    id: str
    label: str
    field_type: FieldType
    constraints: FieldConstraints
    cell_ref: str
    prompt_hint: str
    retry_limit: int = 3
    options: list[str] = field(default_factory=list)


@dataclass
class CompiledFlowSpec:
    """Output of FlowCompiler -- everything the runtime agent needs."""
    flow_id: str
    system_prompt: str
    fields: list[FieldSpec]
    cell_mapping: dict[str, str]
    excel_template: str
    excel_output: str
    language: str = "vi"
    max_retries: int = 3
    scenario: str = ""

    def _field_spec_to_dict(self, fs: FieldSpec) -> dict:
        """Serialize a single FieldSpec to a plain dict."""
        return {
            "id": fs.id,
            "label": fs.label,
            "field_type": fs.field_type.value,
            "constraints": fs.constraints.model_dump(),
            "cell_ref": fs.cell_ref,
            "prompt_hint": fs.prompt_hint,
            "retry_limit": fs.retry_limit,
            "options": list(fs.options),
        }

    def to_dict(self) -> dict:
        """Serialize to dict, converting enums and Pydantic models."""
        return {
            "flow_id": self.flow_id,
            "system_prompt": self.system_prompt,
            "fields": [self._field_spec_to_dict(f) for f in self.fields],
            "cell_mapping": dict(self.cell_mapping),
            "excel_template": self.excel_template,
            "excel_output": self.excel_output,
            "language": self.language,
            "max_retries": self.max_retries,
            "scenario": self.scenario,
        }

    @classmethod
    def from_dict(cls, data: dict) -> CompiledFlowSpec:
        """Reconstruct from a dict."""
        fields = []
        for f in data.get("fields", []):
            constraints_raw = f["constraints"]
            if isinstance(constraints_raw, FieldConstraints):
                constraints = constraints_raw
            else:
                constraints = FieldConstraints(**constraints_raw)
            field_type_raw = f["field_type"]
            if isinstance(field_type_raw, FieldType):
                ft = field_type_raw
            else:
                ft = FieldType(field_type_raw)
            fields.append(FieldSpec(
                id=f["id"],
                label=f["label"],
                field_type=ft,
                constraints=constraints,
                cell_ref=f["cell_ref"],
                prompt_hint=f["prompt_hint"],
                retry_limit=f.get("retry_limit", 3),
                options=f.get("options", []),
            ))
        return cls(
            flow_id=data["flow_id"],
            system_prompt=data["system_prompt"],
            fields=fields,
            cell_mapping=data["cell_mapping"],
            excel_template=data["excel_template"],
            excel_output=data["excel_output"],
            language=data.get("language", "vi"),
            max_retries=data.get("max_retries", 3),
            scenario=data.get("scenario", ""),
        )
