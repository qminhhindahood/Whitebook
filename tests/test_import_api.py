from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfWriter
from starlette.testclient import TestClient

from whitebook.app import create_app
from whitebook.launcher import initialize_storage


def pdf_bytes() -> bytes:
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    return output.getvalue()


def client_for(tmp_path: Path) -> tuple[TestClient, Path]:
    data_root = tmp_path / "data"
    initialize_storage(data_root)
    app = create_app(
        capability_token="test-token",
        instance_id="test-instance",
        port=8123,
        static_root=tmp_path / "missing-static",
        storage_root=data_root,
    )
    client = TestClient(
        app,
        base_url="http://127.0.0.1:8123",
        headers={"X-Whitebook-Token": "test-token"},
        client=("127.0.0.1", 50000),
    )
    return client, data_root


def valid_csv() -> bytes:
    return (
        b"section,module,question_number,type,correct_answer,category\n"
        b"Reading and Writing,1,1,multiple choice,A,Word in Context\n"
        b"Math,1,1,student-produced response,3/2|1.5,Algebra\n"
    )


def test_templates_download_and_valid_import_draft_persists(tmp_path: Path) -> None:
    client, data_root = client_for(tmp_path)

    blank = client.get("/api/answer-csv-template?variant=blank")
    example = client.get("/api/answer-csv-template?variant=example")
    created = client.post(
        "/api/import-drafts",
        data={"title": ""},
        files={
            "source_pdf": ("Practice Set.pdf", pdf_bytes(), "application/pdf"),
            "answer_csv": ("answers.csv", valid_csv(), "text/csv"),
        },
    )

    assert blank.status_code == 200
    assert blank.headers["content-disposition"].endswith(
        'filename="whitebook-answer-key.csv"'
    )
    assert example.status_code == 200
    assert created.status_code == 201
    payload = created.json()
    assert payload["title"] == "Practice Set"
    assert payload["originalFilename"] == "Practice Set.pdf"
    assert payload["status"] == "mapping"
    assert payload["questionCount"] == 2
    assert payload["diagnostics"] == []
    assert len(list((data_root / "documents").glob("*.pdf"))) == 1

    reopened = client.get(f"/api/import-drafts/{payload['id']}")
    assert reopened.status_code == 200
    assert reopened.json() == payload


def test_invalid_import_remains_an_editable_draft_with_precise_diagnostics(
    tmp_path: Path,
) -> None:
    client, _data_root = client_for(tmp_path)
    invalid_csv = (
        b"section,module,question_number,type,correct_answer,category\n"
        b"Math,1,1,multiple choice,E,Algebra\n"
    )

    created = client.post(
        "/api/import-drafts",
        data={"title": "Needs correction"},
        files={
            "source_pdf": ("questions.pdf", pdf_bytes(), "application/pdf"),
            "answer_csv": ("answers.csv", invalid_csv, "text/csv"),
        },
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["status"] == "invalid"
    assert payload["editable"] is True
    assert payload["diagnostics"] == [
        {
            "code": "invalid_mcq_answer",
            "row": 2,
            "field": "correct_answer",
            "message": "A multiple-choice answer must be A, B, C, or D.",
        }
    ]


def test_import_rejects_wrong_upload_kinds_without_copying_them(tmp_path: Path) -> None:
    client, data_root = client_for(tmp_path)

    created = client.post(
        "/api/import-drafts",
        files={
            "source_pdf": ("questions.txt", b"not a pdf", "text/plain"),
            "answer_csv": ("answers.csv", valid_csv(), "text/csv"),
        },
    )

    assert created.status_code == 201
    assert created.json()["status"] == "invalid"
    assert created.json()["diagnostics"][0]["code"] == "invalid_extension"
    assert list((data_root / "documents").iterdir()) == []
