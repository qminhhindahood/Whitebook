from __future__ import annotations

import hashlib
import json
import math
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from pypdf import PdfReader

from whitebook.answer_csv import AnswerCsvResult, parse_answer_csv
from whitebook.package_eligibility import QuestionDescriptor, classify_package
from whitebook.pdf_preflight import PdfPreflightResult, preflight_pdf
from whitebook.question_presentation import QuestionPresentation
from whitebook.storage import connect


@dataclass(frozen=True)
class ImportDraft:
    id: str
    title: str
    original_filename: str
    status: str
    editable: bool
    question_count: int
    diagnostics: tuple[dict[str, object], ...]
    questions: tuple[dict[str, object], ...]
    source_pdf_url: str | None
    published_package_id: str | None
    revision_package_id: str | None = None

    @property
    def mapping_progress(self) -> dict[str, int]:
        confirmed = sum(
            1
            for question in self.questions
            if question.get("presentation")
            or (
                question["regions"]
                and all(region["confirmed"] for region in question["regions"])
            )
        )
        return {"confirmed": confirmed, "total": self.question_count}

    def as_payload(self) -> dict[str, object]:
        next_unmapped = next(
            (
                question["index"]
                for question in self.questions
                if not question.get("presentation")
                and (
                    not question["regions"]
                    or not all(region["confirmed"] for region in question["regions"])
                )
            ),
            None,
        )
        return {
            "id": self.id,
            "title": self.title,
            "originalFilename": self.original_filename,
            "status": self.status,
            "editable": self.editable,
            "questionCount": self.question_count,
            "diagnostics": list(self.diagnostics),
            "questions": list(self.questions),
            "mappingProgress": self.mapping_progress,
            "nextUnmappedQuestion": next_unmapped,
            "sourcePdfUrl": self.source_pdf_url,
            "publishedPackageId": self.published_package_id,
            "revisionOfPackageId": self.revision_package_id,
        }


class AuthoringError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


