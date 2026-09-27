"""Export the five audited, PDF-free local revisions into a private bundle.

Reads an isolated migration data root; never writes to the source database.
Only derived PNG assets, reviewed presentations, and a separate answer file
are exported. The owner audit remains private and is hash-bound to the bundle.
"""

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path


AUDIT_SCHEMA = "whitebook.region-migration-results.v1"
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
EXPECTED = {
    ("August R&W", 6, 7), ("September R&W", 6, 7),
    ("August Math", 6, 7), ("Hardest SAT Math Questions", 11, 12),
    ("September Math", 5, 6),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def answer_hash(questions):
    keys = ("id", "section", "module", "question_number", "response_type",
            "accepted_answers", "category", "source_row")
    rows = [{key: question.get(key) for key in keys} for question in questions]
    return sha(json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def blocks(presentation):
    return (presentation["stimulus"] + presentation["stem"] +
            [block for choice in presentation["choices"] for block in choice["content"]])


def export(data_root, audit_path, output, release_id, check_only=False):
    require(SAFE_ID.fullmatch(release_id), "Invalid release ID")
    require(not output.exists() or not any(output.iterdir()), "Output directory must be empty")
    audit_bytes = audit_path.read_bytes()
    audit = json.loads(audit_bytes)
    require(audit.get("schema") == AUDIT_SCHEMA and
            audit.get("active_source_database_modified_by_this_run") is False and
            audit.get("scope", {}).get("new_active_region_blocks_in_migration_copy") == 0 and
            audit.get("scope", {}).get("missing_assets") == [] and
            audit.get("scope", {}).get("answer_rows_match_for_all_banks") is True,
            "Migration audit is not publishable")
    rows = audit.get("bank_results")
    require(isinstance(rows, list) and len(rows) == 5 and
            {(row["title"], row["source_revision"], row["new_revision"]) for row in rows} == EXPECTED,
            "Unexpected reviewed revisions")
    db_path = (data_root / "whitebook.sqlite3").resolve()
    require(db_path.is_file(), "Migration database is missing")
    db = sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    packages, answers, assets = [], [], []
    if not check_only:
        require(not output.exists() or not any(output.iterdir()), "Output directory must be empty")
        output.mkdir(parents=True, exist_ok=True)
    for record in rows:
        source = db.execute("SELECT * FROM test_packages WHERE id = ?", (record["source_package_id"],)).fetchone()
        published = db.execute("SELECT * FROM test_packages WHERE id = ?", (record["new_package_id"],)).fetchone()
        require(source is not None and published is not None and
                source["title"] == published["title"] == record["title"] and
                source["revision"] == record["source_revision"] and
                published["revision"] == record["new_revision"] and
                published["regions_json"] == "[]", "Revision identity or region mismatch")
        source_questions = json.loads(source["manifest_json"])
        questions = json.loads(published["manifest_json"])
        require(len(questions) == len(source_questions) == record["questions"] == published["question_count"] and
                answer_hash(source_questions) == answer_hash(questions) == record["source_answer_rows_sha256"] == record["planned_answer_rows_sha256"],
                "Answer rows or question count changed")
        revision = record["new_package_id"]
        exported_questions = []
        for original, question in zip(source_questions, questions):
            require(original["id"] == question["id"] and original["index"] == question["index"] and
                    original["section"] == question["section"] and
                    original["module"] == question["module"] and
                    original["question_number"] == question["question_number"] and
                    not question.get("regions"), "Question identity or order changed")
            question_id = question["id"]
            require(SAFE_ID.fullmatch(question_id), "Invalid question ID")
            presentation = question["presentation"]
            require(presentation.get("version") == 3 and presentation.get("reviewStatus") == "reviewed" and
                    all(block.get("kind") != "region" for block in blocks(presentation)),
                    "Unreviewed or PDF-dependent presentation")
            for asset_id in {block["assetId"] for block in blocks(presentation) if block.get("kind") == "image_asset"}:
                require(re.fullmatch(r"[a-f0-9]{64}", asset_id), "Invalid image asset ID")
                linked = db.execute("SELECT 1 FROM test_package_assets WHERE package_id = ? AND asset_id = ?",
                                    (revision, asset_id)).fetchone()
                asset = db.execute("SELECT * FROM derived_assets WHERE asset_id = ?", (asset_id,)).fetchone()
                require(linked is not None and asset is not None and asset["mime_type"] == "image/png",
                        "Image asset is not linked to this revision")
                require(all(block["width"] == asset["width"] and block["height"] == asset["height"]
                            for block in blocks(presentation) if block.get("kind") == "image_asset" and
                            block["assetId"] == asset_id), "Image dimensions changed")
                relative = Path(asset["relative_path"])
                source_file = (data_root / relative).resolve()
                require(source_file.is_relative_to(data_root.resolve()) and source_file.is_file() and
                        not source_file.is_symlink(), "Image asset path is unsafe")
                binary = source_file.read_bytes()
                require(binary.startswith(b"\x89PNG\r\n\x1a\n") and len(binary) == asset["byte_size"] and
                        sha(binary) == asset_id, "Image asset hash or size mismatch")
                name = f"{asset_id}.png"
                if not check_only:
                    destination = output / "assets" / revision / question_id / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(binary)
                assets.append({"revisionId": revision, "questionId": question_id, "name": name,
                               "sha256": asset_id, "byteSize": len(binary)})
            exported_questions.append({
                "questionId": question_id, "sourceQuestionId": original["id"],
                "section": question["section"], "module": question["module"],
                "questionNumber": question["question_number"],
                "responseType": question["response_type"],
                "reviewStatus": "image_fallback" if presentation.get("mode") == "image_fallback" or
                    presentation.get("mathChoiceMode") == "image_fallback" else "reviewed_text",
                "presentation": presentation,
            })
            answers.append({"revisionId": revision, "questionId": question_id,
                            "acceptedAnswers": question["accepted_answers"]})
        packages.append({"revisionId": revision, "familyId": published["family_id"],
                         "title": published["title"], "sourceRevision": source["revision"],
                         "publishedRevision": published["revision"], "questions": exported_questions})
    db.close()
    presentation_bytes = encode({"packages": packages})
    answer_bytes = encode({"answers": answers})
    if not check_only:
        (output / "presentations.json").write_bytes(presentation_bytes)
        (output / "answers.json").write_bytes(answer_bytes)
        (output / "review-audit.json").write_bytes(audit_bytes)
        (output / "manifest.json").write_bytes(encode({
            "version": 2, "releaseId": release_id, "kind": "curated",
            "presentationsSha256": sha(presentation_bytes), "answersSha256": sha(answer_bytes),
            "auditSha256": sha(audit_bytes), "assets": assets,
        }))
    return len(packages), len(answers), len(assets)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_root", type=Path)
    parser.add_argument("audit", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--release-id", default="reviewed-five-20260927")
    parser.add_argument("--check-only", action="store_true", help="Validate without writing a bundle")
    args = parser.parse_args()
    print(("Validated" if args.check_only else "Exported") + " %d revisions, %d questions, %d visual references" %
          export(args.data_root, args.audit, args.output, args.release_id, args.check_only))
