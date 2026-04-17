from pydantic import BaseModel, model_validator

from .nodes import AnyNode


class Edge(BaseModel):
    id: str
    source: str
    target: str
    output: str


class FlowSettings(BaseModel):
    language: str = "en"
    max_retries: int = 3
    tts_voice: str = ""
    domain: str = ""
    agent_prompt: str = ""
    scenario: str = ""


class FlowModel(BaseModel):
    flow_id: str
    name: str
    nodes: list[AnyNode]
    edges: list[Edge]
    cell_mapping: dict[str, str] = {}
    settings: FlowSettings = FlowSettings()
    created_at: str = ""
    version: int = 1

    @model_validator(mode="after")
    def validate_edges(self) -> "FlowModel":
        node_ids = {n.id for n in self.nodes}
        for e in self.edges:
            if e.source not in node_ids:
                raise ValueError(f"Edge {e.id}: source '{e.source}' not in nodes")
            if e.target not in node_ids:
                raise ValueError(f"Edge {e.id}: target '{e.target}' not in nodes")
        return self
