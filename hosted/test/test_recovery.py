"""Disposable encrypted-archive restore through local D1 and the hosted Worker."""

import argparse
import hashlib
import json
from pathlib import Path
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest
from contextlib import closing
from unittest.mock import patch

from importlib.util import module_from_spec, spec_from_file_location

HOSTED = Path(__file__).resolve().parents[1]
spec = spec_from_file_location("recovery", HOSTED / "scripts" / "recovery.py")
recovery = module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryPolicyTest(unittest.TestCase):
    def test_retention_and_missed_export_detection(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = Path(temporary)
            daily, monthly = store / "daily", store / "monthly"
            daily.mkdir()
            monthly.mkdir()
            for index in range(31):
                (daily / f"whitebook-2026-09-{index + 1:02d}T010000Z.age").write_bytes(b"encrypted")
            for index in range(13):
                (monthly / f"whitebook-2025-{index + 1:02d}.age").write_bytes(b"encrypted")
            recovery.retain(store)
            self.assertEqual(len(list(daily.glob("*.age"))), 30)
            self.assertEqual(len(list(monthly.glob("*.age"))), 12)
            for item in daily.glob("*.age"):
                os.utime(item, (time.time() - 30 * 3600, time.time() - 30 * 3600))
            with self.assertRaisesRegex(RuntimeError, "missing or too old"):
                recovery.check(argparse.Namespace(store=store, max_age_hours=25))

    def test_alert_uses_configured_smtp_without_private_payload(self):
        settings = {"WHITEBOOK_ALERT_SMTP_HOST": "smtp.test", "WHITEBOOK_ALERT_FROM": "owner@test.invalid",
                    "WHITEBOOK_ALERT_TO": "owner@test.invalid"}
        with patch.dict(os.environ, settings), patch.object(recovery.smtplib, "SMTP_SSL") as smtp:
            recovery.alert("Daily export is missing")
            smtp.return_value.__enter__.return_value.send_message.assert_called_once()
            email = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
            self.assertIn("Daily export is missing", email.get_content())


@unittest.skipUnless(shutil.which("age") and shutil.which("age-keygen") and shutil.which("npx") and (HOSTED / "dist").is_dir(),
                     "Build hosted assets and install age, age-keygen, and npx before this integration test")
class RecoveryDrillTest(unittest.TestCase):
    def test_encrypted_export_restores_signed_in_attempt_and_note(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "source.sqlite"
            with closing(sqlite3.connect(database)) as db:
                schema_sql = []
                for migration in sorted((HOSTED / "migrations").glob("*.sql")):
                    source = migration.read_text(encoding="utf-8")
                    db.executescript(source)
                    schema_sql.append(source)
                bundle = root / "publication" / "test-release"
                bundle.mkdir(parents=True)
                visual = bundle / "assets" / "rev" / "q" / "figure.png"
                visual.parent.mkdir(parents=True)
                visual.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
                visual_hash = hashlib.sha256(visual.read_bytes()).hexdigest()
                files = {"presentations.json": "presentationsSha256", "answers.json": "answersSha256",
                         "review-audit.json": "auditSha256"}
                manifest = {"version": 2, "releaseId": "test-release", "kind": "curated", "assets": [
                    {"revisionId": "rev", "questionId": "q", "name": "figure.png", "sha256": visual_hash}]}
                for filename, field in files.items():
                    content = (bundle / filename)
                    content.write_text("{}", encoding="utf-8")
                    manifest[field] = hashlib.sha256(content.read_bytes()).hexdigest()
                manifest_path = bundle / "manifest.json"
                manifest_path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
                manifest_hash = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
                attempt_id = "11111111-1111-4111-8111-111111111111"
                note_id = "22222222-2222-4222-8222-222222222222"
                seed_sql = f"""
                    INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at) VALUES ('learner', 'google', 'test-subject', 'learner@test.invalid', 'Learner', 1);
                    INSERT INTO publication_releases (id, manifest_sha256, created_at) VALUES ('test-release', '{manifest_hash}', 1);
                    INSERT INTO package_revisions (id, family_id, title, source_revision, published_revision, content_sha256, question_count) VALUES ('rev', 'family', 'Restored package', 1, 1, 'hash', 1);
                    INSERT INTO publication_release_revisions (release_id, revision_id) VALUES ('test-release', 'rev');
                    INSERT INTO active_publication (slot, release_id) VALUES (1, 'test-release');
                    INSERT INTO publication_questions (revision_id, question_id, source_question_id, ordinal, section, module, question_number, response_type, presentation_json) VALUES ('rev', 'q', 'source', 1, 'Math', 1, 1, 'multiple_choice', '{{}}');
                    INSERT INTO publication_assets (path, revision_id, question_id, content_type, sha256, byte_size) VALUES ('/content/rev/q/figure.png', 'rev', 'q', 'image/png', '{visual_hash}', {visual.stat().st_size});
                    INSERT INTO learner_attempts (id, account_id, revision_id, kind, status, config_json, questions_json, state_json, created_at_ms, started_at_ms, completed_at_ms, result_json)
                      VALUES ('{attempt_id}', 'learner', 'rev', 'practice', 'completed',
                        '{{"section":"Math","modules":[1],"ordering":"package","timing":{{"mode":"elapsed"}}}}',
                        '[{{"questionId":"q","section":"Math","module":1,"questionNumber":1}}]',
                        '{{}}', 1, 2, 3,
                        '{{"correctCount":0,"questionCount":1,"questions":[{{"questionId":"q","response":"B","correct":false}}]}}');
                    INSERT INTO study_notes (id, account_id, revision_id, question_id, body, created_at_ms, updated_at_ms)
                      VALUES ('{note_id}', 'learner', 'rev', 'q', 'restored note', 1, 1);
                """
                db.executescript(seed_sql)
                sql_file = root / "database.sql"
                sql_file.write_text("\n".join(schema_sql) + "\n" + seed_sql, encoding="utf-8")
            local_config = root / "local-wrangler.json"
            local_config.write_text(json.dumps({"name": "whitebook-backup-fixture", "compatibility_date": "2026-09-26",
                "d1_databases": [{"binding": "DB", "database_name": "fixture",
                                  "database_id": "00000000-0000-0000-0000-000000000000"}]}), encoding="utf-8")
            cli = HOSTED / "node_modules" / "wrangler" / "bin" / "wrangler.js"
            common = [shutil.which("node"), str(cli)]
            def local_wrangler(*args):
                result = subprocess.run([*common, "d1", *args, "--config", str(local_config), "--cwd", str(root)],
                                        cwd=HOSTED, capture_output=True, check=False)
                self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace")[-1000:])
            local_wrangler("execute", "DB", "--local", "--file", str(sql_file), "--yes")
            exported_sql = root / "d1-export.sql"
            local_wrangler("export", "DB", "--local", "--output", str(exported_sql))
            sql_file = exported_sql
            active, releases = recovery.inspect_sql(sql_file, root / "publication")
            self.assertEqual(active, "test-release")
            self.assertEqual(len(releases), 1)
            valid_visual = visual.read_bytes()
            visual.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "asset digest mismatch"):
                recovery.inspect_sql(sql_file, root / "publication")
            visual.write_bytes(valid_visual)
            identity = root / "identity.txt"
            subprocess.run([shutil.which("age-keygen"), "-o", str(identity)], check=True, capture_output=True)
            recipient = re.search(r"age1[a-z0-9]+", identity.read_text(encoding="utf-8")).group()
            config = root / "production-config.json"
            config.write_text("{}", encoding="utf-8")
            def fake_remote_export(*args):
                self.assertIn("--remote", args)
                shutil.copy2(sql_file, Path(args[args.index("--output") + 1]))
            store = root / "store"
            with patch.object(recovery, "wrangler", side_effect=fake_remote_export):
                recovery.backup(argparse.Namespace(database="production", config=config,
                    bundles=root / "publication", store=store, work_dir=root / "backup-work",
                    recipient=recipient))
            recovery.check(argparse.Namespace(store=store, max_age_hours=25))
            encrypted, = (store / "daily").glob("*.age")
            self.assertEqual(len(list((store / "monthly").glob("*.age"))), 1)
            recovery.restore_drill(argparse.Namespace(
                archive=encrypted, identity=identity, work_dir=root / "scratch", account_id="learner"))


if __name__ == "__main__":
    unittest.main()
