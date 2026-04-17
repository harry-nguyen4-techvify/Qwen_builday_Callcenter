import re
from dataclasses import dataclass
from datetime import datetime

from core.models.field_defs import FieldType, FieldConstraints


# Default Vietnamese phone regex: 10-digit number starting with 0, or +84 prefix.
_DEFAULT_PHONE_VN_PATTERN = r"(0|\+84)[0-9]{9}"

# Mapping from DD/MM/YYYY-style tokens to Python strptime directives.
_DATE_FORMAT_MAP: dict[str, str] = {
    "DD/MM/YYYY": "%d/%m/%Y",
    "MM/DD/YYYY": "%m/%d/%Y",
    "YYYY-MM-DD": "%Y-%m-%d",
    "DD-MM-YYYY": "%d-%m-%Y",
    "YYYY/MM/DD": "%Y/%m/%d",
}

# Simple email regex (RFC-5321 subset sufficient for practical use).
_EMAIL_PATTERN = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


@dataclass
class ValidationResult:
    ok: bool
    error_msg: str = ""


class ValidationEngine:
    """Validates a raw string value against a FieldType and FieldConstraints."""

    def validate(
        self,
        field_type: FieldType,
        value: str,
        constraints: FieldConstraints | None = None,
    ) -> ValidationResult:
        if constraints is None:
            constraints = FieldConstraints()

        # Required check applies across all types.
        if not value or not value.strip():
            if constraints.required:
                return ValidationResult(
                    ok=False,
                    error_msg="This field is required. Please provide a value.",
                )
            # Empty non-required value is always OK.
            return ValidationResult(ok=True)

        _dispatch: dict[FieldType, object] = {
            FieldType.TEXT: self._validate_text,
            FieldType.PHONE: self._validate_phone,
            FieldType.DATE: self._validate_date,
            FieldType.EMAIL: self._validate_email,
            FieldType.SELECT: self._validate_select,
            FieldType.MULTISELECT: self._validate_multiselect,
            FieldType.BOOLEAN: self._validate_boolean,
            FieldType.PATTERN: self._validate_pattern,
        }

        validator = _dispatch.get(field_type)
        if validator is None:
            # Unknown type — pass through.
            return ValidationResult(ok=True)

        return validator(value, constraints)  # type: ignore[operator]

    # ------------------------------------------------------------------
    # Private validators
    # ------------------------------------------------------------------

    def _validate_text(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        if constraints.min_length is not None and len(value) < constraints.min_length:
            return ValidationResult(
                ok=False,
                error_msg=(
                    f"Text is too short. Minimum length is {constraints.min_length} characters."
                ),
            )
        if constraints.max_length is not None and len(value) > constraints.max_length:
            return ValidationResult(
                ok=False,
                error_msg=(
                    f"Text is too long. Maximum length is {constraints.max_length} characters."
                ),
            )
        return ValidationResult(ok=True)

    def _validate_phone(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        pattern = constraints.pattern or _DEFAULT_PHONE_VN_PATTERN
        if not re.fullmatch(pattern, value.strip()):
            return ValidationResult(
                ok=False,
                error_msg="Invalid phone number. Please provide a valid phone number.",
            )
        return ValidationResult(ok=True)

    def _validate_date(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        fmt_token = constraints.date_format or "DD/MM/YYYY"
        py_fmt = _DATE_FORMAT_MAP.get(fmt_token, "%d/%m/%Y")
        try:
            datetime.strptime(value.strip(), py_fmt)
        except ValueError:
            return ValidationResult(
                ok=False,
                error_msg=f"Invalid date. Please use {fmt_token} format.",
            )
        return ValidationResult(ok=True)

    def _validate_email(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        if not _EMAIL_PATTERN.fullmatch(value.strip()):
            return ValidationResult(
                ok=False,
                error_msg="Invalid email address.",
            )
        return ValidationResult(ok=True)

    def _validate_select(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        options = constraints.options or []
        if value.strip() not in options:
            opts_str = ", ".join(options) if options else "(none)"
            return ValidationResult(
                ok=False,
                error_msg=f"Invalid selection. Valid options are: {opts_str}.",
            )
        return ValidationResult(ok=True)

    def _validate_multiselect(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        options = constraints.options or []
        selections = [s.strip() for s in value.split(",") if s.strip()]
        invalid = [s for s in selections if s not in options]
        if invalid:
            opts_str = ", ".join(options) if options else "(none)"
            return ValidationResult(
                ok=False,
                error_msg=f"One or more selections are invalid. Valid options: {opts_str}.",
            )
        return ValidationResult(ok=True)

    def _validate_boolean(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        accepted = {"yes", "no", "true", "false", "1", "0"}
        if value.strip().lower() not in accepted:
            return ValidationResult(
                ok=False,
                error_msg="Please answer yes or no.",
            )
        return ValidationResult(ok=True)

    def _validate_pattern(self, value: str, constraints: FieldConstraints) -> ValidationResult:
        pattern = constraints.pattern
        if not pattern:
            # No pattern defined — nothing to validate against.
            return ValidationResult(ok=True)
        if not re.fullmatch(pattern, value.strip()):
            return ValidationResult(
                ok=False,
                error_msg="Value does not match required format.",
            )
        return ValidationResult(ok=True)
