"""Validate a reviewed bundle and prepare an owner-only D1 import.

Run after the hosted web build. The output SQL contains answer keys: keep it
outside static assets and source control. Deploy the copied assets before
executing the SQL so activation cannot point at missing visuals.
"""

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


IDS = re.compile(r"^[A-Za-z0-9_-]+$")
NAMES = re.compile(r"^[A-Za-z0-9_-]+\.(png|webp|jpg|jpeg)$")
HASH = re.compile(r"^[a-f0-9]{64}$")
LOCAL_PATH = re.compile(r"(?:[A-Za-z]:[\\/]|/(?:Users|home|mnt)/|file://|\.pdf\b)", re.I)
SOURCE_SET = {
    ("August Math", 5), ("August R&W", 5),
    ("Hardest SAT Math Questions", 10), ("September Math", 4),
    ("September R&W", 5),
}
MIME = {"png": "image/png", "webp": "image/webp", "jpg": "image/jpeg", "jpeg": "image/jpeg"}


def check(condition, message):
    if not condition:
        raise ValueError(message)


def exact(value, keys, label):
    check(isinstance(value, dict) and set(value) == set(keys), f"Invalid {label} fields")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_checked(root, name, expected):
    check(HASH.fullmatch(expected or ""), f"Invalid hash for {name}")
    path = root / name
    check(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()), f"Missing {name}")
    data = path.read_bytes()
    check(digest(data) == expected, f"Hash mismatch for {name}")
    return data


def sql(value):
    return "'" + str(value).replace("'", "''") + "'"


def validate_blocks(blocks, revision, question, visual_paths):
    check(isinstance(blocks, list), "Presentation blocks must be a list")
    for block in blocks:
        check(isinstance(block, dict) and block.get("kind") in ("text", "asset"), "Unreviewed region or unknown block")
        if block["kind"] == "text":
            exact(block, ("kind", "text"), "text block")
            check(isinstance(block["text"], str) and block["text"].strip() and not LOCAL_PATH.search(block["text"]), "Unsafe text block")
        else:
            exact(block, ("kind", "src", "alt"), "asset block")
            check(isinstance(block["alt"], str) and block["alt"].strip() and not LOCAL_PATH.search(block["alt"]), "Unsafe visual alt text")
            prefix = f"/content/{revision}/{question}/"
            check(isinstance(block["src"], str) and block["src"].startswith(prefix) and block["src"] in visual_paths,
                  "Unlisted visual path")
            visual_paths[block["src"]] += 1


def image_type(data, suffix):
    if suffix == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix == "webp":
        return data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    return data.startswith(b"\xff\xd8\xff")


