from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx


@contextmanager
def running_whitebook(
    data_dir: Path,
) -> Iterator[tuple[subprocess.Popen[str], dict[str, object]]]:
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
            authorized = client.get("/api/health", headers={"X-Whitebook-Token": token})
            forged_host = client.get(
                "/api/health",
                headers={
                    "Host": f"localhost:{port}",
                    "X-Whitebook-Token": token,
                },
            )
            cross_origin = client.get(
                "/api/health",
                headers={
                    "Origin": "https://example.test",
                    "X-Whitebook-Token": token,
                },
            )

        assert unauthorized.status_code == 401
        assert forged_host.status_code == 400
        assert cross_origin.status_code == 403
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


def run_second_launcher(
    data_dir: Path,
    timeout: float = 5,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    command = [
        sys.executable,
        "-m",
        "whitebook",
        "--data-dir",
        str(data_dir),
        "--no-browser",
    ]
    env = os.environ.copy()
    if env_overrides:
        env.update(env_overrides)
    try:
        return subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired as error:
        if error.stdout or error.stderr:
            detail = f" stdout={error.stdout!r}, stderr={error.stderr!r}"
        else:
            detail = ""
        raise AssertionError(f"Second launcher did not exit.{detail}") from error


def test_live_instance_is_reused_without_starting_another_process(
    tmp_path: Path,
) -> None:
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


def test_live_instance_probe_never_sends_its_token_through_a_proxy(
    tmp_path: Path,
) -> None:
    data_dir = tmp_path / "whitebook-data"
    with running_whitebook(data_dir) as (first_process, first_lock):
        second = run_second_launcher(
            data_dir,
            env_overrides={
                "ALL_PROXY": "http://127.0.0.1:9",
                "HTTP_PROXY": "http://127.0.0.1:9",
                "HTTPS_PROXY": "http://127.0.0.1:9",
                "NO_PROXY": "",
                "all_proxy": "http://127.0.0.1:9",
                "http_proxy": "http://127.0.0.1:9",
                "https_proxy": "http://127.0.0.1:9",
                "no_proxy": "",
            },
        )

        assert second.returncode == 0
        assert "already running" in second.stdout.lower()
        assert str(first_lock["token"]) not in second.stdout
        assert str(first_lock["token"]) not in second.stderr
        assert first_process.poll() is None


def test_stale_lock_is_recovered_after_its_process_is_verified_dead(
    tmp_path: Path,
) -> None:
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


def test_first_launch_creates_private_storage_not_served_by_the_app(
    tmp_path: Path,
) -> None:
    data_dir = tmp_path / "whitebook-data"
    with running_whitebook(data_dir) as (_process, lock):
        for directory in ("documents", "renders", "runtime"):
            assert (data_dir / directory).is_dir()

        database_path = data_dir / "whitebook.sqlite3"
        assert database_path.is_file()
        with sqlite3.connect(database_path) as connection:
            schema_version = connection.execute(
                "SELECT value FROM app_metadata WHERE key = 'schema_version'"
            ).fetchone()
        assert schema_version == ("1",)

        response = httpx.get(
            f"http://127.0.0.1:{lock['port']}/data/whitebook.sqlite3",
            headers={"X-Whitebook-Token": str(lock["token"])},
            timeout=2,
        )
        assert response.status_code == 404


def test_bootstrap_creates_a_private_browser_session_and_serves_the_shell(
    tmp_path: Path,
) -> None:
    data_dir = tmp_path / "whitebook-data"
    with running_whitebook(data_dir) as (process, lock):
        token = str(lock["token"])
        base_url = f"http://127.0.0.1:{lock['port']}"
        with httpx.Client(
            base_url=base_url, follow_redirects=False, timeout=2
        ) as client:
            invalid = client.get("/bootstrap/not-the-token")
            bootstrap = client.get(f"/bootstrap/{token}")

            assert invalid.status_code == 401
            assert bootstrap.status_code == 303
            assert bootstrap.headers["location"] == "/app/"
            cookie = bootstrap.headers["set-cookie"]
            assert "HttpOnly" in cookie
            assert "SameSite=strict" in cookie

            shell = client.get("/app/")

        assert shell.status_code == 200
        assert "Whitebook" in shell.text
        assert "Local application ready" in shell.text
        assert token not in shell.text
        assert token not in bootstrap.text

    stdout = process.stdout.read() if process.stdout else ""
    stderr = process.stderr.read() if process.stderr else ""
    assert str(lock["token"]) not in stdout
    assert str(lock["token"]) not in stderr


def test_root_powershell_launcher_starts_the_built_application(tmp_path: Path) -> None:
    powershell = shutil.which("pwsh")
    if powershell is None or os.name != "nt":
        import pytest

        pytest.skip("The root launcher is a Windows PowerShell entry point.")

    data_dir = tmp_path / "whitebook-data"
    root = Path(__file__).resolve().parents[1]
    process = subprocess.Popen(
        [
            powershell,
            "-NoProfile",
            "-File",
            str(root / "start.ps1"),
            "-NoBrowser",
            "-SkipInstall",
            "-SkipBuild",
            "-DataDir",
            str(data_dir),
        ],
        cwd=root,
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
                candidate = json.loads(lock_path.read_text(encoding="utf-8"))
                response = httpx.get(
                    f"http://127.0.0.1:{candidate['port']}/api/health",
                    headers={"X-Whitebook-Token": str(candidate["token"])},
                    timeout=1,
                )
                if response.status_code == 200:
                    lock = candidate
                    break
            except (json.JSONDecodeError, OSError, httpx.HTTPError, KeyError):
                pass
        time.sleep(0.05)

    try:
        if lock is None:
            stdout, stderr = process.communicate(timeout=2)
            raise AssertionError(
                f"PowerShell launcher did not become ready. stdout={stdout!r}, stderr={stderr!r}"
            )
        assert lock["host"] == "127.0.0.1"
    finally:
        if lock is not None:
            try:
                os.kill(int(lock["pid"]), signal.SIGTERM)
            except ProcessLookupError:
                pass
        if process.poll() is None:
            process.wait(timeout=5)
