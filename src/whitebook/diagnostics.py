from __future__ import annotations

import json
import re
import threading
from datetime import UTC, datetime
from pathlib import Path


class DiagnosticLog:
    _write_lock = threading.Lock()

    def __init__(
        self,
        data_root: Path,
        *,
        max_bytes: int = 256 * 1024,
        backup_count: int = 3,
    ) -> None:
        self.folder = (data_root / "logs").resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        self._path = self.folder / "whitebook.log"
        self._max_bytes = max_bytes
        self._backup_count = backup_count

    def record(
        self,
        event: str,
        *,
        stage: str | None = None,
        error_code: str | None = None,
        resource_id: str | None = None,
    ) -> None:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "event": self._safe_value(event),
        }
        if stage is not None:
            payload["stage"] = self._safe_value(stage)
        if error_code is not None:
            payload["errorCode"] = self._safe_value(error_code)
        if resource_id is not None:
            payload["resourceId"] = self._safe_value(resource_id)
        line = (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")
        with self._write_lock:
            if (
                self._path.exists()
                and self._path.stat().st_size + len(line) > self._max_bytes
            ):
                self._rotate()
            with self._path.open("ab") as output:
                output.write(line)

    def _rotate(self) -> None:
        if self._backup_count <= 0:
            self._path.unlink(missing_ok=True)
            return
        oldest = self.folder / f"whitebook.log.{self._backup_count}"
        oldest.unlink(missing_ok=True)
        for index in range(self._backup_count - 1, 0, -1):
            source = self.folder / f"whitebook.log.{index}"
            if source.exists():
                source.replace(self.folder / f"whitebook.log.{index + 1}")
        if self._path.exists():
            self._path.replace(self.folder / "whitebook.log.1")

    @staticmethod
    def _safe_value(value: str) -> str:
        return value if re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", value) else "redacted"