def prepare(bundle, output):
    check(bundle.resolve() != output.resolve(), "Output must be separate from the bundle")
    manifest_data = (bundle / "manifest.json").read_bytes()
    manifest = json.loads(manifest_data)
    exact(manifest, ("version", "releaseId", "kind", "presentationsSha256", "answersSha256", "assets"), "manifest")
    check(manifest["version"] == 1 and manifest["kind"] == "curated", "Unsupported bundle")
    release = manifest["releaseId"]
    check(isinstance(release, str) and IDS.fullmatch(release), "Invalid release ID")
    presentations = json.loads(read_checked(bundle, "presentations.json", manifest["presentationsSha256"]))
    answers = json.loads(read_checked(bundle, "answers.json", manifest["answersSha256"]))
    exact(presentations, ("packages",), "presentations")
    exact(answers, ("answers",), "answers")
    check(isinstance(presentations["packages"], list) and len(presentations["packages"]) == 5, "Curated release needs five packages")
    check(isinstance(answers["answers"], list) and isinstance(manifest["assets"], list), "Invalid answer or asset list")

    assets = {}
    copied = []
    for asset in manifest["assets"]:
        exact(asset, ("revisionId", "questionId", "name", "sha256", "byteSize"), "asset")
        revision, question, name = asset["revisionId"], asset["questionId"], asset["name"]
        check(all(isinstance(item, str) and IDS.fullmatch(item) for item in (revision, question)) and
              isinstance(name, str) and NAMES.fullmatch(name), "Invalid visual identity")
        source = f"assets/{revision}/{question}/{name}"
        data = read_checked(bundle, source, asset["sha256"])
        check(0 < len(data) <= 2_000_000 and asset["byteSize"] == len(data) and
              image_type(data, name.rsplit(".", 1)[1]), "Invalid visual bytes")
        path = f"/content/{revision}/{question}/{name}"
        check(path not in assets, "Duplicate visual")
        assets[path] = (asset, 0)
        copied.append((path, data))

    answer_map = {}
    for answer in answers["answers"]:
        exact(answer, ("revisionId", "questionId", "acceptedAnswers"), "answer")
        key = (answer["revisionId"], answer["questionId"])
        check(key not in answer_map and isinstance(answer["acceptedAnswers"], list) and
              answer["acceptedAnswers"] and all(isinstance(value, str) and value.strip() for value in answer["acceptedAnswers"]),
              "Invalid or duplicate answer")
        answer_map[key] = answer["acceptedAnswers"]

    lines = [f"INSERT OR IGNORE INTO publication_releases VALUES ({sql(release)}, {sql(digest(manifest_data))}, unixepoch());"]
    revision_ids = set()
    revision_guards = []
    question_keys = set()
    sources = set()
    for package in presentations["packages"]:
        exact(package, ("revisionId", "familyId", "title", "sourceRevision", "publishedRevision", "questions"), "package")
        revision = package["revisionId"]
        check(isinstance(revision, str) and IDS.fullmatch(revision) and revision not in revision_ids and
              isinstance(package["familyId"], str) and IDS.fullmatch(package["familyId"]), "Invalid package identity")
        revision_ids.add(revision)
        title = package["title"]
        source_revision = package["sourceRevision"]
        check(isinstance(title, str) and not LOCAL_PATH.search(title) and (title, source_revision) in SOURCE_SET and
              isinstance(package["publishedRevision"], int) and package["publishedRevision"] > 0, "Unexpected source revision")
        sources.add((title, source_revision))
        questions = package["questions"]
        check(isinstance(questions, list) and questions, "Empty package")
        package_answer_rows = [answer for answer in answers["answers"] if answer["revisionId"] == revision]
        package_assets = [asset for asset in manifest["assets"] if asset["revisionId"] == revision]
        package_hash = digest(json.dumps({"package": package, "answers": package_answer_rows,
                                         "assets": package_assets}, sort_keys=True,
                                        separators=(",", ":")).encode())
        revision_guards.append(f"(SELECT content_sha256 FROM package_revisions WHERE id = {sql(revision)}) = {sql(package_hash)}")
        revision_guards.append(f"(SELECT count(*) FROM publication_questions WHERE revision_id = {sql(revision)}) = {len(questions)}")
        lines.append(f"INSERT OR IGNORE INTO package_revisions VALUES ({sql(revision)}, {sql(package['familyId'])}, {sql(title)}, {source_revision}, {package['publishedRevision']}, {sql(package_hash)}, {len(questions)});")
        lines.append(f"INSERT OR IGNORE INTO publication_release_revisions VALUES ({sql(release)}, {sql(revision)});")
        source_question_ids = set()
        for ordinal, item in enumerate(questions, 1):
            exact(item, ("questionId", "sourceQuestionId", "section", "module", "questionNumber", "responseType", "reviewStatus", "presentation"), "question")
            question = item["questionId"]
            key = (revision, question)
            check(isinstance(question, str) and IDS.fullmatch(question) and key not in question_keys, "Duplicate question")
            check(isinstance(item["sourceQuestionId"], str) and IDS.fullmatch(item["sourceQuestionId"]), "Invalid source question identity")
            check(item["sourceQuestionId"] not in source_question_ids, "Duplicate source question identity")
            source_question_ids.add(item["sourceQuestionId"])
            question_keys.add(key)
            check(item["section"] in ("Math", "Reading and Writing") and isinstance(item["module"], int) and
                  item["module"] > 0 and isinstance(item["questionNumber"], int) and item["questionNumber"] > 0 and
                  item["responseType"] in ("multiple_choice", "student_produced_response") and
                  item["reviewStatus"] in ("reviewed_text", "image_fallback"), "Invalid question metadata")
            presentation = item["presentation"]
            exact(presentation, ("version", "stimulus", "stem", "choices"), "presentation")
            check(presentation["version"] == 1, "Unsupported presentation version")
            used = {path: 0 for path in assets if path.startswith(f"/content/{revision}/{question}/")}
            validate_blocks(presentation["stimulus"], revision, question, used)
            validate_blocks(presentation["stem"], revision, question, used)
            choices = presentation["choices"]
            check(isinstance(choices, list), "Invalid choices")
            if item["responseType"] == "multiple_choice":
                check(len(choices) == 4 and [choice.get("id") for choice in choices] == ["A", "B", "C", "D"], "Incomplete choices")
            else:
                check(not choices, "SPR cannot have choices")
            for choice in choices:
                exact(choice, ("id", "content"), "choice")
                validate_blocks(choice["content"], revision, question, used)
            if item["reviewStatus"] == "image_fallback":
                check(any(block["kind"] == "asset" for block in presentation["stem"]), "Image fallback needs question image")
            check(all(count > 0 for count in used.values()), "Unreferenced visual")
            for path, count in used.items():
                asset, _ = assets[path]
                assets[path] = (asset, count)
            accepted = answer_map.get(key)
            check(accepted is not None, "Missing answer")
            if item["responseType"] == "multiple_choice":
                check(len(accepted) == 1 and accepted[0] in "ABCD", "Invalid multiple-choice answer")
            serialized = json.dumps(presentation, separators=(",", ":"), ensure_ascii=False)
            lines.append(f"INSERT OR IGNORE INTO publication_questions VALUES ({sql(revision)}, {sql(question)}, {sql(item['sourceQuestionId'])}, {ordinal}, {sql(item['section'])}, {item['module']}, {item['questionNumber']}, {sql(item['responseType'])}, {sql(serialized)});")
            lines.append(f"INSERT OR IGNORE INTO publication_answers VALUES ({sql(revision)}, {sql(question)}, {sql(json.dumps(accepted, separators=(',', ':')))});")
    check(sources == SOURCE_SET and len(question_keys) == len(answer_map), "Wrong source set or extra answers")
    for path, (asset, count) in assets.items():
        check(count > 0, "Visual not referenced by a question")
        extension = asset["name"].rsplit(".", 1)[1]
        lines.append(f"INSERT OR IGNORE INTO publication_assets VALUES ({sql(path)}, {sql(asset['revisionId'])}, {sql(asset['questionId'])}, {sql(MIME[extension])}, {sql(asset['sha256'])}, {asset['byteSize']});")
    # This is the only statement that makes a new release visible. A failed or
    # interrupted import leaves the existing pointer untouched.
    ids = ",".join(sql(item) for item in sorted(revision_ids))
    lines.append(f"""INSERT INTO active_publication (slot, release_id)
      SELECT 1, {sql(release)} WHERE
      (SELECT manifest_sha256 FROM publication_releases WHERE id = {sql(release)}) = {sql(digest(manifest_data))}
      AND (SELECT count(*) FROM publication_release_revisions WHERE release_id = {sql(release)}) = 5
      AND (SELECT count(*) FROM publication_release_revisions WHERE release_id = {sql(release)} AND revision_id IN ({ids})) = 5
      AND (SELECT count(*) FROM package_revisions WHERE id IN ({ids})) = 5
      AND {' AND '.join(revision_guards)}
      AND (SELECT count(*) FROM publication_questions WHERE revision_id IN ({ids})) = {len(question_keys)}
      AND (SELECT count(*) FROM publication_answers WHERE revision_id IN ({ids})) = {len(question_keys)}
      AND (SELECT count(*) FROM publication_assets WHERE revision_id IN ({ids})) = {len(assets)}
      ON CONFLICT(slot) DO UPDATE SET release_id = excluded.release_id;""")
    check(not output.exists() or not any(output.iterdir()), "Output directory must be empty")
    output.mkdir(parents=True, exist_ok=True)
    for path, data in copied:
        destination = output / "assets" / path.lstrip("/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    (output / "publication.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(revision_ids), len(question_keys), len(assets)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print("Prepared %d revisions, %d questions, %d visuals" % prepare(args.bundle, args.output))
