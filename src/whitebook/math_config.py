from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def reference_sheet_setting(data_root: Path) -> str:
    return "assets/reference-sheet.png"


class RedactedSecret:
    """Holds one secret so no representation or copy reveals its value."""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        self._value = value

    @property
    def value(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return "[redacted]"

    def __str__(self) -> str:
        return "[redacted]"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, RedactedSecret) and self._value == other._value

    def __hash__(self) -> int:
        return hash(self._value)

    def __copy__(self) -> RedactedSecret:
        return self

    def __deepcopy__(self, memo: dict[int, object]) -> RedactedSecret:
        return self

    def __reduce__(self) -> None:
        raise TypeError("RedactedSecret cannot be serialized")


@dataclass(frozen=True)
class MathDiagnostic:
    code: str
    message: str


@dataclass(frozen=True)
class MathConfiguration:
    reference_sheet: Path
    reference_sheet_setting: str
    _desmos_api_key: RedactedSecret = dataclass_field(repr=False)

    def reveal_desmos_api_key(self) -> str:
        """The only intentional accessor for the Desmos API key."""
        return self._desmos_api_key.value

    def non_secret_settings(self) -> dict[str, str]:
        return {"reference_sheet": self.reference_sheet_setting}


@dataclass(frozen=True)
class MathConfigurationResult:
    configuration: MathConfiguration | None
    diagnostics: tuple[MathDiagnostic, ...]


def load_math_configuration(
    data_root: Path,
    environment: Mapping[str, str],
    reference_path: str | None,
) -> MathConfigurationResult:
    from whitebook.safety import PathSafetyError, resolve_below

    diagnostics: list[MathDiagnostic] = []
    key = environment.get("WHITEBOOK_DESMOS_API_KEY", "").strip()
    if not key:
        diagnostics.append(
            MathDiagnostic(
                "missing_desmos_key", "The Desmos API key is not configured."
            )
        )

    reference: Path | None = None
    if not reference_path:
        diagnostics.append(
            MathDiagnostic(
                "missing_reference_sheet", "The Reference Sheet is not configured."
            )
        )
    else:
        try:
            reference = resolve_below(data_root, reference_path)
        except PathSafetyError:
            diagnostics.append(
                MathDiagnostic(
                    "reference_outside_data_root",
                    "The Reference Sheet must remain inside Whitebook storage.",
                )
            )
        else:
            try:
                with reference.open("rb") as handle:
                    signature = handle.read(len(PNG_SIGNATURE))
            except OSError:
                diagnostics.append(
                    MathDiagnostic(
                        "missing_reference_sheet", "The Reference Sheet was not found."
                    )
                )
            else:
                valid_png = (
                    reference.suffix.lower() == ".png" and signature == PNG_SIGNATURE
                )
                if not valid_png:
                    diagnostics.append(
                        MathDiagnostic(
                            "invalid_reference_sheet",
                            "The Reference Sheet must be a valid PNG image.",
                        )
                    )

    if diagnostics or reference is None:
        return MathConfigurationResult(None, tuple(diagnostics))
    setting = reference.relative_to(data_root.resolve()).as_posix()
    return MathConfigurationResult(
        MathConfiguration(reference, setting, RedactedSecret(key)), ()
    )
