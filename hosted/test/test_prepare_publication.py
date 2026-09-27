import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare_publication", ROOT / "scripts" / "prepare-publication.py")
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode()


def hash_bytes(value):
    return hashlib.sha256(value).hexdigest()


def fixture(root):
    root.mkdir()
    titles = [
        ("August Math", 6), ("August R&W", 6),
        ("Hardest SAT Math Questions", 11), ("September Math", 5),
        ("September R&W", 6),
    ]
    packages, answers, assets = [], [], []
    for index, (title, source_revision) in enumerate(titles):
        revision = f"revision-{index}"
        question = f"q-{index}"
        fallback = index == 4
        visual = f"/content/{revision}/{question}/question.png"
        stem = ([{"kind": "asset", "src": visual, "alt": "Question image"}] if fallback else
                [{"kind": "text", "text": f"Question {index + 1}?"}])
        if fallback:
            binary = b"\x89PNG\r\n\x1a\n" + b"derived question image"
            file = root / "assets" / revision / question / "question.png"
            file.parent.mkdir(parents=True)
            file.write_bytes(binary)
            assets.append({"revisionId": revision, "questionId": question, "name": "question.png",
                           "sha256": hash_bytes(binary), "byteSize": len(binary)})
        presentation = {"version": 1, "stimulus": [], "stem": stem,
                        "choices": [{"id": letter, "content": [{"kind": "text", "text": f"Choice {letter}"}]}
                                    for letter in "ABCD"]}
        packages.append({"revisionId": revision, "familyId": f"family-{index}", "title": title,
                         "sourceRevision": source_revision, "publishedRevision": source_revision,
                         "questions": [{"questionId": question, "sourceQuestionId": f"source-{question}",
                                        "section": "Reading and Writing" if "R&W" in title else "Math",
                                        "module": 1, "questionNumber": 1, "responseType": "multiple_choice",
                                        "reviewStatus": "image_fallback" if fallback else "reviewed_text",
                                        "presentation": presentation}]})
        answers.append({"revisionId": revision, "questionId": question, "acceptedAnswers": ["B"]})
    p = encoded({"packages": packages})
    a = encoded({"answers": answers})
    (root / "presentations.json").write_bytes(p)
    (root / "answers.json").write_bytes(a)
    (root / "manifest.json").write_bytes(encoded({
        "version": 1, "releaseId": "reviewed-five-v1", "kind": "curated",
        "presentationsSha256": hash_bytes(p), "answersSha256": hash_bytes(a), "assets": assets,
    }))
    return packages


