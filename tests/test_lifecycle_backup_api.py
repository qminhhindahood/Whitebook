from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from tests.test_attempt_api import make_client, publish_two_question_package


def begin_paused_attempt(client, package: dict) -> dict:
    setup = client.post(
        "/api/attempt-setups",
        json={
            "packageId": package["id"],
            "kind": "practice",
            "selection": {
                "sections": ["Reading and Writing"],
                "modules": [1],
                "count": 2,
                "timing": "elapsed",
            },
        },
    ).json()
    attempt = client.post(f"/api/attempt-setups/{setup['setupId']}/begin").json()
    return client.post(f"/api/attempts/{attempt['id']}/pause").json()


def test_library_archive_restore_and_confirmed_deletion_scope(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    client = make_client(data_root)
    package = publish_two_question_package(client)
    attempt = begin_paused_attempt(client, package)
    source_files = list((data_root / "documents").glob("*.pdf"))

    archived = client.post(f"/api/test-packages/{package['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    assert client.get("/api/test-packages").json() == []
    assert (
        client.get("/api/test-packages?include_archived=true").json()[0]["id"]
        == package["id"]
    )

    restored = client.post(f"/api/test-packages/{package['id']}/restore")
    assert restored.json()["archived"] is False

    unconfirmed = client.request(
        "DELETE",
        f"/api/test-packages/{package['id']}",
        json={"confirmation": "wrong title"},
    )
    assert unconfirmed.status_code == 409
    deleted = client.request(
        "DELETE",
        f"/api/test-packages/{package['id']}",
        json={"confirmation": package["title"]},
    )
    assert deleted.status_code == 200
    assert deleted.json()["removedAttempts"] == 1
    assert client.get(f"/api/attempts/{attempt['id']}").status_code == 404
    assert all(not path.exists() for path in source_files)


def test_only_confirmed_unfinished_attempts_can_be_deleted_from_history(
    tmp_path: Path,
) -> None:
    client = make_client(tmp_path / "data")
    package = publish_two_question_package(client)
    paused = begin_paused_attempt(client, package)

    assert client.delete(f"/api/attempts/{paused['id']}").status_code == 409
    removed = client.delete(f"/api/attempts/{paused['id']}?confirmed=true")
    assert removed.status_code == 200
    assert client.get("/api/attempts").json() == []


def test_backup_round_trip_validates_hashes_and_excludes_transient_secrets(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("WHITEBOOK_DESMOS_API_KEY", "never-in-backup")
    data_root = tmp_path / "data"
    client = make_client(data_root)
    package = publish_two_question_package(client)
    begin_paused_attempt(client, package)
    (data_root / "logs" / "whitebook.log").write_text("private log", encoding="utf-8")
    (data_root / "runtime" / "transient.bin").write_bytes(b"transient")

    exported = client.post("/api/backups/export")
    assert exported.status_code == 201
    archive_response = client.get(exported.json()["downloadUrl"])
    archive = archive_response.content
    assert b"never-in-backup" not in archive
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        names = set(bundle.namelist())
        manifest = json.loads(bundle.read("manifest.json"))
    assert "database.sqlite3" in names
    assert any(name.startswith("documents/") for name in names)
    assert all(not name.startswith(("logs/", "runtime/", "renders/")) for name in names)
    assert manifest["formatVersion"] == 1
    assert set(manifest["payloadHashes"]) == names - {"manifest.json"}

    client.request(
        "DELETE",
        f"/api/test-packages/{package['id']}",
        json={"confirmation": package["title"]},
    )
    assert client.get("/api/test-packages").json() == []
    restored = client.post(
        "/api/backups/restore",
        files={"backup": ("whitebook-backup.zip", archive, "application/zip")},
    )
    assert restored.status_code == 200
    assert restored.json()["restoredPackages"] == 1
    assert client.get("/api/test-packages").json()[0]["id"] == package["id"]


def test_corrupt_backup_leaves_current_library_unchanged(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    client = make_client(data_root)
    package = publish_two_question_package(client)
    archive = client.get(
        client.post("/api/backups/export").json()["downloadUrl"]
    ).content
    source = zipfile.ZipFile(io.BytesIO(archive))
    corrupted_output = io.BytesIO()
    with zipfile.ZipFile(corrupted_output, "w", zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            payload = source.read(name)
            if name.startswith("documents/"):
                payload += b"corruption"
            target.writestr(name, payload)

    restored = client.post(
        "/api/backups/restore",
        files={
            "backup": (
                "corrupt.zip",
                corrupted_output.getvalue(),
                "application/zip",
            )
        },
    )

    assert restored.status_code == 422
    assert restored.json()["detail"] == "Backup payload hash mismatch."
    current = client.get("/api/test-packages").json()
    assert [item["id"] for item in current] == [package["id"]]
