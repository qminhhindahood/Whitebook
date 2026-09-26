import os
from pathlib import Path

import pytest

from tests.test_attempt_api import make_client, publish_two_question_package
from whitebook.backups import BackupError, BackupManager
from whitebook.storage import connect


def test_backup_restores_reference_assets_and_drops_transient_setups(tmp_path: Path):
    client = make_client(tmp_path)
    package = publish_two_question_package(client)
    client.post(
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
    )
    reference = tmp_path / "assets/reference-sheet.png"
    reference.write_bytes(b"original-reference")
    manager = BackupManager(tmp_path)
    exported = manager.export()
    archive = manager.archive_path(exported["id"] + ".zip")
    reference.write_bytes(b"different-reference")
    manager.restore(archive)
    assert reference.read_bytes() == b"original-reference"
    with connect(tmp_path) as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM attempt_setups").fetchone()[0] == 0
        )


def test_restore_rolls_back_all_targets_after_late_rename_failure(
    tmp_path: Path, monkeypatch
):
    client = make_client(tmp_path)
    publish_two_question_package(client)
    manager = BackupManager(tmp_path)
    exported = manager.export()
    (tmp_path / "assets/current.png").write_bytes(b"keep-me")
    before_db = (tmp_path / "whitebook.sqlite3").read_bytes()
    original_replace = os.replace
    calls = 0

    def fail_late(source, target):
        nonlocal calls
        calls += 1
        if calls == 4:
            raise OSError("injected disk failure")
        return original_replace(source, target)

    monkeypatch.setattr(os, "replace", fail_late)
    with pytest.raises(BackupError, match="could not be applied"):
        manager.restore(manager.archive_path(exported["id"] + ".zip"))
    assert (tmp_path / "whitebook.sqlite3").read_bytes() == before_db
    assert (tmp_path / "assets/current.png").read_bytes() == b"keep-me"
    assert len(client.get("/api/test-packages").json()) == 1
