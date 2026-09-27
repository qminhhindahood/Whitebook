"""Owner-operated encrypted D1 backup, freshness check, and local restore drill."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import smtplib
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from contextlib import closing, contextmanager
from email.message import EmailMessage

HOSTED = Path(__file__).resolve().parents[1]
REPO = HOSTED.parent
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def require_external(path: Path) -> Path:
    path = path.resolve()
    if path == REPO or REPO in path.parents:
        raise ValueError("Recovery storage and temporary work must be outside the repository")
    return path


@contextmanager
def private_workdir(base: Path):
    path = Path(tempfile.mkdtemp(dir=base))
    try:
        yield path
    finally:
        for attempt in range(20):
            try:
                shutil.rmtree(path)
                break
            except PermissionError:
                if attempt == 19:
                    raise RuntimeError("Temporary recovery files could not be removed") from None
                time.sleep(0.5)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(parts: list[str], *, cwd: Path = HOSTED) -> None:
    # Wrangler output can include private SQL or response details. Keep the
    # operator-facing error independent of subprocess stdout and stderr.
    completed = subprocess.run(parts, cwd=cwd, capture_output=True, check=False)
    if completed.returncode:
        raise RuntimeError(f"Recovery command failed ({Path(parts[0]).name}, exit {completed.returncode})")


def wrangler(*args: str) -> None:
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("npx is unavailable")
    command([npx, "--no-install", "wrangler", *args])


def inspect_sql(sql_file: Path, bundles: Path, work_dir: Path | None = None) -> tuple[str | None, list[Path]]:
    with tempfile.TemporaryDirectory(dir=work_dir) as tmp:
        with closing(sqlite3.connect(str(Path(tmp) / "inspection.sqlite"))) as connection:
            connection.executescript(sql_file.read_text(encoding="utf-8"))
            releases = connection.execute("SELECT id, manifest_sha256 FROM publication_releases").fetchall()
            active = connection.execute("SELECT release_id FROM active_publication WHERE slot = 1").fetchone()
            expected_assets = dict(connection.execute("SELECT path, sha256 FROM publication_assets").fetchall())
    archived: list[Path] = []
    seen_assets: dict[str, str] = {}
    for release, expected_manifest in releases:
        if not SAFE_ID.fullmatch(release):
            raise ValueError("Invalid publication release ID")
        root = (bundles / release).resolve()
        if root.parent != bundles.resolve() or not root.is_dir():
            raise ValueError("Matching publication bundle is missing")
        manifest_file = root / "manifest.json"
        if digest(manifest_file) != expected_manifest:
            raise ValueError("Publication manifest does not match database export")
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        if (manifest.get("releaseId") != release or manifest.get("kind") != "curated" or
                manifest.get("version") not in (1, 2) or not isinstance(manifest.get("assets"), list) or
                "presentationsSha256" not in manifest or "answersSha256" not in manifest or
                (manifest["version"] == 2 and "auditSha256" not in manifest)):
            raise ValueError("Publication release ID does not match")
        for name, key in [("presentations.json", "presentationsSha256"), ("answers.json", "answersSha256"), ("review-audit.json", "auditSha256")]:
            if key in manifest and digest(root / name) != manifest[key]:
                raise ValueError("Publication bundle digest mismatch")
        for asset in manifest.get("assets", []):
            relative = Path("assets") / asset["revisionId"] / asset["questionId"] / asset["name"]
            path = (root / relative).resolve()
            if root not in path.parents or digest(path) != asset["sha256"]:
                raise ValueError("Publication asset digest mismatch")
            key = f"/content/{asset['revisionId']}/{asset['questionId']}/{asset['name']}"
            if key in seen_assets and seen_assets[key] != asset["sha256"]:
                raise ValueError("Publication asset differs between release bundles")
            seen_assets[key] = asset["sha256"]
        archived.append(root)
    if seen_assets != expected_assets:
        raise ValueError("Publication assets do not match database export")
    if active and active[0] not in {release for release, _ in releases}:
        raise ValueError("Active publication is missing from the archive")
    return active[0] if active else None, archived


def alert(message: str) -> None:
    host = os.getenv("WHITEBOOK_ALERT_SMTP_HOST")
    sender = os.getenv("WHITEBOOK_ALERT_FROM")
    recipient = os.getenv("WHITEBOOK_ALERT_TO")
    if not all([host, sender, recipient]):
        return
    email = EmailMessage()
    email["Subject"] = "Whitebook D1 backup needs attention"
    email["From"] = sender
    email["To"] = recipient
    email.set_content(message)
    with smtplib.SMTP_SSL(host, int(os.getenv("WHITEBOOK_ALERT_SMTP_PORT", "465")), timeout=15) as smtp:
        user = os.getenv("WHITEBOOK_ALERT_SMTP_USER")
        password = os.getenv("WHITEBOOK_ALERT_SMTP_PASSWORD")
        if user and password:
            smtp.login(user, password)
        smtp.send_message(email)


def retain(store: Path) -> None:
    daily = sorted((store / "daily").glob("whitebook-*.age"), reverse=True)
    monthly = sorted((store / "monthly").glob("whitebook-*.age"), reverse=True)
    for old in daily[30:] + monthly[12:]:
        old.unlink()


def backup(args: argparse.Namespace) -> None:
    store, work = require_external(args.store), require_external(args.work_dir)
    if store == work or store in work.parents or work in store.parents:
        raise ValueError("Backup store and temporary work must be separate")
    if not args.config.is_file() or not args.bundles.is_dir():
        raise ValueError("Explicit Wrangler config and publication archive directory are required")
    store.joinpath("daily").mkdir(parents=True, exist_ok=True)
    store.joinpath("monthly").mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc)
    name = f"whitebook-{stamp:%Y-%m-%dT%H%M%SZ}.age"
    destination = store / "daily" / name
    if destination.exists():
        raise ValueError("Backup filename already exists")
    with private_workdir(work) as root:
        sql = root / "database.sql"
        wrangler("d1", "export", args.database, "--remote", "--skip-confirmation",
                 "--config", str(args.config.resolve()), "--output", str(sql))
        if not sql.is_file() or not sql.stat().st_size:
            raise RuntimeError("D1 export is empty")
        active, releases = inspect_sql(sql, args.bundles.resolve(), root)
        archive = root / "recovery.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            output.write(sql, "database.sql")
            for bundle in releases:
                manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
                files = [bundle / "manifest.json", bundle / "presentations.json", bundle / "answers.json"]
                if manifest["version"] == 2:
                    files.append(bundle / "review-audit.json")
                files.extend(bundle / "assets" / asset["revisionId"] / asset["questionId"] / asset["name"]
                             for asset in manifest["assets"])
                for file in files:
                    output.write(file, (Path("publication") / bundle.name / file.relative_to(bundle)).as_posix())
            output.writestr("recovery.json", json.dumps({
                "format": "whitebook-hosted-recovery", "version": 1,
                "exportedAt": stamp.isoformat(), "databaseSha256": digest(sql),
                "activeRelease": active, "releases": [bundle.name for bundle in releases],
            }, separators=(",", ":")))
        age = shutil.which("age")
        if not age:
            raise RuntimeError("age encryption tool is unavailable")
        pending = destination.with_suffix(".pending")
        try:
            command([age, "-r", args.recipient, "-o", str(pending), str(archive)])
            if not pending.is_file() or not pending.stat().st_size:
                raise RuntimeError("Encrypted backup is empty")
            pending.replace(destination)
        finally:
            pending.unlink(missing_ok=True)
    monthly = store / "monthly" / f"whitebook-{stamp:%Y-%m}.age"
    if not monthly.exists():
        shutil.copy2(destination, monthly)
    retain(store)
    print(f"Encrypted backup completed at {stamp.isoformat()}; active release: {active or 'none'}")


def check(args: argparse.Namespace) -> None:
    store = require_external(args.store)
    backups = sorted((store / "daily").glob("whitebook-*.age"), key=lambda item: item.stat().st_mtime, reverse=True)
    if not backups or time.time() - backups[0].stat().st_mtime > args.max_age_hours * 3600:
        raise RuntimeError("Daily D1 export is missing or too old")
    print("Daily D1 export is current")


def read_json(url: str, token: str) -> dict:
    request = urllib.request.Request(url, headers={"Cookie": f"__Host-wb_session={token}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError("Local learner journey failed")
        return json.load(response)


def stop_local_server(server: subprocess.Popen) -> None:
    if os.name == "nt":
        # Wrangler starts workerd children on Windows; stopping only the CLI
        # leaves D1 files locked and the disposable server running.
        subprocess.run(["taskkill", "/PID", str(server.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        try:
            os.killpg(server.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()


def restore_drill(args: argparse.Namespace) -> None:
    require_external(args.work_dir).mkdir(parents=True, exist_ok=True)
    age = shutil.which("age")
    if not age or not args.identity.is_file():
        raise ValueError("age and the separate identity file are required")
    with private_workdir(args.work_dir) as root:
        archive = root / "recovery.zip"
        command([age, "-d", "-i", str(args.identity.resolve()), "-o", str(archive), str(args.archive.resolve())])
        with zipfile.ZipFile(archive) as source:
            for entry in source.infolist():
                target = (root / entry.filename).resolve()
                if root.resolve() not in target.parents and target != root.resolve():
                    raise ValueError("Unsafe recovery archive path")
            source.extractall(root)
        info = json.loads((root / "recovery.json").read_text(encoding="utf-8"))
        sql = root / "database.sql"
        if info.get("format") != "whitebook-hosted-recovery" or digest(sql) != info.get("databaseSha256"):
            raise ValueError("Recovery archive digest mismatch")
        active, releases = inspect_sql(sql, root / "publication", root)
        if active != info.get("activeRelease"):
            raise ValueError("Recovery publication does not match")
        with closing(sqlite3.connect(str(root / "preflight.sqlite"))) as db:
            db.executescript(sql.read_text(encoding="utf-8"))
            account = db.execute("SELECT id FROM learner_accounts WHERE id = ?", (args.account_id,)).fetchone()
            attempt = db.execute("SELECT id, revision_id FROM learner_attempts WHERE account_id = ? AND status = 'completed' ORDER BY completed_at_ms DESC LIMIT 1", (args.account_id,)).fetchone()
            note = db.execute("SELECT id FROM study_notes WHERE account_id = ? LIMIT 1", (args.account_id,)).fetchone()
            visual = db.execute("SELECT path FROM publication_assets ORDER BY path LIMIT 1").fetchone()
        if not account or not attempt or not note:
            raise ValueError("Drill learner needs a completed Attempt and Study Note in this export")
        if not (HOSTED / "dist").is_dir():
            raise ValueError("Build hosted assets before the restore drill")
        disposable_assets = root / "dist"
        shutil.copytree(HOSTED / "dist", disposable_assets, ignore=shutil.ignore_patterns("content"))
        for bundle in releases:
            manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
            for asset in manifest["assets"]:
                relative = Path(asset["revisionId"]) / asset["questionId"] / asset["name"]
                target = disposable_assets / "content" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(bundle / "assets" / relative, target)
        with socket.socket() as port_socket:
            port_socket.bind(("127.0.0.1", 0))
            port = port_socket.getsockname()[1]
        config = root / "wrangler.json"
        config.write_text(json.dumps({
            "name": "whitebook-disposable-restore", "main": str(HOSTED / "src" / "worker.ts"),
            "compatibility_date": "2026-09-26", "vars": {"APP_ORIGIN": f"http://127.0.0.1:{port}"},
            "assets": {"directory": str(disposable_assets), "binding": "ASSETS", "run_worker_first": True},
            "d1_databases": [{"binding": "DB", "database_name": "disposable-restore",
                              "database_id": "00000000-0000-0000-0000-000000000000"}],
        }), encoding="utf-8")
        state = root / "d1-state"
        wrangler("d1", "execute", "DB", "--local", "--persist-to", str(state),
                 "--config", str(config), "--file", str(sql), "--yes")
        token = os.urandom(32).hex()
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time())
        safe_id = args.account_id.replace("'", "''")
        insert = f"INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES ('{token_hash}', '{safe_id}', '{token_hash}', {now + 600}, {now})"
        wrangler("d1", "execute", "DB", "--local", "--persist-to", str(state),
                 "--config", str(config), "--command", insert, "--yes")
        node = shutil.which("node")
        cli = HOSTED / "node_modules" / "wrangler" / "bin" / "wrangler.js"
        if not node or not cli.is_file():
            raise RuntimeError("Local Wrangler is unavailable")
        server = subprocess.Popen([node, str(cli), "dev", "--local", "--ip", "127.0.0.1",
            "--port", str(port), "--persist-to", str(state), "--config", str(config)],
            cwd=HOSTED, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            start_new_session=os.name != "nt")
        try:
            base = f"http://127.0.0.1:{port}"
            for _ in range(60):
                if server.poll() is not None:
                    raise RuntimeError("Disposable Worker failed to start")
                try:
                    me = read_json(base + "/api/account/me", token)
                    break
                except Exception:
                    time.sleep(0.5)
            else:
                raise RuntimeError("Disposable Worker did not become ready")
            if me.get("account", {}).get("id") != args.account_id:
                raise RuntimeError("Restored account identity mismatch")
            library = read_json(base + "/api/library", token)
            if not any(item.get("revisionId") == attempt[1] for item in library.get("packages", [])):
                raise RuntimeError("Restored package was not retrievable")
            if visual:
                request = urllib.request.Request(base + visual[0], headers={"Cookie": f"__Host-wb_session={token}"})
                with urllib.request.urlopen(request, timeout=10) as response:
                    if response.status != 200 or not response.read():
                        raise RuntimeError("Restored publication visual was not retrievable")
            attempts = read_json(base + "/api/attempts", token)
            if not any(item.get("attemptId") == attempt[0] for item in attempts.get("attempts", [])):
                raise RuntimeError("Restored Attempt was not retrievable")
            review = read_json(base + f"/api/review/attempts/{attempt[0]}", token)
            if review.get("attemptId") != attempt[0] or not review.get("questions"):
                raise RuntimeError("Restored History was not retrievable")
            exported = read_json(base + "/api/account/export", token)
            if not any(item.get("id") == note[0] for item in exported.get("data", {}).get("studyNotes", [])):
                raise RuntimeError("Restored Study Note was not retrievable")
        finally:
            stop_local_server(server)
    print("Disposable D1 restore and signed-in learner journey passed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    export = sub.add_parser("backup")
    export.add_argument("--database", required=True)
    export.add_argument("--config", required=True, type=Path)
    export.add_argument("--bundles", required=True, type=Path)
    export.add_argument("--store", required=True, type=Path)
    export.add_argument("--work-dir", required=True, type=Path)
    export.add_argument("--recipient", required=True, help="age public recipient; private identity stays elsewhere")
    freshness = sub.add_parser("check")
    freshness.add_argument("--store", required=True, type=Path)
    freshness.add_argument("--max-age-hours", type=float, default=25)
    drill = sub.add_parser("restore-drill")
    drill.add_argument("--archive", required=True, type=Path)
    drill.add_argument("--identity", required=True, type=Path)
    drill.add_argument("--work-dir", required=True, type=Path)
    drill.add_argument("--account-id", required=True)
    args = parser.parse_args()
    try:
        {"backup": backup, "check": check, "restore-drill": restore_drill}[args.action](args)
    except Exception:
        if args.action in ("backup", "check"):
            try:
                alert("Whitebook D1 backup failed or the daily encrypted export is missing. Check the owner runner.")
            except Exception:
                pass
        print("Recovery operation failed; check the owner runner configuration and retry.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
