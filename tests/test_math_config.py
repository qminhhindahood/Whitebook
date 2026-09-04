from __future__ import annotations

import json
from pathlib import Path

from whitebook.math_config import load_math_configuration

PNG = b"\x89PNG\r\n\x1a\n" + b"test"


def test_loads_key_and_reference_while_redacting_secret(tmp_path: Path) -> None:
    reference = tmp_path / "assets" / "reference.png"
    reference.parent.mkdir()
    reference.write_bytes(PNG)

    result = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "real-key"},
        "assets/reference.png",
    )

    assert result.diagnostics == ()
    assert result.configuration is not None
    assert result.configuration.reveal_desmos_api_key() == "real-key"
    rendered = f"{result.configuration!r} {result.configuration} {json.dumps(result.configuration.non_secret_settings())}"
    assert "real-key" not in rendered
    assert result.configuration.reference_sheet == reference.resolve()


def test_reports_missing_key_and_invalid_reference_without_leaking_values(
    tmp_path: Path,
) -> None:
    missing = load_math_configuration(tmp_path, {}, "missing.png")
    outside = tmp_path.parent / "outside.png"
    outside.write_bytes(PNG)
    escaped = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "do-not-leak"},
        "../outside.png",
    )
    wrong_type = tmp_path / "reference.png"
    wrong_type.write_bytes(b"not png")
    invalid = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "do-not-leak"},
        "reference.png",
    )

    assert {item.code for item in missing.diagnostics} == {
        "missing_desmos_key",
        "missing_reference_sheet",
    }
    assert escaped.diagnostics[0].code == "reference_outside_data_root"
    assert invalid.diagnostics[0].code == "invalid_reference_sheet"
    assert "do-not-leak" not in repr(escaped)
    assert "do-not-leak" not in repr(invalid)
