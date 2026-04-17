from enum import Enum
from pydantic import BaseModel


class FieldType(str, Enum):
    TEXT = "text"
    PHONE = "phone"
    DATE = "date"
    EMAIL = "email"
    SELECT = "select"
    MULTISELECT = "multiselect"
    BOOLEAN = "boolean"
    PATTERN = "pattern"


class FieldConstraints(BaseModel):
    required: bool = True
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = None
    options: list[str] | None = None
    date_format: str = "DD/MM/YYYY"


class FieldDefinition(BaseModel):
    id: str
    label: str
    cell_ref: str
    type: FieldType
    constraints: FieldConstraints = FieldConstraints()
    depends_on: list[str] = []
    description: str = ""
