from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from core.models.flow import FlowModel


class FlowStore:
    """Persistent JSON store for FlowModel objects with versioning support."""

    def __init__(self, base_dir: str | Path = ".") -> None:
        self._base = Path(base_dir)
        self.flows_dir = self._base / "flows"
        self.templates_dir = self._base / "templates"
        self.filled_dir = self._base / "filled"

        for d in (self.flows_dir, self.templates_dir, self.filled_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save(self, flow: FlowModel) -> Path:
        """Serialize flow to JSON and atomically write to flows/<flow_id>.json."""
        dest = self.flows_dir / f"{flow.flow_id}.json"
        tmp = dest.with_suffix(".tmp")
        json_text = flow.model_dump_json(indent=2)
        tmp.write_text(json_text, encoding="utf-8")
        os.replace(str(tmp), str(dest))
        return dest

    def load(self, flow_id: str) -> FlowModel:
        """Read and validate flows/<flow_id>.json, returning a FlowModel."""
        src = self.flows_dir / f"{flow_id}.json"
        if not src.exists():
            raise FileNotFoundError(f"Flow '{flow_id}' not found at {src}")
        text = src.read_text(encoding="utf-8")
        return FlowModel.model_validate_json(text)

    def exists(self, flow_id: str) -> bool:
        """Return True if flows/<flow_id>.json exists."""
        return (self.flows_dir / f"{flow_id}.json").exists()

    def list(self) -> list[str]:
        """Return all flow IDs (filenames without .json extension)."""
        return [
            p.stem for p in sorted(self.flows_dir.glob("*.json"))
            if not p.name.endswith(".compiled.json")
        ]

    def save_compiled(self, spec: "CompiledFlowSpec") -> Path:
        """Save compiled spec to flows/<flow_id>.compiled.json (atomic write)."""
        from core.compiler.models import CompiledFlowSpec  # noqa: F811

        dest = self.flows_dir / f"{spec.flow_id}.compiled.json"
        tmp = dest.with_suffix(".tmp")
        json_text = json.dumps(spec.to_dict(), indent=2, ensure_ascii=False)
        tmp.write_text(json_text, encoding="utf-8")
        os.replace(str(tmp), str(dest))
        return dest

    def load_compiled(self, flow_id: str) -> "CompiledFlowSpec":
        """Load compiled spec from flows/<flow_id>.compiled.json."""
        from core.compiler.models import CompiledFlowSpec

        src = self.flows_dir / f"{flow_id}.compiled.json"
        if not src.exists():
            raise FileNotFoundError(
                f"Compiled spec for '{flow_id}' not found at {src}"
            )
        text = src.read_text(encoding="utf-8")
        data = json.loads(text)
        return CompiledFlowSpec.from_dict(data)

    def version(self, flow_id: str) -> Path:
        """
        Copy the current flows/<flow_id>.json to a versioned file:
        flows/<flow_id>-v2.json, -v3.json, etc. (first unused suffix).

        Returns the path of the versioned copy.
        """
        src = self.flows_dir / f"{flow_id}.json"
        if not src.exists():
            raise FileNotFoundError(f"Flow '{flow_id}' not found at {src}")

        v = 2
        while True:
            versioned = self.flows_dir / f"{flow_id}-v{v}.json"
            if not versioned.exists():
                break
            v += 1

        shutil.copy2(str(src), str(versioned))
        return versioned
