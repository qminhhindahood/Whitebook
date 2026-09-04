from __future__ import annotations

import re
from pathlib import Path

from whitebook.safety import (
    PathSafetyError,
    generate_storage_name,
    redact_diagnostic,
    resolve_below,
    validate_zip_member,
)


def test_generated_names_are_opaque_unique_and_restricted() -> None:
    names = {generate_storage_name(".pdf") for _ in range(20)}
    assert len(names) == 20
    assert all(re.fullmatch(r"[a-f0-9]{32}\.pdf", name) for name in names)


def test_resolution_rejects_traversal_absolute_drive_and_symlink_escape(
    tmp_path: Path,
) -> None:
    root = tmp_path / "data"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = root / "link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        link = None

    assert (
        resolve_below(root, "documents/file.pdf")
        == (root / "documents/file.pdf").resolve()
    )
    for candidate in ("../secret", "/absolute", r"C:\secret", r"documents\..\secret"):
        try:
            resolve_below(root, candidate)
        except PathSafetyError as error:
            assert error.code in {
                "absolute_path",
                "path_traversal",
                "outside_data_root",
            }
        else:
            raise AssertionError(f"unsafe candidate accepted: {candidate}")
    if link is not None:
        try:
            resolve_below(root, "link/secret")
        except PathSafetyError as error:
            assert error.code == "outside_data_root"
        else:
            raise AssertionError("symlink escape accepted")


def test_zip_member_validation_rejects_unsafe_names() -> None:
    assert validate_zip_member("documents/file.pdf") == "documents/file.pdf"
    for member in ("../evil", "/evil", r"C:\evil", r"documents\..\evil"):
        try:
            validate_zip_member(member)
        except PathSafetyError:
            pass
        else:
            raise AssertionError(f"unsafe ZIP member accepted: {member}")


def test_diagnostic_redaction_preserves_useful_metadata(tmp_path: Path) -> None:
    secret = "desmos-secret-value"
    message = f"import failed at {tmp_path / 'documents' / 'source.pdf'} using {secret}"
    redacted = redact_diagnostic(
        message, secrets=(secret,), sensitive_roots=(tmp_path,)
    )

    assert secret not in redacted
    assert str(tmp_path) not in redacted
    assert "import failed" in redacted
    assert "[secret]" in redacted
    assert "[private-path]" in redacted
