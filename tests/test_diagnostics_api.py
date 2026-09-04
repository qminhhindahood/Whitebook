from __future__ import annotations

import json
import os
from pathlib import Path

from tests.test_attempt_api import make_client, publish_two_question_package
from whitebook.diagnostics import DiagnosticLog


def test_diagnostic_log_rotates_and_accepts_only_structured_safe_metadata(
    tmp_path: Path,
) -> None:
    root = tmp_path / "data"
    (root / "logs").mkdir(parents=True)
    log = DiagnosticLog(root, max_bytes=220, backup_count=2)

    for index in range(20):
        log.record(
            "import_stage",
            stage="answer_csv_validation",
            error_code="invalid_mcq_answer",
            resource_id=f"draft-{index}",
        )

    files = list((root / "logs").glob("whitebook.log*"))
    assert 1 < len(files) <= 3
    payloads = [
        json.loads(line) for path in files for line in path.read_text().splitlines()
    ]
    assert all(
        set(item) <= {"timestamp", "event", "stage", "errorCode", "resourceId"}
        for item in payloads
    )
    assert any(item["errorCode"] == "invalid_mcq_answer" for item in payloads)


def test_import_logs_no_answers_key_or_source_content_and_folder_action_is_scoped(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("WHITEBOOK_DESMOS_API_KEY", "private-desmos-key")
    data_root = tmp_path / "data"
    client = make_client(data_root)
    publish_two_question_package(client)
    combined = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (data_root / "logs").glob("whitebook.log*")
    )
    assert "private-desmos-key" not in combined
    assert "Main Idea" not in combined
    assert "correct_answer" not in combined
    assert "starter.pdf" not in combined

    opened: list[str] = []
    monkeypatch.setattr(os, "startfile", lambda path: opened.append(str(path)))
    response = client.post("/api/diagnostics/open-logs")

    assert response.status_code == 200
    assert response.json() == {"opened": True}
    assert opened == [str((data_root / "logs").resolve())]
