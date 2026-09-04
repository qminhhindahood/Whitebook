from __future__ import annotations

import re
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath


class PathSafetyError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def generate_storage_name(suffix: str = "") -> str:
    safe_suffix = (
        suffix if not suffix or re.fullmatch(r"\.[a-zA-Z0-9]+", suffix) else ""
    )
    return f"{uuid.uuid4().hex}{safe_suffix.lower()}"


def resolve_below(root: Path, candidate: str) -> Path:
    windows = PureWindowsPath(candidate)
    normalized = candidate.replace("\\", "/")
    posix = PurePosixPath(normalized)
    if windows.drive or windows.root or posix.is_absolute():
        raise PathSafetyError("absolute_path")
    if ".." in posix.parts:
        raise PathSafetyError("path_traversal")
    root_resolved = root.resolve()
    resolved = (root_resolved / Path(*posix.parts)).resolve()
    if not resolved.is_relative_to(root_resolved):
        raise PathSafetyError("outside_data_root")
    return resolved


def validate_zip_member(member: str) -> str:
    windows = PureWindowsPath(member)
    normalized = member.replace("\\", "/")
    posix = PurePosixPath(normalized)
    if windows.drive or windows.root or posix.is_absolute():
        raise PathSafetyError("absolute_path")
    if not posix.parts or ".." in posix.parts:
        raise PathSafetyError("path_traversal")
    return posix.as_posix()


def redact_diagnostic(
    message: str,
    *,
    secrets: tuple[str, ...] = (),
    sensitive_roots: tuple[Path, ...] = (),
) -> str:
    result = message
    for secret in sorted((value for value in secrets if value), key=len, reverse=True):
        result = result.replace(secret, "[secret]")
    for root in sorted(
        (str(path.resolve()) for path in sensitive_roots), key=len, reverse=True
    ):
        result = result.replace(root, "[private-path]")
    return result
