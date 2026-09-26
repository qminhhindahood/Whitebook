from __future__ import annotations

from pathlib import Path

from pypdf import PdfWriter

from whitebook.pdf_preflight import preflight_pdf


def write_pdf(path: Path, *, pages: int = 1, password: str | None = None) -> None:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    if password:
        writer.encrypt(password)
    with path.open("wb") as output:
        writer.write(output)


def test_accepts_and_privately_copies_an_ordinary_pdf(tmp_path: Path) -> None:
    source = tmp_path / "My SAT Questions.pdf"
    private = tmp_path / "data" / "documents"
    write_pdf(source, pages=2)

    result = preflight_pdf(source, private)

    assert result.diagnostics == ()
    assert result.document is not None
    assert result.document.original_filename == source.name
    assert result.document.page_count == 2
    assert len(result.document.sha256) == 64
    assert result.document.stored_path.parent == private.resolve()
    assert "my sat questions" not in result.document.stored_path.name.lower()
    assert result.document.stored_path.read_bytes() == source.read_bytes()


def test_rejects_bad_extension_signature_parseability_and_password(
    tmp_path: Path,
) -> None:
    private = tmp_path / "private"
    text_pdf = tmp_path / "questions.txt"
    text_pdf.write_bytes(b"%PDF-1.4\n")
    malformed = tmp_path / "malformed.pdf"
    malformed.write_bytes(b"%PDF-1.4\nnot really a pdf")
    encrypted = tmp_path / "encrypted.pdf"
    write_pdf(encrypted, password="test")

    assert preflight_pdf(text_pdf, private).diagnostics[0].code == "invalid_extension"
    assert preflight_pdf(malformed, private).diagnostics[0].code == "malformed_pdf"
    assert preflight_pdf(encrypted, private).diagnostics[0].code == "password_protected"
    assert not private.exists() or list(private.iterdir()) == []


def test_enforces_size_and_page_limits_without_partial_files(tmp_path: Path) -> None:
    source = tmp_path / "questions.pdf"
    private = tmp_path / "private"
    write_pdf(source, pages=2)

    too_large = preflight_pdf(source, private, max_bytes=10)
    too_many_pages = preflight_pdf(source, private, max_pages=1)

    assert too_large.diagnostics[0].code == "pdf_too_large"
    assert too_many_pages.diagnostics[0].code == "too_many_pages"
    assert not private.exists() or list(private.iterdir()) == []