class PackageAuthoring:
    """Owns import validation and durable Import Draft creation."""

    def __init__(self, data_root: Path) -> None:
        self._data_root = data_root

    def create_import_draft(
        self,
        *,
        title: str | None,
        original_filename: str,
        temporary_pdf: Path,
        answer_csv: bytes,
    ) -> ImportDraft:
        safe_filename = Path(original_filename).name or "Source PDF.pdf"
        chosen_title = (
            title.strip() if title and title.strip() else Path(safe_filename).stem
        )
        csv_result = parse_answer_csv(answer_csv)
        pdf_result = preflight_pdf(
            temporary_pdf,
            self._data_root / "documents",
        )
        diagnostics = self._diagnostics(csv_result, pdf_result)
        draft_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        document = pdf_result.document
        status = "mapping" if not diagnostics else "invalid"
        manifest = [asdict(row) for row in csv_result.rows]
        stored_pdf_name = document.stored_path.name if document else None
        pdf_sha256 = document.sha256 if document else None
        published_package_id: str | None = None
        with connect(self._data_root) as connection:
            if document and not diagnostics:
                existing = connection.execute(
                    """
                    SELECT id, stored_pdf_name FROM test_packages
                    WHERE pdf_sha256 = ? AND csv_sha256 = ?
                    """,
                    (document.sha256, hashlib.sha256(answer_csv).hexdigest()),
                ).fetchone()
                if existing is not None:
                    document.stored_path.unlink(missing_ok=True)
                    stored_pdf_name = existing["stored_pdf_name"]
                    published_package_id = existing["id"]
                    status = "published"
            connection.execute(
                """
                INSERT INTO import_drafts (
                    id, title, original_filename, stored_pdf_name, pdf_sha256,
                    csv_sha256, manifest_json, diagnostics_json, status, editable,
                    published_package_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    draft_id,
                    chosen_title or "Untitled Test Package",
                    safe_filename,
                    stored_pdf_name,
                    pdf_sha256,
                    hashlib.sha256(answer_csv).hexdigest(),
                    json.dumps(manifest, separators=(",", ":")),
                    json.dumps(diagnostics, separators=(",", ":")),
                    status,
                    0 if published_package_id else 1,
                    published_package_id,
                    now,
                    now,
                ),
            )
            connection.commit()
        return ImportDraft(
            id=draft_id,
            title=chosen_title or "Untitled Test Package",
            original_filename=safe_filename,
            status=status,
            editable=published_package_id is None,
            question_count=len(csv_result.rows),
            diagnostics=tuple(diagnostics),
            questions=self._questions_with_regions(draft_id, manifest),
            source_pdf_url=(
                f"/api/import-drafts/{draft_id}/source.pdf" if stored_pdf_name else None
            ),
            published_package_id=published_package_id,
        )

    def get_import_draft(self, draft_id: str) -> ImportDraft | None:
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM import_drafts WHERE id = ?", (draft_id,)
            ).fetchone()
        if row is None:
            return None
        manifest = json.loads(row["manifest_json"])
        return ImportDraft(
            id=row["id"],
            title=row["title"],
            original_filename=row["original_filename"],
            status=row["status"],
            editable=bool(row["editable"]),
            question_count=len(manifest),
            diagnostics=tuple(json.loads(row["diagnostics_json"])),
            questions=self._questions_with_regions(draft_id, manifest),
            source_pdf_url=(
                f"/api/import-drafts/{draft_id}/source.pdf"
                if row["stored_pdf_name"]
                else None
            ),
            published_package_id=row["published_package_id"],
            revision_package_id=row["revision_package_id"],
        )

    def list_import_drafts(self) -> list[dict[str, object]]:
        with connect(self._data_root) as connection:
            rows = connection.execute(
                "SELECT id FROM import_drafts WHERE editable = 1 ORDER BY updated_at DESC"
            ).fetchall()
        return [
            draft.as_payload()
            for row in rows
            if (draft := self.get_import_draft(row["id"]))
        ]

    def replace_answer_csv(self, draft_id: str, data: bytes) -> ImportDraft:
        draft = self.get_import_draft(draft_id)
        if draft is None:
            raise AuthoringError("draft_not_found", "Import Draft not found.")
        if not draft.editable:
            raise AuthoringError(
                "draft_locked", "Published Import Drafts are read-only."
            )
        parsed = parse_answer_csv(data)
        diagnostics = [
            item for item in draft.diagnostics if item.get("field") == "source_pdf"
        ]
        diagnostics.extend(asdict(item) for item in parsed.diagnostics)
        with connect(self._data_root) as connection:
            connection.execute(
                "DELETE FROM question_regions WHERE draft_id = ?", (draft_id,)
            )
            connection.execute(
                """UPDATE import_drafts SET csv_sha256=?, manifest_json=?,
                               diagnostics_json=?, status=?, updated_at=? WHERE id=?""",
                (
                    hashlib.sha256(data).hexdigest(),
                    json.dumps([asdict(row) for row in parsed.rows]),
                    json.dumps(diagnostics),
                    "invalid" if diagnostics else "mapping",
                    datetime.now(UTC).isoformat(),
                    draft_id,
                ),
            )
            connection.commit()
        updated = self.get_import_draft(draft_id)
        assert updated is not None
        return updated

    def verify_package_source(self, package_id: str) -> bool:
        source = self.package_source_pdf(package_id)
        if source is None:
            return False
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT pdf_sha256 FROM test_packages WHERE id=?", (package_id,)
            ).fetchone()
        try:
            with source.open("rb") as handle:
                return (
                    hashlib.file_digest(handle, "sha256").hexdigest()
                    == row["pdf_sha256"]
                )
        except OSError:
            return False

    def source_pdf(self, draft_id: str) -> Path | None:
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT stored_pdf_name FROM import_drafts WHERE id = ?", (draft_id,)
            ).fetchone()
        if row is None or not row["stored_pdf_name"]:
            return None
        path = (self._data_root / "documents" / row["stored_pdf_name"]).resolve()
        documents = (self._data_root / "documents").resolve()
        return path if path.is_relative_to(documents) and path.is_file() else None

    def _page_count(self, draft_id: str, error: str) -> int:
        source = self.source_pdf(draft_id)
        if source is None:
            raise AuthoringError(error, "Source PDF is unavailable.")
        with source.open("rb") as handle:
            return len(PdfReader(handle).pages)

    def set_question_presentation(
        self, draft_id: str, question_index: int, presentation: QuestionPresentation
    ) -> ImportDraft:
        draft = self.get_import_draft(draft_id)
        if draft is None:
            raise AuthoringError("draft_not_found", "Import Draft not found.")
        if not draft.editable:
            raise AuthoringError(
                "draft_locked", "Published Import Drafts are read-only."
            )
        if not 0 <= question_index < draft.question_count:
            raise AuthoringError("question_not_found", "Question not found.")
        question = draft.questions[question_index]
        section = question["section"]
        response_type = question["responseType"]
        if response_type == "multiple_choice":
            if not presentation.choices:
                raise AuthoringError(
                    "invalid_presentation",
                    "Multiple-choice questions need answer content for A, B, C, and D.",
                )
            if section == "Math" and presentation.stimulus:
                raise AuthoringError(
                    "invalid_presentation",
                    "Place Math figures in the question stem or answer content.",
                )
        else:
            if presentation.choices:
                raise AuthoringError(
                    "invalid_presentation",
                    "Student-produced responses do not take answer choices.",
                )
            if presentation.stimulus:
                raise AuthoringError(
                    "invalid_presentation",
                    "Place the problem content in the question stem.",
                )
        page_count = self._page_count(draft_id, "invalid_presentation")
        if any(region["pageNumber"] > page_count for region in presentation.regions()):
            raise AuthoringError(
                "invalid_presentation",
                "Question Region page is outside the Source PDF.",
            )
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT manifest_json FROM import_drafts WHERE id = ?", (draft_id,)
            ).fetchone()
            manifest = json.loads(row["manifest_json"])
            manifest[question_index]["presentation"] = presentation.model_dump(
                exclude_none=True
            )
            connection.execute(
                "UPDATE import_drafts SET manifest_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(manifest), datetime.now(UTC).isoformat(), draft_id),
            )
            connection.commit()
        return self.get_import_draft(draft_id)

    def set_question_regions(
        self, draft_id: str, question_index: int, regions: list[dict[str, object]]
    ) -> ImportDraft:
        draft = self.get_import_draft(draft_id)
        if draft is None:
            raise AuthoringError("draft_not_found", "Import Draft not found.")
        if not draft.editable:
            raise AuthoringError(
                "draft_locked", "Published Import Drafts are read-only."
            )
        if not 0 <= question_index < draft.question_count:
            raise AuthoringError("question_not_found", "Question not found.")
        if not regions:
            raise AuthoringError(
                "missing_regions", "At least one Question Region is required."
            )
        page_count = self._page_count(draft_id, "invalid_region")
        for item in regions:
            page = int(item["page_number"])
            x = float(item["x"])
            y = float(item["y"])
            width = float(item["width"])
            height = float(item["height"])
            if (
                page < 1
                or page > page_count
                or not all(math.isfinite(value) for value in (x, y, width, height))
                or x < 0
                or y < 0
                or width <= 0
                or height <= 0
                or x + width > 1
                or y + height > 1
            ):
                raise AuthoringError(
                    "invalid_region", "Question Regions must stay within the page."
                )
        with connect(self._data_root) as connection:
            connection.execute(
                "DELETE FROM question_regions WHERE draft_id = ? AND question_index = ?",
                (draft_id, question_index),
            )
            for ordinal, item in enumerate(regions, start=1):
                connection.execute(
                    """
                    INSERT INTO question_regions (
                        id, draft_id, question_index, ordinal, page_number,
                        x, y, width, height, confirmed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        draft_id,
                        question_index,
                        ordinal,
                        int(item["page_number"]),
                        float(item["x"]),
                        float(item["y"]),
                        float(item["width"]),
                        float(item["height"]),
                        bool(item["confirmed"]),
                    ),
                )
            connection.execute(
                "UPDATE import_drafts SET updated_at = ? WHERE id = ?",
                (datetime.now(UTC).isoformat(), draft_id),
            )
            connection.commit()
        updated = self.get_import_draft(draft_id)
        assert updated is not None
        return updated

    def start_package_revision(self, package_id: str) -> ImportDraft:
        """Open an editable revision draft that carries a package's own
        source files and answer manifest so converted question content can be
        published as a new revision of the same family."""

        with connect(self._data_root) as connection:
            package = connection.execute(
                "SELECT * FROM test_packages WHERE id = ?", (package_id,)
            ).fetchone()
        if package is None:
            raise AuthoringError("package_not_found", "Test Package not found.")
        stored_pdf = self._data_root / "documents" / package["stored_pdf_name"]
        if not stored_pdf.is_file():
            raise AuthoringError(
                "unavailable_source", "The Test Package Source PDF is missing."
            )
        manifest = []
        for question in json.loads(package["manifest_json"]):
            manifest.append(
                {
                    "section": question["section"],
                    "module": question["module"],
                    "question_number": question["question_number"],
                    "response_type": question["response_type"],
                    "accepted_answers": question["accepted_answers"],
                    "category": question["category"],
                    "source_row": question["source_row"],
                }
            )
        draft_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        with connect(self._data_root) as connection:
            connection.execute(
                """
                INSERT INTO import_drafts (
                    id, title, original_filename, stored_pdf_name, pdf_sha256,
                    csv_sha256, manifest_json, diagnostics_json, status, editable,
                    published_package_id, revision_package_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mapping', 1, NULL, ?, ?, ?)
                """,
                (
                    draft_id,
                    package["title"],
                    package["original_filename"],
                    package["stored_pdf_name"],
                    package["pdf_sha256"],
                    package["csv_sha256"],
                    json.dumps(manifest, separators=(",", ":")),
                    "[]",
                    package_id,
                    now,
                    now,
                ),
            )
            connection.commit()
        draft = self.get_import_draft(draft_id)
        assert draft is not None
        return draft

    def publish(self, draft_id: str) -> dict[str, object]:
        draft = self.get_import_draft(draft_id)
        if draft is None:
            raise AuthoringError("draft_not_found", "Import Draft not found.")
        if draft.published_package_id:
            package = self.get_package(draft.published_package_id)
            assert package is not None
            return package
        if draft.status == "invalid":
            raise AuthoringError(
                "invalid_draft",
                "Resolve every Import Draft diagnostic before publishing.",
            )
        if draft.mapping_progress["confirmed"] != draft.question_count:
            raise AuthoringError(
                "incomplete_mapping",
                "Every question needs a confirmed Question Region.",
            )

        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM import_drafts WHERE id = ?", (draft_id,)
            ).fetchone()
            assert row is not None
            source_path = self._data_root / "documents" / row["stored_pdf_name"]
            digest = hashlib.sha256()
            with source_path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
            if digest.hexdigest() != row["pdf_sha256"]:
                raise AuthoringError(
                    "source_changed", "The Source PDF changed after import."
                )

            manifest = json.loads(row["manifest_json"])
            descriptors = [
                QuestionDescriptor(
                    item["section"], item["module"], item["question_number"]
                )
                for item in manifest
            ]
            eligibility = classify_package(descriptors)
            if not eligibility.practice_eligible:
                raise AuthoringError(
                    "invalid_package", "This Import Draft cannot form a Test Package."
                )

            # Serialize revision allocation: the write lock is taken before
            # the latest revision is read so two concurrent publishes of the
            # same title cannot both allocate the next revision number.
            connection.execute("BEGIN IMMEDIATE")
            if row["revision_package_id"]:
                target = connection.execute(
                    """
                    SELECT family_id, pdf_sha256, csv_sha256 FROM test_packages
                    WHERE id = ?
                    """,
                    (row["revision_package_id"],),
                ).fetchone()
                if target is None:
                    raise AuthoringError(
                        "package_not_found",
                        "The package being revised no longer exists.",
                    )
                if (
                    target["pdf_sha256"] != row["pdf_sha256"]
                    or target["csv_sha256"] != row["csv_sha256"]
                ):
                    raise AuthoringError(
                        "revision_mismatch",
                        "A revision must keep the package's Source PDF and Answer CSV.",
                    )
                latest = connection.execute(
                    """
                    SELECT revision FROM test_packages
                    WHERE family_id = ? ORDER BY revision DESC LIMIT 1
                    """,
                    (target["family_id"],),
                ).fetchone()
                family_id = target["family_id"]
                revision = int(latest["revision"]) + 1
            else:
                latest = connection.execute(
                    """
                    SELECT family_id, revision FROM test_packages
                    WHERE title = ? ORDER BY revision DESC LIMIT 1
                    """,
                    (row["title"],),
                ).fetchone()
                family_id = latest["family_id"] if latest else str(uuid.uuid4())
                revision = int(latest["revision"]) + 1 if latest else 1
            package_id = str(uuid.uuid4())
            questions = []
            for index, item in enumerate(manifest):
                question = dict(item)
                question["id"] = str(uuid.uuid5(uuid.UUID(package_id), str(index)))
                question["index"] = index
                question["regions"] = list(draft.questions[index]["regions"])
                questions.append(question)
            now = datetime.now(UTC).isoformat()
            connection.execute(
                """
                INSERT INTO test_packages (
                    id, family_id, revision, title, original_filename,
                    stored_pdf_name, pdf_sha256, csv_sha256, manifest_json,
                    regions_json, question_count, simulation_eligible,
                    eligibility_reasons_json, archived, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    package_id,
                    family_id,
                    revision,
                    row["title"],
                    row["original_filename"],
                    row["stored_pdf_name"],
                    row["pdf_sha256"],
                    row["csv_sha256"],
                    json.dumps(questions, separators=(",", ":")),
                    json.dumps([question["regions"] for question in questions]),
                    len(questions),
                    eligibility.simulation_eligible,
                    json.dumps(eligibility.reasons),
                    now,
                ),
            )
            connection.execute(
                """
                UPDATE import_drafts
                SET status = 'published', editable = 0, published_package_id = ?, updated_at = ?
                WHERE id = ?
                """,
                (package_id, now, draft_id),
            )
            connection.commit()
        package = self.get_package(package_id)
        assert package is not None
        return package

    def list_packages(
        self, *, include_archived: bool = False
    ) -> list[dict[str, object]]:
        where = "" if include_archived else "WHERE archived = 0"
        with connect(self._data_root) as connection:
            rows = connection.execute(
                f"SELECT * FROM test_packages {where} ORDER BY created_at DESC"
            ).fetchall()
        return [self._package_payload(row) for row in rows]

    def get_package(self, package_id: str) -> dict[str, object] | None:
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM test_packages WHERE id = ?", (package_id,)
            ).fetchone()
        return self._package_payload(row) if row else None

    def package_source_pdf(self, package_id: str) -> Path | None:
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT stored_pdf_name FROM test_packages WHERE id = ?", (package_id,)
            ).fetchone()
        if row is None:
            return None
        path = (self._data_root / "documents" / row["stored_pdf_name"]).resolve()
        documents = (self._data_root / "documents").resolve()
        return path if path.is_relative_to(documents) and path.is_file() else None

    def set_archived(self, package_id: str, *, archived: bool) -> dict[str, object]:
        with connect(self._data_root) as connection:
            changed = connection.execute(
                "UPDATE test_packages SET archived = ? WHERE id = ?",
                (archived, package_id),
            ).rowcount
            connection.commit()
        if not changed:
            raise AuthoringError("package_not_found", "Test Package not found.")
        package = self.get_package(package_id)
        assert package is not None
        return package

    def permanently_delete(self, package_id: str, confirmation: str) -> dict[str, int]:
        with connect(self._data_root) as connection:
            package = connection.execute(
                "SELECT * FROM test_packages WHERE id = ?", (package_id,)
            ).fetchone()
            if package is None:
                raise AuthoringError("package_not_found", "Test Package not found.")
            if confirmation != package["title"]:
                raise AuthoringError(
                    "confirmation_mismatch",
                    "Type the exact Test Package title to confirm permanent deletion.",
                )
            attempt_count = connection.execute(
                "SELECT COUNT(*) FROM attempts WHERE package_id = ?", (package_id,)
            ).fetchone()[0]
            connection.execute(
                "DELETE FROM attempt_setups WHERE package_id = ?", (package_id,)
            )
            connection.execute(
                "DELETE FROM attempts WHERE package_id = ?", (package_id,)
            )
            connection.execute(
                "DELETE FROM import_drafts WHERE published_package_id = ?",
                (package_id,),
            )
            connection.execute(
                "DELETE FROM import_drafts WHERE revision_package_id = ?",
                (package_id,),
            )
            connection.execute("DELETE FROM test_packages WHERE id = ?", (package_id,))
            connection.commit()

        document = (
            self._data_root / "documents" / package["stored_pdf_name"]
        ).resolve()
        documents_root = (self._data_root / "documents").resolve()
        if document.is_relative_to(documents_root) and not self._stored_pdf_in_use(
            package["stored_pdf_name"]
        ):
            document.unlink(missing_ok=True)
        render_root = (self._data_root / "renders" / package_id).resolve()
        allowed_renders = (self._data_root / "renders").resolve()
        if render_root.is_relative_to(allowed_renders) and render_root.is_dir():
            import shutil

            shutil.rmtree(render_root)
        return {"removedAttempts": int(attempt_count), "removedPackages": 1}

    def _stored_pdf_in_use(self, stored_pdf_name: str) -> bool:
        """Revision drafts deliberately share a package's stored source files,
        so a stored PDF may only be deleted when no remaining package or draft
        still references it."""
        with connect(self._data_root) as connection:
            references = connection.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM test_packages WHERE stored_pdf_name = ?)
                    + (SELECT COUNT(*) FROM import_drafts WHERE stored_pdf_name = ?)
                """,
                (stored_pdf_name, stored_pdf_name),
            ).fetchone()[0]
        return bool(references)

    def _questions_with_regions(
        self, draft_id: str, manifest: list[dict[str, object]]
    ) -> tuple[dict[str, object], ...]:
        with connect(self._data_root) as connection:
            region_rows = connection.execute(
                """
                SELECT * FROM question_regions WHERE draft_id = ?
                ORDER BY question_index, ordinal
                """,
                (draft_id,),
            ).fetchall()
        grouped: dict[int, list[dict[str, object]]] = {}
        for row in region_rows:
            grouped.setdefault(row["question_index"], []).append(
                {
                    "id": row["id"],
                    "ordinal": row["ordinal"],
                    "pageNumber": row["page_number"],
                    "x": row["x"],
                    "y": row["y"],
                    "width": row["width"],
                    "height": row["height"],
                    "confirmed": bool(row["confirmed"]),
                }
            )
        questions = []
        for index, item in enumerate(manifest):
            question = {
                "index": index,
                "section": item["section"],
                "module": item["module"],
                "questionNumber": item["question_number"],
                "responseType": item["response_type"],
                "acceptedAnswers": item["accepted_answers"],
                "category": item["category"],
                "regions": (
                    QuestionPresentation.model_validate(item["presentation"]).regions()
                    if item.get("presentation")
                    else grouped.get(index, [])
                ),
            }
            if item.get("presentation"):
                question["presentation"] = item["presentation"]
            questions.append(question)
        return tuple(questions)

    @staticmethod
    def _package_payload(row: object) -> dict[str, object]:
        questions = json.loads(row["manifest_json"])
        sections = list(dict.fromkeys(question["section"] for question in questions))
        return {
            "id": row["id"],
            "familyId": row["family_id"],
            "revision": row["revision"],
            "title": row["title"],
            "originalFilename": row["original_filename"],
            "questionCount": row["question_count"],
            "sections": sections,
            "practiceEligible": True,
            "simulationEligible": bool(row["simulation_eligible"]),
            "eligibilityReasons": json.loads(row["eligibility_reasons_json"]),
            "archived": bool(row["archived"]),
            "createdAt": row["created_at"],
            "questions": questions,
            "sourcePdfUrl": f"/api/test-packages/{row['id']}/source.pdf",
        }

    @staticmethod
    def _diagnostics(
        csv_result: AnswerCsvResult, pdf_result: PdfPreflightResult
    ) -> list[dict[str, object]]:
        diagnostics = [asdict(item) for item in csv_result.diagnostics]
        diagnostics.extend(
            {
                "code": item.code,
                "row": None,
                "field": "source_pdf",
                "message": item.message,
            }
            for item in pdf_result.diagnostics
        )
        return diagnostics
