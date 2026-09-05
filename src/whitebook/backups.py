from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import uuid
import zipfile
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from whitebook.safety import (
    PathSafetyError,
    resolve_below,
    validate_zip_member,
)
from whitebook.storage import connect, prepare_database


class BackupError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


class BackupManager:
    FORMAT_VERSION = 1

    def __init__(self, data_root: Path) -> None:
        self._data_root = data_root.resolve()

    def export(self) -> dict[str, object]:
        backup_id = uuid.uuid4().hex
        archive_name = f"{backup_id}.zip"
        archive_path = self._data_root / "backups" / archive_name
        snapshot = self._data_root / "runtime" / f"{backup_id}.sqlite3"
        with (
            connect(self._data_root) as source,
            closing(sqlite3.connect(snapshot)) as target,
        ):
            source.backup(target)
            # Loading setups are ephemeral and old versions could contain a Desmos URL.
            target.execute("PRAGMA secure_delete = ON")
            target.execute("DELETE FROM attempt_setups")
            target.commit()
            target.execute("VACUUM")

        payloads: list[tuple[str, Path]] = [("database.sqlite3", snapshot)]
        for folder in ("documents", "assets"):
            root = self._data_root / folder
            for path in sorted(item for item in root.rglob("*") if item.is_file()):
                payloads.append((f"{folder}/{path.relative_to(root).as_posix()}", path))
        hashes = {name: self._hash_file(path) for name, path in payloads}
        manifest = {
            "formatVersion": self.FORMAT_VERSION,
            "createdAt": datetime.now(UTC).isoformat(),
            "payloadHashes": hashes,
        }
        try:
            with zipfile.ZipFile(
                archive_path, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6
            ) as archive:
                archive.writestr(
                    "manifest.json", json.dumps(manifest, separators=(",", ":"))
                )
                for name, path in payloads:
                    archive.write(path, name)
        finally:
            snapshot.unlink(missing_ok=True)
        return {
            "id": backup_id,
            "filename": f"whitebook-backup-{backup_id[:8]}.zip",
            "downloadUrl": f"/api/backups/{backup_id}.zip",
            "payloadCount": len(payloads),
        }

    def archive_path(self, archive_name: str) -> Path | None:
        if not archive_name.endswith(".zip"):
            return None
        try:
            path = resolve_below(self._data_root / "backups", archive_name)
        except PathSafetyError:
            return None
        return path if path.is_file() else None

    def restore(self, archive_path: Path) -> dict[str, int]:
        stage = (self._data_root / "runtime" / f"restore-{uuid.uuid4().hex}").resolve()
        runtime_root = (self._data_root / "runtime").resolve()
        if not stage.is_relative_to(runtime_root):
            raise BackupError("unsafe_stage", "Backup staging path is unsafe.")
        stage.mkdir()
        try:
            self._validate_and_extract(archive_path, stage)
            database = stage / "database.sqlite3"
            try:
                with closing(sqlite3.connect(database)) as restored:
                    if restored.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                        raise BackupError(
                            "invalid_database",
                            "Backup database failed integrity checks.",
                        )
                    required = {
                        row[0]
                        for row in restored.execute(
                            "SELECT name FROM sqlite_master WHERE type = 'table'"
                        )
                    }
                    if not {"test_packages", "attempts", "import_drafts"} <= required:
                        raise BackupError(
                            "invalid_database", "Backup database is not compatible."
                        )
                    package_count = restored.execute(
                        "SELECT COUNT(*) FROM test_packages"
                    ).fetchone()[0]
            except sqlite3.Error as error:
                raise BackupError(
                    "invalid_database", "Backup database is not compatible."
                ) from error
            try:
                # Upgrade the staged database before it replaces the live
                # one, so a restore never leaves an unmigrated database.
                prepare_database(database)
            except (sqlite3.Error, RuntimeError) as error:
                raise BackupError(
                    "incompatible_database",
                    "This backup's database cannot be upgraded for use.",
                ) from error
            self._apply_restore(stage)
            return {"restoredPackages": int(package_count)}
        finally:
            if stage.is_dir():
                shutil.rmtree(stage)

    def _validate_and_extract(self, archive_path: Path, stage: Path) -> None:
        try:
            with zipfile.ZipFile(archive_path) as archive:
                names = archive.namelist()
                if (
                    len(names) > 10000
                    or sum(item.file_size for item in archive.infolist()) > 4 * 1024**3
                ):
                    raise BackupError(
                        "backup_too_large", "Backup exceeds the safe restore limit."
                    )
                if len(names) != len(set(names)):
                    raise BackupError(
                        "duplicate_member", "Backup contains duplicate paths."
                    )
                for name in names:
                    if name not in {
                        "manifest.json",
                        "database.sqlite3",
                    } and not name.startswith(("documents/", "assets/")):
                        raise BackupError(
                            "invalid_structure", "Backup contains unsupported payloads."
                        )
                    try:
                        validate_zip_member(name)
                    except PathSafetyError as error:
                        raise BackupError(
                            "unsafe_member", "Backup contains an unsafe path."
                        ) from error
                normalized_names = [
                    validate_zip_member(name).casefold() for name in names
                ]
                if len(normalized_names) != len(set(normalized_names)):
                    raise BackupError(
                        "duplicate_member", "Backup contains aliased paths."
                    )
                if "manifest.json" not in names or "database.sqlite3" not in names:
                    raise BackupError(
                        "invalid_structure", "Backup structure is incomplete."
                    )
                try:
                    manifest = json.loads(archive.read("manifest.json"))
                except (json.JSONDecodeError, KeyError, UnicodeDecodeError) as error:
                    raise BackupError(
                        "invalid_manifest", "Backup manifest is invalid."
                    ) from error
                if manifest.get("formatVersion") != self.FORMAT_VERSION:
                    raise BackupError(
                        "incompatible_version",
                        "Backup format version is not supported.",
                    )
                expected = manifest.get("payloadHashes")
                if not isinstance(expected, dict) or set(expected) != set(names) - {
                    "manifest.json"
                }:
                    raise BackupError("invalid_manifest", "Backup manifest is invalid.")
                for name, expected_hash in expected.items():
                    digest = hashlib.sha256()
                    with archive.open(name) as source:
                        while chunk := source.read(1024 * 1024):
                            digest.update(chunk)
                    if digest.hexdigest() != expected_hash:
                        raise BackupError(
                            "hash_mismatch", "Backup payload hash mismatch."
                        )
                for name in expected:
                    destination = resolve_below(stage, name)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(name) as source, destination.open("xb") as target:
                        shutil.copyfileobj(source, target, length=1024 * 1024)
        except zipfile.BadZipFile as error:
            raise BackupError(
                "invalid_zip", "The selected backup is not a valid ZIP."
            ) from error

    def _apply_restore(self, stage: Path) -> None:
        token = uuid.uuid4().hex
        rollback = self._data_root / "runtime" / f"rollback-{token}"
        rollback.mkdir()
        names = (
            ("database.sqlite3", "whitebook.sqlite3"),
            ("documents", "documents"),
            ("assets", "assets"),
        )
        for folder in ("documents", "assets"):
            (stage / folder).mkdir(exist_ok=True)
        moved_old: list[str] = []
        installed: list[tuple[str, str]] = []
        try:
            for staged_name, name in names:
                current = self._data_root / name
                if current.exists():
                    os.replace(current, rollback / name)
                    moved_old.append(name)
                os.replace(stage / staged_name, current)
                installed.append((staged_name, name))
        except OSError as error:
            for staged_name, name in reversed(installed):
                os.replace(self._data_root / name, stage / staged_name)
            for name in reversed(moved_old):
                os.replace(rollback / name, self._data_root / name)
            rollback.rmdir()
            raise BackupError(
                "restore_interrupted", "Backup restore could not be applied."
            ) from error
        else:
            if rollback.resolve().is_relative_to(
                (self._data_root / "runtime").resolve()
            ):
                shutil.rmtree(rollback)

    @staticmethod
    def _hash_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()
