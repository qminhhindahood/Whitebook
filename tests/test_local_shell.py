from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager

import httpx


@contextmanager
def running_whitebook(data_dir: Path) -> Iterator[tuple[subprocess.Popen[str], dict[str, object]]]:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "whitebook",
            "--data-dir",
            str(data_dir),
            "--no-browser",
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    lock_path = data_dir / "runtime" / "instance.json"
    deadline = time.monotonic() + 10
    lock: dict[str, object] | None = None
    while time.monotonic() < deadline and process.poll() is None:
        if lock_path.exists():
            try:
                lock = json.loads(lock_path.read_text(encoding="utf-8"))
                if lock.get("port") and lock.get("pid") == process.pid:
                    break
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(0.05)

    if lock is None:
        stdout, stderr = process.communicate(timeout=2)
        raise AssertionError(
            f"Whitebook did not become ready. stdout={stdout!r}, stderr={stderr!r}"
        )

    try:
        yield process, lock
    finally:
        if process.poll() is None:
            application_pid = int(lock["pid"])
            try:
                os.kill(application_pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)


def test_local_health_requires_capability_and_loopback_host(tmp_path: Path) -> None:
    with running_whitebook(tmp_path / "whitebook-data") as (_process, lock):
        port = int(lock["port"])
        token = str(lock["token"])
        base_url = f"http://127.0.0.1:{port}"

        with httpx.Client(base_url=base_url, timeout=2) as client:
            unauthorized = client.get("/api/health")
            authorized = client.get(
                "/api/health", headers={"X-Whitebook-Token": token}
            )
            forged_host = client.get(
                "/api/health",
                headers={
                    "Host": f"localhost:{port}",
                    "X-Whitebook-Token": token,
                },
            )

        assert unauthorized.status_code == 401
        assert forged_host.status_code == 400
        assert authorized.status_code == 200
        assert authorized.json() == {
            "instanceId": lock["instance_id"],
            "product": "Whitebook",
            "status": "ready",
            "storage": "ready",
        }
        assert lock["host"] == "127.0.0.1"


def test_operating_system_assigns_a_port_without_touching_an_occupied_one(
    tmp_path: Path,
) -> None:
    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    occupied.bind(("127.0.0.1", 0))
    occupied.listen()
    occupied_port = occupied.getsockname()[1]

    try:
        with running_whitebook(tmp_path / "whitebook-data") as (_process, lock):
            assert int(lock["port"]) != occupied_port
            assert occupied.fileno() != -1
    finally:
        occupied.close()


def run_second_launcher(data_dir: Path, timeout: float = 5) -> subprocess.CompletedProcess[str]:
    command = [
        sys.executable,
        "-m",
        "whitebook",
        "--data-dir",
        str(data_dir),
        "--no-browser",
    ]
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        if error.stdout or error.stderr:
            detail = f" stdout={error.stdout!r}, stderr={error.stderr!r}"
        else:
            detail = ""
        raise AssertionError(f"Second launcher did not exit.{detail}") from error


def test_live_instance_is_reused_without_starting_another_process(tmp_path: Path) -> None:
    data_dir = tmp_path / "whitebook-data"
    with running_whitebook(data_dir) as (first_process, first_lock):
        second = run_second_launcher(data_dir)
        current_lock = json.loads(
            (data_dir / "runtime" / "instance.json").read_text(encoding="utf-8")
        )

        assert second.returncode == 0
        assert "already running" in second.stdout.lower()
        assert str(first_lock["token"]) not in second.stdout
        assert str(first_lock["token"]) not in second.stderr
        assert first_process.poll() is None
        assert current_lock == first_lock


def test_stale_lock_is_recovered_after_its_process_is_verified_dead(tmp_path: Path) -> None:
    data_dir = tmp_path / "whitebook-data"
    runtime_dir = data_dir / "runtime"
    runtime_dir.mkdir(parents=True)

    exited_process = subprocess.Popen([sys.executable, "-c", "pass"])
    exited_process.wait(timeout=5)
    stale_record = {
        "host": "127.0.0.1",
        "instance_id": "stale-instance",
        "pid": exited_process.pid,
        "port": 9,
        "token": "stale-token",
    }
    (runtime_dir / "instance.json").write_text(
        json.dumps(stale_record), encoding="utf-8"
    )

    with running_whitebook(data_dir) as (_process, current_lock):
        assert current_lock["instance_id"] != stale_record["instance_id"]
        assert current_lock["token"] != stale_record["token"]


def test_live_unverified_lock_is_never_replaced(tmp_path: Path) -> None:
    data_dir = tmp_path / "whitebook-data"
    runtime_dir = data_dir / "runtime"
    runtime_dir.mkdir(parents=True)
    protected_record = {
        "host": "127.0.0.1",
        "instance_id": "not-whitebook",
        "pid": os.getpid(),
        "port": 9,
        "token": "not-a-whitebook-token",
    }
    lock_path = runtime_dir / "instance.json"
    lock_path.write_text(json.dumps(protected_record), encoding="utf-8")

    launcher = run_second_launcher(data_dir)

    assert launcher.returncode != 0
    assert "live process" in launcher.stderr.lower()
    assert json.loads(lock_path.read_text(encoding="utf-8")) == protected_record
