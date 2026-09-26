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
        ("August Math", 5), ("August R&W", 5),
        ("Hardest SAT Math Questions", 10), ("September Math", 4),
        ("September R&W", 5),
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
