import sqlite3
from pathlib import Path

from tests.test_attempt_api import make_client, publish_two_question_package
from tests.test_package_revision_api import (
    convert_all_questions,
)
from whitebook.backups import BackupManager

OLD_SCHEMA = """
CREATE TABLE app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE import_drafts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_pdf_name TEXT,
    pdf_sha256 TEXT,
    csv_sha256 TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    diagnostics_json TEXT NOT NULL,
    status TEXT NOT NULL,
    editable INTEGER NOT NULL,
    published_package_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE question_regions (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES import_drafts(id) ON DELETE CASCADE,
    question_index INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    confirmed INTEGER NOT NULL,
    UNIQUE(draft_id, question_index, ordinal)
);
CREATE TABLE test_packages (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    title TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_pdf_name TEXT NOT NULL,
    pdf_sha256 TEXT NOT NULL,
    csv_sha256 TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    regions_json TEXT NOT NULL,
    question_count INTEGER NOT NULL,
    simulation_eligible INTEGER NOT NULL,
    eligibility_reasons_json TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(pdf_sha256, csv_sha256)
);
CREATE INDEX idx_package_family ON test_packages(family_id, revision);
CREATE TABLE attempt_setups (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES test_packages(id),
    kind TEXT NOT NULL,
    selection_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    readiness_json TEXT NOT NULL,
    resume_attempt_id TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE attempts (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES test_packages(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    state_json TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO app_metadata VALUES ('schema_version', '2');
INSERT INTO settings VALUES ('autosave_probe', 'ok');
"""


def install_old_database(tmp_path: Path) -> None:
    for child in ("documents", "assets", "backups", "runtime"):
        (tmp_path / child).mkdir(parents=True)
    connection = sqlite3.connect(tmp_path / "whitebook.sqlite3")
    try:
        connection.executescript(OLD_SCHEMA)
        connection.execute(
            """
            INSERT INTO test_packages (
                id, family_id, revision, title, original_filename,
                stored_pdf_name, pdf_sha256, csv_sha256, manifest_json,
                regions_json, question_count, simulation_eligible,
                eligibility_reasons_json, archived, created_at
            ) VALUES ('pkg-old', 'family-old', 1, 'Old Bank', 'old.pdf',
                'old.pdf', 'pdfhash', 'csvhash', '[]', '[]', 2, 0, '[]', 0, 't')
            """
        )
        connection.execute(
            """
            INSERT INTO attempts (
                id, package_id, kind, status, plan_json, state_json,
                result_json, created_at, updated_at
            ) VALUES ('attempt-old', 'pkg-old', 'practice', 'paused',
                '{}', '{}', NULL, 't', 't')
            """
        )
        connection.commit()
    finally:
        connection.close()


def unique_pair_indexes(connection: sqlite3.Connection) -> list[str]:
    names = []
    for index in connection.execute("PRAGMA index_list(test_packages)"):
        if not index["unique"] or index["origin"] != "u":
            continue
        columns = [
            row["name"]
            for row in connection.execute(f"PRAGMA index_info({index['name']!r})")
        ]
        if columns == ["pdf_sha256", "csv_sha256"]:
            names.append(index["name"])
    return names


def test_restored_old_database_is_migrated_and_accepts_revisions(tmp_path: Path):
    install_old_database(tmp_path)
    manager = BackupManager(tmp_path)
    exported = manager.export()
    archive = manager.archive_path(exported["id"] + ".zip")
    assert archive is not None
    (tmp_path / "whitebook.sqlite3").unlink()
    manager.restore(archive)

    connection = sqlite3.connect(tmp_path / "whitebook.sqlite3")
    connection.row_factory = sqlite3.Row
    try:
        assert (
            connection.execute(
                "SELECT value FROM app_metadata WHERE key = 'schema_version'"
            ).fetchone()[0]
            == "4"
        )
        assert unique_pair_indexes(connection) == []
        draft_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(import_drafts)")
        }
        assert "revision_package_id" in draft_columns
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM attempts WHERE id = 'attempt-old'"
            ).fetchone()[0]
            == 1
        )
        # Two revision rows may now share the same source hash pair.
        for suffix in ("a", "b"):
            connection.execute(
                """
                INSERT INTO test_packages (
                    id, family_id, revision, title, original_filename,
                    stored_pdf_name, pdf_sha256, csv_sha256, manifest_json,
                    regions_json, question_count, simulation_eligible,
                    eligibility_reasons_json, archived, created_at
                ) VALUES (?, 'family-old', ?, 'Old Bank', 'old.pdf', 'old.pdf',
                    'pdfhash', 'csvhash', '[]', '[]', 2, 0, '[]', 0, 't')
                """,
                (f"pkg-{suffix}", 2 if suffix == "a" else 3),
            )
        connection.commit()
    finally:
        connection.close()


def test_paused_attempt_resumes_with_its_frozen_content_and_responses(
    tmp_path: Path,
):
    data_root = tmp_path / "data"
    client = make_client(data_root)
    package = publish_two_question_package(client)
    gate = client.post(
        "/api/attempt-setups",
        json={
            "packageId": package["id"],
            "kind": "practice",
            "selection": {
                "sections": ["Reading and Writing"],
                "modules": [1],
                "count": 2,
            },
        },
    ).json()
    attempt = client.post(f"/api/attempt-setups/{gate['setupId']}/begin").json()
    route = f"/api/attempts/{attempt['id']}"
    first = attempt["questions"][0]["id"]
    second = attempt["questions"][1]["id"]
    assert (
        client.put(f"{route}/questions/{first}/response", json={"response": "A"})
        .status_code
        == 200
    )
    assert client.post(f"{route}/pause").status_code == 200

    revision_draft = client.post(
        f"/api/test-packages/{package['id']}/revision"
    ).json()
    convert_all_questions(client, revision_draft, spr_second=False)
    upgraded = client.post(f"/api/import-drafts/{revision_draft['id']}/publish").json()
    assert upgraded["revision"] == 2

    resume_gate = client.post(f"{route}/prepare-resume").json()
    assert resume_gate["status"] == "ready"
    # The frozen plan keeps the original content; the upgrade does not leak in.
    assert all(
        "presentation" not in question for question in resume_gate["questions"]
    )
    resumed = client.post(f"/api/attempt-setups/{resume_gate['setupId']}/begin").json()
    assert resumed["responses"] == {first: "A"}
    assert resumed["questions"][0]["id"] == first
    assert resumed["questions"][1]["id"] == second
    assert all(
        "presentation" not in question for question in resumed["questions"]
    )
    completed = client.post(f"{route}/submit").json()
    assert completed["result"]["correct"] == 1
