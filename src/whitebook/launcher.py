from __future__ import annotations

import argparse
import asyncio
import ctypes
from ctypes import wintypes
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import sys
import uuid
import webbrowser
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import uvicorn

from whitebook.app import create_app


LOOPBACK_HOST = "127.0.0.1"


@dataclass(frozen=True)
class InstanceRecord:
    host: str
    instance_id: str
    pid: int
    port: int
    token: str


class LauncherError(RuntimeError):
    """A safe, user-facing launcher failure."""


def initialize_storage(data_dir: Path) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    for child in ("documents", "renders", "runtime"):
        (data_dir / child).mkdir(exist_ok=True)

    database_path = data_dir / "whitebook.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('schema_version', '1')"
        )
        connection.commit()


def reserve_loopback_socket() -> socket.socket:
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind((LOOPBACK_HOST, 0))
    server_socket.listen()
    return server_socket


def read_instance_record(lock_path: Path) -> InstanceRecord:
    try:
        raw = json.loads(lock_path.read_text(encoding="utf-8"))
        return InstanceRecord(
            host=str(raw["host"]),
            instance_id=str(raw["instance_id"]),
            pid=int(raw["pid"]),
            port=int(raw["port"]),
            token=str(raw["token"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, OSError) as error:
        raise LauncherError(
            f"The Whitebook lock at {lock_path} is unreadable; it was left untouched."
        ) from error


def process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False

    if os.name != "nt":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    process_query_limited_information = 0x1000
    still_active = 259
    access_denied = 5
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
    if not handle:
        return ctypes.get_last_error() == access_denied

    try:
        exit_code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return True
        return exit_code.value == still_active
    finally:
        kernel32.CloseHandle(handle)


def is_verified_whitebook(record: InstanceRecord) -> bool:
    if record.host != LOOPBACK_HOST or not (1 <= record.port <= 65535):
        return False
    request = Request(
        f"http://{record.host}:{record.port}/api/health",
        headers={"X-Whitebook-Token": record.token},
    )
    try:
        with urlopen(request, timeout=1) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError):
        return False
    return (
        payload.get("product") == "Whitebook"
        and payload.get("instanceId") == record.instance_id
        and payload.get("status") == "ready"
    )


def claim_instance(lock_path: Path, record: InstanceRecord) -> None:
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        payload = json.dumps(asdict(record)).encode("utf-8")
        os.write(descriptor, payload)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def inspect_existing_instance(lock_path: Path) -> InstanceRecord | None:
    if not lock_path.exists():
        return None

    record = read_instance_record(lock_path)
    if process_is_alive(record.pid):
        if is_verified_whitebook(record):
            return record
        raise LauncherError(
            "The Whitebook data lock belongs to a live process that could not be "
            "verified as Whitebook; no process or lock was changed."
        )

    try:
        lock_path.unlink()
    except OSError as error:
        raise LauncherError(f"The stale Whitebook lock could not be removed: {error}") from error
    return None


async def serve(
    record: InstanceRecord,
    data_dir: Path,
    server_socket: socket.socket,
    no_browser: bool,
) -> None:
    lock_path = data_dir / "runtime" / "instance.json"
    app = create_app(
        capability_token=record.token,
        instance_id=record.instance_id,
        port=record.port,
        storage_root=data_dir,
    )
    config = uvicorn.Config(
        app,
        host=LOOPBACK_HOST,
        port=record.port,
        access_log=False,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    server_task = asyncio.create_task(server.serve(sockets=[server_socket]))

    try:
        while not server.started and not server_task.done():
            await asyncio.sleep(0.01)
        if server_task.done():
            await server_task
            return

        if not no_browser:
            webbrowser.open(f"http://{record.host}:{record.port}/")
        print(f"Whitebook is ready at http://{record.host}:{record.port}/", flush=True)
        await server_task
    finally:
        server_socket.close()
        try:
            current = json.loads(lock_path.read_text(encoding="utf-8"))
            if current.get("instance_id") == record.instance_id:
                lock_path.unlink(missing_ok=True)
        except (json.JSONDecodeError, OSError):
            pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Launch Whitebook locally.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data",
    )
    parser.add_argument("--no-browser", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    data_dir = args.data_dir.resolve()
    initialize_storage(data_dir)

    lock_path = data_dir / "runtime" / "instance.json"
    try:
        existing = inspect_existing_instance(lock_path)
        if existing is not None:
            if not args.no_browser:
                webbrowser.open(f"http://{existing.host}:{existing.port}/")
            print(f"Whitebook is already running at http://{existing.host}:{existing.port}/")
            return

        server_socket = reserve_loopback_socket()
        record = InstanceRecord(
            host=LOOPBACK_HOST,
            instance_id=str(uuid.uuid4()),
            pid=os.getpid(),
            port=int(server_socket.getsockname()[1]),
            token=secrets.token_urlsafe(32),
        )
        try:
            claim_instance(lock_path, record)
        except FileExistsError:
            server_socket.close()
            raise LauncherError(
                "Another Whitebook launcher acquired the data lock; try opening Whitebook again."
            ) from None

        asyncio.run(serve(record, data_dir, server_socket, args.no_browser))
    except KeyboardInterrupt:
        pass
    except LauncherError as error:
        print(f"Whitebook could not start: {error}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
