from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from pathlib import Path


@dataclass(frozen=True)
class MathDiagnostic:
    code: str
    message: str


@dataclass(frozen=True)
class MathConfiguration:
    reference_sheet: Path
    _desmos_api_key: str = dataclass_field(repr=False)

    def reveal_desmos_api_key(self) -> str:
        return self._desmos_api_key

    def non_secret_settings(self) -> dict[str, str]:
        return {"reference_sheet": self.reference_sheet.name}


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
                signature = reference.read_bytes()[:8]
            except OSError:
                diagnostics.append(
                    MathDiagnostic(
                        "missing_reference_sheet", "The Reference Sheet was not found."
                    )
                )
            else:
                if (
                    reference.suffix.lower() != ".png"
                    or signature != b"\x89PNG\r\n\x1a\n"
                ):
                    diagnostics.append(
                        MathDiagnostic(
                            "invalid_reference_sheet",
                            "The Reference Sheet must be a valid PNG image.",
                        )
                    )

    if diagnostics or reference is None:
        return MathConfigurationResult(None, tuple(diagnostics))
    return MathConfigurationResult(MathConfiguration(reference, key), ())
