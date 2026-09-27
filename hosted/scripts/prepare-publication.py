"""Validate a reviewed bundle and prepare an owner-only D1 import.

Run after the hosted web build. The output SQL contains answer keys: keep it
outside static assets and source control. Deploy the copied assets before
executing the SQL so activation cannot point at missing visuals.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path


IDS = re.compile(r"^[A-Za-z0-9_-]+$")
NAMES = re.compile(r"^[A-Za-z0-9_-]+\.(png|webp|jpg|jpeg)$")
HASH = re.compile(r"^[a-f0-9]{64}$")
LOCAL_PATH = re.compile(r"(?:[A-Za-z]:[\\/]|/(?:Users|home|mnt)/|file://|\.pdf\b)", re.I)
SOURCE_SET = {
    ("August Math", 6), ("August R&W", 6),
    ("Hardest SAT Math Questions", 11), ("September Math", 5),
    ("September R&W", 6),
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
        check(isinstance(block, dict) and block.get("kind") in ("text", "asset", "image_asset", "reviewed_text", "latex"), "Unreviewed region or unknown block")
        kind = block["kind"]
        if kind == "text":
            exact(block, ("kind", "text"), "text block")
            check(isinstance(block["text"], str) and block["text"].strip() and not LOCAL_PATH.search(block["text"]), "Unsafe text block")
        elif kind == "reviewed_text":
            exact(block, ("kind", "runs"), "reviewed text block")
            check(isinstance(block["runs"], list) and block["runs"], "Empty reviewed text")
            for run in block["runs"]:
                check(isinstance(run, dict) and "text" in run and set(run) <= {"text", "emphasis", "blank"}, "Invalid reviewed text run")
                check(isinstance(run["text"], str) and run["text"] and not LOCAL_PATH.search(run["text"]), "Unsafe reviewed text")
                check(all(isinstance(run[key], bool) for key in ("emphasis", "blank") if key in run), "Invalid reviewed text marks")
        elif kind == "latex":
            exact(block, ("kind", "latex"), "Math notation block")
            check(isinstance(block["latex"], str) and block["latex"].strip() and len(block["latex"]) <= 1000 and
                  not any(char in block["latex"] for char in "<>$\x00") and not LOCAL_PATH.search(block["latex"]), "Unsafe Math notation")
        elif kind == "asset":
            exact(block, ("kind", "src", "alt"), "asset block")
            check(isinstance(block["alt"], str) and block["alt"].strip() and not LOCAL_PATH.search(block["alt"]), "Unsafe visual alt text")
            prefix = f"/content/{revision}/{question}/"
            check(isinstance(block["src"], str) and block["src"].startswith(prefix) and block["src"] in visual_paths,
                  "Unlisted visual path")
            visual_paths[block["src"]] += 1
        else:
            exact(block, ("kind", "assetId", "width", "height", "alt"), "image asset block")
            asset_id = block["assetId"]
            check(isinstance(asset_id, str) and HASH.fullmatch(asset_id) and
                  isinstance(block["width"], int) and block["width"] > 0 and
                  isinstance(block["height"], int) and block["height"] > 0 and
                  isinstance(block["alt"], str) and block["alt"].strip() and
                  not LOCAL_PATH.search(block["alt"]), "Invalid image asset")
            path = f"/content/{revision}/{question}/{asset_id}.png"
            check(path in visual_paths, "Unlisted visual path")
            visual_paths[path] += 1


def image_type(data, suffix):
    if suffix == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix == "webp":
        return data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    return data.startswith(b"\xff\xd8\xff")


def prepare(bundle, output, check_only=False):
    check(bundle.resolve() != output.resolve(), "Output must be separate from the bundle")
    manifest_data = (bundle / "manifest.json").read_bytes()
    manifest = json.loads(manifest_data)
    keys = ("version", "releaseId", "kind", "presentationsSha256", "answersSha256", "assets")
    if manifest.get("version") == 2:
        keys += ("auditSha256",)
    exact(manifest, keys, "manifest")
    check(manifest["version"] in (1, 2) and manifest["kind"] == "curated", "Unsupported bundle")
    release = manifest["releaseId"]
    check(isinstance(release, str) and IDS.fullmatch(release), "Invalid release ID")
    presentations = json.loads(read_checked(bundle, "presentations.json", manifest["presentationsSha256"]))
    answers = json.loads(read_checked(bundle, "answers.json", manifest["answersSha256"]))
    if manifest["version"] == 2:
        audit = json.loads(read_checked(bundle, "review-audit.json", manifest["auditSha256"]))
        check(audit.get("schema") == "whitebook.region-migration-results.v1" and
              audit.get("active_source_database_modified_by_this_run") is False and
              audit.get("scope", {}).get("new_active_region_blocks_in_migration_copy") == 0 and
              audit.get("scope", {}).get("missing_assets") == [] and
              audit.get("scope", {}).get("answer_rows_match_for_all_banks") is True,
              "Invalid reviewed migration audit")
    exact(presentations, ("packages",), "presentations")
    exact(answers, ("answers",), "answers")
    check(isinstance(presentations["packages"], list) and len(presentations["packages"]) == 5, "Curated release needs five packages")
    check(isinstance(answers["answers"], list) and isinstance(manifest["assets"], list), "Invalid answer or asset list")
    if manifest["version"] == 2:
        reviewed = {(row["new_package_id"], row["title"], row["source_revision"], row["new_revision"]): row
                    for row in audit.get("bank_results", [])}
        check(len(reviewed) == 5, "Migration audit does not identify five revisions")
        unique_assets = {asset["sha256"]: asset["byteSize"] for asset in manifest["assets"]}
        scope = audit["scope"]
        check(len(unique_assets) == scope.get("unique_asset_count") and
              sum(unique_assets.values()) == scope.get("total_unique_asset_bytes") and
              max(unique_assets.values(), default=0) == scope.get("maximum_asset_bytes"),
              "Asset inventory differs from migration audit")

    assets = {}
    copied = []
    for asset in manifest["assets"]:
        exact(asset, ("revisionId", "questionId", "name", "sha256", "byteSize"), "asset")
        revision, question, name = asset["revisionId"], asset["questionId"], asset["name"]
        check(all(isinstance(item, str) and IDS.fullmatch(item) for item in (revision, question)) and
              isinstance(name, str) and NAMES.fullmatch(name), "Invalid visual identity")
        source = f"assets/{revision}/{question}/{name}"
        data = read_checked(bundle, source, asset["sha256"])
        check(0 < len(data) <= 3_000_000 and asset["byteSize"] == len(data) and
              image_type(data, name.rsplit(".", 1)[1]), "Invalid visual bytes")
        path = f"/content/{revision}/{question}/{name}"
        check(path not in assets, "Duplicate visual")
        assets[path] = (asset, 0)
        copied.append((path, bundle / source))

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
        if manifest["version"] == 2:
            audit_row = reviewed.get((revision, title, source_revision, package["publishedRevision"]))
            check(audit_row is not None and audit_row.get("answer_rows_match") is True and
                  audit_row.get("new_region_blocks") == 0 and
                  audit_row.get("questions") == len(package["questions"]) and
                  audit_row.get("owner_source_audit_rows") == len(package["questions"]) and
                  audit_row.get("missing_assets") == [] and
                  audit_row.get("asset_count") == len({asset["sha256"] for asset in manifest["assets"]
                                                       if asset["revisionId"] == revision}),
                  "Package review does not match migration audit")
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
            check(isinstance(presentation, dict) and {"version", "stimulus", "stem", "choices"} <= set(presentation) and
                  set(presentation) <= {"version", "stimulus", "stem", "choices", "mode", "mathChoiceMode", "reviewStatus"},
                  "Invalid presentation fields")
            check(presentation["version"] in (1, 3), "Unsupported presentation version")
            if presentation["version"] == 3:
                check(presentation.get("reviewStatus") == "reviewed", "Question review is incomplete")
                check(presentation.get("mode") in (None, "reviewed_text", "image_fallback") and
                      presentation.get("mathChoiceMode") in (None, "typeset", "image_fallback"), "Invalid presentation mode")
            else:
                check(set(presentation) == {"version", "stimulus", "stem", "choices"}, "Invalid legacy presentation")
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
                check(any(block["kind"] in ("asset", "image_asset") for block in presentation["stem"] +
                          [block for choice in choices for block in choice["content"]]), "Image fallback needs question image")
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
    if check_only:
        return len(revision_ids), len(question_keys), len(assets)
    check(not output.exists() or not any(output.iterdir()), "Output directory must be empty")
    output.mkdir(parents=True, exist_ok=True)
    for path, source in copied:
        destination = output / "assets" / path.lstrip("/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())
    (output / "publication.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(revision_ids), len(question_keys), len(assets)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--check-only", action="store_true", help="Validate without writing SQL or assets")
    args = parser.parse_args()
    print("Validated %d revisions, %d questions, %d visuals" % prepare(args.bundle, args.output, True) if args.check_only else
          "Prepared %d revisions, %d questions, %d visuals" % prepare(args.bundle, args.output))
