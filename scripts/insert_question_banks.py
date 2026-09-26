"""Insert the three verified question banks into Whitebook as Test Packages.

For each bank: create an Import Draft from the (whitened) Source PDF and the
Answer CSV, map every question to full-page confirmed regions taken from the
regions CSV (one ordered region per source page, expanding "85,86" style
multi-page entries), publish, and verify the resulting package. Reruns are
safe: a bank whose PDF+CSV fingerprints already back a published package is
skipped.
"""
from __future__ import annotations

import csv
import hashlib
import shutil
import sys
import tempfile
from pathlib import Path

from whitebook.authoring import PackageAuthoring
from whitebook.storage import connect

ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "data"
BANKS = [
    {
        "title": "August R&W",
        "pdf": "question-bank/whitened/meo-whitened.pdf",
        "answers": "question-bank/meo-answers.csv",
        "regions": "question-bank/meo-regions.csv",
        "expected": 254,
    },
    {
        "title": "August Math",
        "pdf": "question-bank/whitened/meo-math-whitened.pdf",
        "answers": "question-bank/meo-math-answers.csv",
        "regions": "question-bank/meo-math-regions.csv",
        "expected": 201,
    },
    {
        "title": "Hardest SAT Math Questions",
        "pdf": "question-bank/hardest-sat-math-questions.pdf",
        "answers": "question-bank/hardest-answers.csv",
        "regions": "question-bank/hardest-regions.csv",
        "expected": 237,
    },
]


def region_map(path: Path) -> dict[tuple[str, int, int], list[int]]:
    with open(path, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    return {
        (row["section"], int(row["module"]), int(row["question_number"])): [
            int(p) for p in row["source_pages"].split(",")
        ]
        for row in rows
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def already_inserted(authoring: PackageAuthoring, pdf: Path, csv_path: Path) -> bool:
    pdf_sha = sha256_file(pdf)
    csv_sha = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    with connect(DATA_ROOT) as connection:
        row = connection.execute(
            "SELECT id FROM test_packages WHERE pdf_sha256 = ? AND csv_sha256 = ?",
            (pdf_sha, csv_sha),
        ).fetchone()
    return row is not None


def insert_bank(authoring: PackageAuthoring, bank: dict[str, str]) -> None:
    pdf = ROOT / bank["pdf"]
    csv_path = ROOT / bank["answers"]
    regions_csv = ROOT / bank["regions"]
    title = bank["title"]

    if already_inserted(authoring, pdf, csv_path):
        print(f"[skip] {title}: identical PDF+CSV already back a published package")
        return

    regions = region_map(regions_csv)
    answer_bytes = csv_path.read_bytes()
    with tempfile.TemporaryDirectory() as td:
        temp_pdf = Path(td) / pdf.name
        shutil.copy(pdf, temp_pdf)
        draft = authoring.create_import_draft(
            title=title,
            original_filename=pdf.name,
            temporary_pdf=temp_pdf,
            answer_csv=answer_bytes,
        )
    if draft.status != "mapping":
        print(f"[FAIL] {title}: draft status {draft.status!r}")
        for diagnostic in draft.diagnostics:
            print("   ", diagnostic)
        sys.exit(1)
    print(f"[draft] {title}: {draft.question_count} questions, id {draft.id}")

    for question in draft.questions:
        key = (question["section"], question["module"], question["questionNumber"])
        pages = regions.get(key)
        if not pages:
            print(f"[FAIL] {title}: no region for question {key}")
            sys.exit(1)
        draft = authoring.set_question_regions(
            draft.id,
            question["index"],
            [
                {
                    "page_number": page,
                    "x": 0.0,
                    "y": 0.0,
                    "width": 1.0,
                    "height": 1.0,
                    "confirmed": True,
                }
                for page in pages
            ],
        )

    confirmed = draft.mapping_progress["confirmed"]
    total = draft.mapping_progress["total"]
    if confirmed != total:
        print(f"[FAIL] {title}: mapping {confirmed}/{total}")
        sys.exit(1)

    package = authoring.publish(draft.id)
    if package["questionCount"] != bank["expected"]:
        print(f"[FAIL] {title}: package has {package['questionCount']} questions")
        sys.exit(1)
    if not authoring.verify_package_source(package["id"]):
        print(f"[FAIL] {title}: source PDF hash verification failed")
        sys.exit(1)
    print(
        f"[published] {title}: package {package['id']} | {package['questionCount']} questions"
        f" | simulationEligible={package['simulationEligible']}"
        f" | reasons={list(package['eligibilityReasons'])}"
    )


def main() -> None:
    authoring = PackageAuthoring(DATA_ROOT)
    for bank in BANKS:
        insert_bank(authoring, bank)
    print("\nInstalled packages:")
    for package in authoring.list_packages():
        print(
            f"  {package['title']}: {package['questionCount']} questions"
            f" | sections={package['sections']}"
        )


if __name__ == "__main__":
    main()
