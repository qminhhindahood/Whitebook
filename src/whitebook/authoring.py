from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from whitebook.answer_csv import AnswerCsvResult, parse_answer_csv
from whitebook.package_eligibility import QuestionDescriptor, classify_package
from whitebook.pdf_preflight import PdfPreflightResult, preflight_pdf
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

    @property
    def mapping_progress(self) -> dict[str, int]:
        confirmed = sum(
            1
            for question in self.questions
            if question["regions"]
            and all(region["confirmed"] for region in question["regions"])
        )
        return {"confirmed": confirmed, "total": self.question_count}

    def as_payload(self) -> dict[str, object]:
        next_unmapped = next(
            (
                question["index"]
                for question in self.questions
                if not question["regions"]
                or not all(region["confirmed"] for region in question["regions"])
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
        )

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
        for item in regions:
            page = int(item["page_number"])
            x = float(item["x"])
            y = float(item["y"])
            width = float(item["width"])
            height = float(item["height"])
            if (
                page < 1
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
                "regions": grouped.get(index, []),
            }
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
