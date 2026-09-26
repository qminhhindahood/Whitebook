from __future__ import annotations

import os
import re
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath

_SAFE_SUFFIX = re.compile(r"\.[a-zA-Z0-9]+")
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f]")


class PathSafetyError(ValueError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def generate_storage_name(suffix: str = "") -> str:
    if suffix and not _SAFE_SUFFIX.fullmatch(suffix):
        raise PathSafetyError("unsafe_suffix")
    return f"{uuid.uuid4().hex}{suffix.lower()}"


def resolve_below(root: Path, candidate: str) -> Path:
    if _CONTROL_CHARACTERS.search(candidate):
        raise PathSafetyError("unsafe_characters")
    windows = PureWindowsPath(candidate)
    normalized = candidate.replace("\\", "/")
    posix = PurePosixPath(normalized)
    if windows.drive or windows.root or posix.is_absolute():
        raise PathSafetyError("absolute_path")
    if not posix.parts or ".." in posix.parts:
        raise PathSafetyError("path_traversal")
    _validate_parts(posix.parts)
    root_resolved = root.resolve()
    resolved = (root_resolved / Path(*posix.parts)).resolve()
    if not resolved.is_relative_to(root_resolved):
        raise PathSafetyError("outside_data_root")
    return resolved


def validate_zip_member(member: str) -> str:
    if _CONTROL_CHARACTERS.search(member):
        raise PathSafetyError("unsafe_characters")
    windows = PureWindowsPath(member)
    normalized = member.replace("\\", "/")
    posix = PurePosixPath(normalized)
    if windows.drive or windows.root or posix.is_absolute():
        raise PathSafetyError("absolute_path")
    if not posix.parts or ".." in posix.parts:
        raise PathSafetyError("path_traversal")
    _validate_parts(posix.parts)
    return posix.as_posix()


def _validate_parts(parts: tuple[str, ...]) -> None:
    for part in parts:
        stem = part.split(".")[0].upper()
        if (
            ":" in part
            or part.endswith((".", " "))
            or stem in {"CON", "PRN", "AUX", "NUL"}
            or re.fullmatch(r"(?:COM|LPT)[1-9]", stem)
        ):
            raise PathSafetyError("unsafe_characters")


def _redaction_variants(root: Path) -> list[str]:
    try:
        resolved = root.resolve()
    except OSError:
        resolved = root
    candidates = [str(resolved), resolved.as_posix()]
    if root.is_absolute():
        candidates.append(str(root))
        candidates.append(str(root).replace("\\", "/"))
    variants = {
        value
        for value in candidates
        if len(value) >= 2 and ("/" in value or "\\" in value)
    }
    return sorted(variants, key=lambda value: (-len(value), value))


def redact_diagnostic(
    message: str,
    *,
    secrets: tuple[str, ...] = (),
    sensitive_roots: tuple[Path, ...] = (),
) -> str:
    result = message
    for secret in sorted((value for value in secrets if value), key=len, reverse=True):
        result = result.replace(secret, "[secret]")
    variants: list[str] = []
    for root in sensitive_roots:
        variants.extend(_redaction_variants(root))
    if variants:
        flags = re.IGNORECASE if os.name == "nt" else re.NOFLAG
        pattern = "|".join(
            re.escape(variant)
            for variant in sorted(variants, key=lambda value: (-len(value), value))
        )
        result = re.sub(pattern, "[private-path]", result, flags=flags)
    return result
