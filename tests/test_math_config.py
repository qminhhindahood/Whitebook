from __future__ import annotations

import dataclasses
import json
from pathlib import Path

from whitebook.math_config import load_math_configuration

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG = PNG_SIGNATURE + b"test"


def write_reference(root: Path) -> Path:
    reference = root / "assets" / "reference-sheet.png"
    reference.parent.mkdir(parents=True, exist_ok=True)
    reference.write_bytes(PNG)
    return reference


def test_loads_key_and_reference_with_redacted_representations(tmp_path: Path) -> None:
    reference = write_reference(tmp_path)

    result = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "real-key"},
        "assets/reference-sheet.png",
    )

    assert result.diagnostics == ()
    configuration = result.configuration
    assert configuration is not None
    assert configuration.reveal_desmos_api_key() == "real-key"
    assert configuration.reference_sheet == reference.resolve()
    assert configuration.non_secret_settings() == {
        "reference_sheet": "assets/reference-sheet.png"
    }
    rendered = " ".join(
        [
            repr(configuration),
            str(configuration),
            repr(result),
            str(result),
            repr(dataclasses.asdict(configuration)),
            repr(vars(configuration)),
            json.dumps(configuration.non_secret_settings()),
        ]
    )
    assert "real-key" not in rendered
    assert repr(configuration._desmos_api_key) == "[redacted]"
    assert str(configuration._desmos_api_key) == "[redacted]"


def test_missing_and_blank_keys_report_missing(tmp_path: Path) -> None:
    write_reference(tmp_path)

    absent = load_math_configuration(tmp_path, {}, "assets/reference-sheet.png")
    blank = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "   "},
        "assets/reference-sheet.png",
    )

    for result in (absent, blank):
        assert {item.code for item in result.diagnostics} == {"missing_desmos_key"}
        assert result.configuration is None


def test_reports_missing_outside_and_non_png_reference_without_leaking(
    tmp_path: Path,
) -> None:
    outside = tmp_path.parent / "outside.png"
    outside.write_bytes(PNG)
    renamed = tmp_path / "photo.jpg"
    renamed.write_bytes(PNG)
    missing = load_math_configuration(tmp_path, {}, "missing.png")
    escaped = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "do-not-leak"},
        "../outside.png",
    )
    absolute = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "do-not-leak"},
        str(outside.resolve()),
    )
    wrong_suffix = load_math_configuration(
        tmp_path,
        {"WHITEBOOK_DESMOS_API_KEY": "do-not-leak"},
        "photo.jpg",
    )
    bad_signature = tmp_path / "reference.png"
    bad_signature.write_bytes(b"not png")
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
    assert absolute.diagnostics[0].code == "reference_outside_data_root"
    assert wrong_suffix.diagnostics[0].code == "invalid_reference_sheet"
    assert invalid.diagnostics[0].code == "invalid_reference_sheet"
    for result in (escaped, absolute, wrong_suffix, invalid):
        assert result.configuration is None
        rendered = " ".join(
            [repr(result), str(result)]
            + [f"{item.code} {item.message}" for item in result.diagnostics]
        )
        assert "do-not-leak" not in rendered
