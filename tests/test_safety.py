from __future__ import annotations

import os
import re
from collections.abc import Callable
from pathlib import Path

import pytest

from whitebook.safety import (
    PathSafetyError,
    generate_storage_name,
    redact_diagnostic,
    resolve_below,
    validate_zip_member,
)


def _rejection_of(function: Callable[..., object], *args: object) -> str:
    try:
        function(*args)
    except PathSafetyError as error:
        return error.code
    raise AssertionError("unsafe input was accepted")


def _create_directory_alias(link: Path, target: Path) -> bool:
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            return False
        try:
            import _winapi

            _winapi.CreateJunction(str(target), str(link))
        except (ImportError, OSError):
            return False
    return True


def test_generated_names_are_opaque_unique_and_restricted() -> None:
    names = {generate_storage_name(".PDF") for _ in range(50)}
    assert len(names) == 50
    assert all(re.fullmatch(r"[a-f0-9]{32}\.pdf", name) for name in names)
    assert re.fullmatch(r"[a-f0-9]{32}", generate_storage_name())


def test_generated_names_reject_unsafe_suffixes() -> None:
    for suffix in (
        "pdf",
        "..pdf",
        ".tar.gz",
        ".p d f",
        r".\..\evil",
        ".pdf/../../evil",
    ):
        assert _rejection_of(generate_storage_name, suffix) == "unsafe_suffix"


def test_resolution_returns_paths_below_the_data_root(tmp_path: Path) -> None:
    root = tmp_path / "data"
    root.mkdir()
    expected = (root / "documents" / "file.pdf").resolve()
    assert resolve_below(root, "documents/file.pdf") == expected
    assert resolve_below(root, r"documents\file.pdf") == expected


def test_resolution_rejects_unsafe_candidates(tmp_path: Path) -> None:
    root = tmp_path / "data"
    root.mkdir()
    rejections = {
        "../secret": "path_traversal",
        "documents/../secret": "path_traversal",
        r"documents\..\secret": "path_traversal",
        "/absolute": "absolute_path",
        r"C:\secret": "absolute_path",
        "C:/secret": "absolute_path",
        "C:secret": "absolute_path",
        r"\\?\C:\secret": "absolute_path",
        r"\\server\share\secret": "absolute_path",
        "documents\x00secret": "unsafe_characters",
    }
    for candidate, code in rejections.items():
        assert _rejection_of(resolve_below, root, candidate) == code


def test_resolution_rejects_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "data"
    root.mkdir()
    inside = root / "documents"
    inside.mkdir()
    (inside / "real.txt").write_text("ok")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("hidden")
    if not _create_directory_alias(root / "link", outside):
        pytest.skip("symlink and junction creation are unavailable")
    assert _rejection_of(resolve_below, root, "link/secret.txt") == "outside_data_root"
    assert _create_directory_alias(root / "within", inside)
    assert resolve_below(root, "within/real.txt") == (inside / "real.txt").resolve()


def test_zip_member_validation_normalizes_and_rejects_unsafe_names() -> None:
    assert validate_zip_member("documents/file.pdf") == "documents/file.pdf"
    assert validate_zip_member(r"documents\file.pdf") == "documents/file.pdf"
    rejections = {
        "../evil": "path_traversal",
        "documents/../evil": "path_traversal",
        r"documents\..\evil": "path_traversal",
        "": "path_traversal",
        "/evil": "absolute_path",
        r"C:\evil": "absolute_path",
        "C:/evil": "absolute_path",
        r"\\server\share\evil": "absolute_path",
        "doc\x00evil": "unsafe_characters",
    }
    for member, code in rejections.items():
        assert _rejection_of(validate_zip_member, member) == code


def test_diagnostic_redaction_removes_secrets_and_sensitive_roots(
    tmp_path: Path,
) -> None:
    root = tmp_path / "data"
    root.mkdir()
    token = "desmos-secret-value"
    longer = token + "tail"
    message = (
        f"stage=loading stage_error=storage at {root / 'documents' / 'source.pdf'} "
        f"and {root.as_posix()}/renders with key={longer} or {token} plus r*x+q"
    )
    redacted = redact_diagnostic(
        message,
        secrets=(token, longer, "", "r*x+q"),
        sensitive_roots=(root,),
    )
    redacted_again = redact_diagnostic(
        message,
        secrets=(token, longer, "", "r*x+q"),
        sensitive_roots=(root,),
    )

    assert redacted == redacted_again
    assert token not in redacted
    assert longer not in redacted
    assert "r*x+q" not in redacted
    assert str(root) not in redacted
    assert root.as_posix() not in redacted
    assert redacted.count("[secret]") == 3
    assert redacted.count("[private-path]") == 2
    assert "stage=loading stage_error=storage" in redacted


def test_diagnostic_redaction_matches_windows_path_casing(tmp_path: Path) -> None:
    if os.name != "nt":
        pytest.skip("Windows paths match case-insensitively")
    root = tmp_path / "DataRoot"
    root.mkdir()
    redacted = redact_diagnostic(str(root).lower(), sensitive_roots=(root,))
    assert redacted == "[private-path]"
