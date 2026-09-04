from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from whitebook.safety import generate_storage_name


@dataclass(frozen=True)
class PdfDiagnostic:
    code: str
    message: str


@dataclass(frozen=True)
class AcceptedPdf:
    original_filename: str
    stored_path: Path
    sha256: str
    page_count: int


@dataclass(frozen=True)
class PdfPreflightResult:
    document: AcceptedPdf | None
    diagnostics: tuple[PdfDiagnostic, ...]


def _failed(code: str, message: str) -> PdfPreflightResult:
    return PdfPreflightResult(None, (PdfDiagnostic(code, message),))


def preflight_pdf(
    source_path: Path,
    private_directory: Path,
    *,
    max_bytes: int = 250 * 1024 * 1024,
    max_pages: int = 500,
) -> PdfPreflightResult:
    if source_path.suffix.lower() != ".pdf":
        return _failed("invalid_extension", "The Source PDF must use a .pdf extension.")
    try:
        size = source_path.stat().st_size
    except OSError:
        return _failed("unreadable_pdf", "The Source PDF could not be read.")
    if size > max_bytes:
        return _failed("pdf_too_large", "The Source PDF exceeds the size limit.")
    try:
        with source_path.open("rb") as source:
            if source.read(5) != b"%PDF-":
                return _failed(
                    "invalid_pdf_signature", "The selected file is not a PDF."
                )
        reader = PdfReader(source_path, strict=True)
        if reader.is_encrypted:
            return _failed(
                "password_protected", "Password-protected PDFs are not supported."
            )
        page_count = len(reader.pages)
    except (PdfReadError, OSError, ValueError):
        return _failed("malformed_pdf", "The Source PDF could not be parsed.")
    if page_count > max_pages:
        return _failed("too_many_pages", "The Source PDF exceeds the page limit.")

    private_directory.mkdir(parents=True, exist_ok=True)
    destination = (private_directory / generate_storage_name(".pdf")).resolve()
    partial = destination.with_suffix(".part")
    digest = hashlib.sha256()
    try:
        with source_path.open("rb") as source, partial.open("xb") as target:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        os.replace(partial, destination)
    except OSError:
        partial.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        return _failed("copy_failed", "The Source PDF could not be copied safely.")
    return PdfPreflightResult(
        AcceptedPdf(source_path.name, destination, digest.hexdigest(), page_count), ()
    )