class PublicationTests(unittest.TestCase):
    def test_publishes_reviewed_question_categories_without_guessing_missing_ones(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            packages = fixture(bundle)
            packages[0]["questions"][0]["category"] = "Algebra"
            packages[1]["questions"][0]["category"] = "Not a reviewed category"
            presentation_bytes = encoded({"packages": packages})
            (bundle / "presentations.json").write_bytes(presentation_bytes)
            manifest = json.loads((bundle / "manifest.json").read_text())
            manifest["presentationsSha256"] = hash_bytes(presentation_bytes)
            (bundle / "manifest.json").write_bytes(encoded(manifest))
            with self.assertRaisesRegex(ValueError, "Invalid question category"):
                publication.prepare(bundle, root / "invalid", check_only=True)

            packages[1]["questions"][0].pop("category")
            presentation_bytes = encoded({"packages": packages})
            (bundle / "presentations.json").write_bytes(presentation_bytes)
            manifest["presentationsSha256"] = hash_bytes(presentation_bytes)
            (bundle / "manifest.json").write_bytes(encoded(manifest))
            publication.prepare(bundle, root / "prepared")
            db = sqlite3.connect(":memory:")
            for name in ("0002_learner_accounts.sql", "0004_curated_library.sql", "0008_progress_evidence.sql"):
                db.executescript((ROOT / "migrations" / name).read_text())
            db.executescript((root / "prepared/publication.sql").read_text())
            self.assertEqual(db.execute("SELECT revision_id, category FROM publication_question_categories").fetchall(),
                             [("revision-0", "Algebra")])

    def test_reviewed_categories_can_fill_an_existing_immutable_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            packages = fixture(bundle)
            publication.prepare(bundle, root / "first")
            db = sqlite3.connect(":memory:")
            for name in ("0002_learner_accounts.sql", "0004_curated_library.sql", "0008_progress_evidence.sql"):
                db.executescript((ROOT / "migrations" / name).read_text())
            db.executescript((root / "first/publication.sql").read_text())
            self.assertEqual(db.execute("SELECT count(*) FROM publication_question_categories").fetchone()[0], 0)

            packages[0]["questions"][0]["category"] = "Algebra"
            presentation_bytes = encoded({"packages": packages})
            (bundle / "presentations.json").write_bytes(presentation_bytes)
            manifest = json.loads((bundle / "manifest.json").read_text())
            manifest.update({"releaseId": "reviewed-five-v2", "presentationsSha256": hash_bytes(presentation_bytes)})
            (bundle / "manifest.json").write_bytes(encoded(manifest))
            publication.prepare(bundle, root / "second")
            db.executescript((root / "second/publication.sql").read_text())
            self.assertEqual(db.execute("SELECT release_id FROM active_publication").fetchone()[0], "reviewed-five-v2")
            self.assertEqual(db.execute("SELECT revision_id, category FROM publication_question_categories").fetchall(),
                             [("revision-0", "Algebra")])

    def test_publishes_only_explicit_owner_reviewed_help(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            packages = fixture(bundle)
            packages[0]["questions"][0]["reviewedHelp"] = {
                "source": "owner_reviewed", "hint": "Look for the contrast.",
                "explanation": "The contrast supports B.",
            }
            presentation_bytes = encoded({"packages": packages})
            (bundle / "presentations.json").write_bytes(presentation_bytes)
            manifest = json.loads((bundle / "manifest.json").read_text())
            manifest["presentationsSha256"] = hash_bytes(presentation_bytes)
            (bundle / "manifest.json").write_bytes(encoded(manifest))
            publication.prepare(bundle, root / "prepared")
            generated = (root / "prepared/publication.sql").read_text()
            self.assertIn("INSERT OR IGNORE INTO publication_review_help", generated)
            db = sqlite3.connect(":memory:")
            for name in ("0002_learner_accounts.sql", "0004_curated_library.sql",
                         "0006_practice_attempts.sql", "0007_guided_review_notes.sql"):
                db.executescript((ROOT / "migrations" / name).read_text())
            db.executescript(generated)
            self.assertEqual(db.execute("SELECT reviewed_hint, reviewed_explanation FROM publication_review_help").fetchone(),
                             ("Look for the contrast.", "The contrast supports B."))

    def test_reviewed_v3_bundle_binds_audit_and_image_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            packages = fixture(bundle)
            manifest = json.loads((bundle / "manifest.json").read_text())
            asset = manifest["assets"][0]
            old = bundle / "assets" / asset["revisionId"] / asset["questionId"] / asset["name"]
            asset["name"] = asset["sha256"] + ".png"
            old.rename(old.with_name(asset["name"]))
            for package in packages:
                question = package["questions"][0]
                presentation = question["presentation"]
                presentation.update({"version": 3, "reviewStatus": "reviewed",
                                     "mode": "image_fallback" if question["reviewStatus"] == "image_fallback" else "reviewed_text"})
                if question["reviewStatus"] == "image_fallback":
                    presentation["stem"] = [{"kind": "image_asset", "assetId": asset["sha256"],
                                             "width": 1, "height": 1, "alt": "Question image"}]
                else:
                    presentation["stem"] = [{"kind": "reviewed_text", "runs": [
                        {"text": "Reviewed question", "emphasis": True}]}]
                    presentation["choices"][0]["content"] = [{"kind": "latex", "latex": "x^2"}]
            presentation_bytes = encoded({"packages": packages})
            (bundle / "presentations.json").write_bytes(presentation_bytes)
            audit = {"schema": "whitebook.region-migration-results.v1",
                     "active_source_database_modified_by_this_run": False,
                     "scope": {"new_active_region_blocks_in_migration_copy": 0,
                               "answer_rows_match_for_all_banks": True,
                               "missing_assets": [],
                               "unique_asset_count": 1,
                               "total_unique_asset_bytes": asset["byteSize"],
                               "maximum_asset_bytes": asset["byteSize"]},
                     "bank_results": [{"new_package_id": package["revisionId"],
                                       "title": package["title"],
                                       "source_revision": package["sourceRevision"],
                                       "new_revision": package["publishedRevision"],
                                       "answer_rows_match": True, "new_region_blocks": 0,
                                       "missing_assets": [],
                                       "asset_count": int(package["revisionId"] == asset["revisionId"]),
                                       "questions": 1, "owner_source_audit_rows": 1}
                                      for package in packages]}
            audit_bytes = encoded(audit)
            (bundle / "review-audit.json").write_bytes(audit_bytes)
            manifest.update({"version": 2, "presentationsSha256": hash_bytes(presentation_bytes),
                             "auditSha256": hash_bytes(audit_bytes)})
            (bundle / "manifest.json").write_bytes(encoded(manifest))
            self.assertEqual(publication.prepare(bundle, root / "check", check_only=True), (5, 5, 1))
            self.assertFalse((root / "check").exists())
            self.assertEqual(publication.prepare(bundle, root / "prepared"), (5, 5, 1))
            self.assertNotIn("review-audit.json", (root / "prepared/publication.sql").read_text())
            (bundle / "review-audit.json").write_bytes(audit_bytes + b" ")
            with self.assertRaisesRegex(ValueError, "Hash mismatch for review-audit"):
                publication.prepare(bundle, root / "invalid")

    def test_hash_checked_retry_and_interrupted_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            fixture(bundle)
            output = root / "prepared"
            self.assertEqual(publication.prepare(bundle, output), (5, 5, 1))
            sql = (output / "publication.sql").read_text()
            self.assertNotIn("/Users/", sql)
            self.assertNotIn("sourcePdf", sql)
            self.assertTrue((output / "assets/content/revision-4/q-4/question.png").is_file())
            db = sqlite3.connect(":memory:")
            db.executescript((ROOT / "migrations/0002_learner_accounts.sql").read_text())
            db.executescript((ROOT / "migrations/0004_curated_library.sql").read_text())
            db.executescript(sql.split("INSERT INTO active_publication", 1)[0])
            self.assertEqual(db.execute("SELECT count(*) FROM active_publication").fetchone()[0], 0)
            db.executescript(sql)
            self.assertEqual(db.execute("SELECT release_id FROM active_publication").fetchone()[0], "reviewed-five-v1")
            db.executescript(sql)
            self.assertEqual(db.execute("SELECT count(*) FROM publication_questions").fetchone()[0], 5)
            self.assertEqual(db.execute("SELECT count(*) FROM publication_answers").fetchone()[0], 5)
            second = json.loads((bundle / "manifest.json").read_text())
            second["releaseId"] = "reviewed-five-v2"
            (bundle / "manifest.json").write_bytes(encoded(second))
            publication.prepare(bundle, root / "next")
            db.executescript((root / "next/publication.sql").read_text().split("INSERT INTO active_publication", 1)[0])
            self.assertEqual(db.execute("SELECT release_id FROM active_publication").fetchone()[0], "reviewed-five-v1")
            self.assertEqual(db.execute("SELECT count(*) FROM publication_questions").fetchone()[0], 5)
            changed_answers = json.loads((bundle / "answers.json").read_text())
            changed_answers["answers"][0]["acceptedAnswers"] = ["C"]
            answer_bytes = encoded(changed_answers)
            (bundle / "answers.json").write_bytes(answer_bytes)
            second["releaseId"] = "reviewed-five-v3"
            second["answersSha256"] = hash_bytes(answer_bytes)
            (bundle / "manifest.json").write_bytes(encoded(second))
            publication.prepare(bundle, root / "changed")
            db.executescript((root / "changed/publication.sql").read_text())
            self.assertEqual(db.execute("SELECT release_id FROM active_publication").fetchone()[0], "reviewed-five-v1")
            self.assertEqual(db.execute("SELECT accepted_answers_json FROM publication_answers WHERE question_id='q-0'").fetchone()[0], '["B"]')
            self.assertEqual(db.execute("SELECT count(*) FROM activated_publication_releases").fetchone()[0], 1)

    def test_rejects_modified_answer_or_unreviewed_question_without_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = root / "bundle"
            packages = fixture(bundle)
            (bundle / "answers.json").write_text('{"answers":[]}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Hash mismatch"):
                publication.prepare(bundle, root / "failed")
            self.assertFalse((root / "failed").exists())
            fixture_data = json.loads((bundle / "manifest.json").read_text())
            packages[0]["questions"][0]["presentation"]["stem"] = [{"kind": "region", "region": {}}]
            data = encoded({"packages": packages})
            (bundle / "presentations.json").write_bytes(data)
            fixture_data["presentationsSha256"] = hash_bytes(data)
            original_answers = encoded({"answers": [
                {"revisionId": f"revision-{i}", "questionId": f"q-{i}", "acceptedAnswers": ["B"]}
                for i in range(5)
            ]})
            (bundle / "answers.json").write_bytes(original_answers)
            (bundle / "manifest.json").write_bytes(encoded(fixture_data))
            with self.assertRaisesRegex(ValueError, "Unreviewed region"):
                publication.prepare(bundle, root / "failed")


if __name__ == "__main__":
    unittest.main()
