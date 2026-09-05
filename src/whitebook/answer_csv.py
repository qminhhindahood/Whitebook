from __future__ import annotations

import csv
import io
from dataclasses import dataclass


@dataclass(frozen=True)
class AnswerRow:
    section: str
    module: int
    question_number: int
    response_type: str
    accepted_answers: tuple[str, ...]
    category: str | None
    source_row: int


@dataclass(frozen=True)
class CsvDiagnostic:
    code: str
    row: int | None
    field: str | None
    message: str


@dataclass(frozen=True)
class AnswerCsvResult:
    rows: tuple[AnswerRow, ...]
    diagnostics: tuple[CsvDiagnostic, ...]


HEADERS = (
    "section",
    "module",
    "question_number",
    "type",
    "correct_answer",
    "category",
)

READING_CATEGORIES = (
    "Word in Context",
    "Main Idea",
    "Text Structure",
    "Command of Evidence",
    "Inference",
    "Cross Text",
    "Grammar",
    "Transition",
    "Rhetorical Synthesis",
    "Details",
    "Vocabulary",
)
MATH_CATEGORIES = (
    "Algebra",
    "Advanced Math",
    "Problem-Solving and Data Analysis",
    "Geometry and Trigonometry",
)


def _key(value: str) -> str:
    return " ".join(value.strip().lower().replace("_", " ").split())


SECTION_VALUES = {
    "reading and writing": "Reading and Writing",
    "math": "Math",
}
TYPE_VALUES = {
    "multiple choice": "multiple_choice",
    "multiple-choice": "multiple_choice",
    "mcq": "multiple_choice",
    "student-produced response": "student_produced_response",
    "student produced response": "student_produced_response",
    "spr": "student_produced_response",
}
CATEGORY_VALUES = {_key(value): value for value in READING_CATEGORIES + MATH_CATEGORIES}


def _diagnostic(code: str, row: int | None, field: str | None) -> CsvDiagnostic:
    messages = {
        "csv_too_large": "The Answer CSV exceeds the configured size limit.",
        "invalid_encoding": "The Answer CSV must use UTF-8 encoding.",
        "malformed_csv": "The Answer CSV contains malformed quoting or an oversized field.",
        "invalid_headers": "The Answer CSV headers must match the v1 template exactly.",
        "invalid_row_width": "This row does not contain exactly six fields.",
        "required": "This required field is empty.",
        "invalid_section": "Section must be Reading and Writing or Math.",
        "invalid_module": "Module must be 1 or 2.",
        "invalid_question_number": "Question number must be a positive whole number.",
        "invalid_response_type": "Response type is not supported.",
        "invalid_mcq_answer": "A multiple-choice answer must be A, B, C, or D.",
        "invalid_spr_answer": "Student-produced responses must list nonempty accepted representations.",
        "invalid_category": "Question Category is not approved for this Section.",
        "duplicate_question_number": "Question number is duplicated within this Section and Module.",
    }
    return CsvDiagnostic(code, row, field, messages[code])


def parse_answer_csv(
    data: bytes, *, max_bytes: int = 10 * 1024 * 1024
) -> AnswerCsvResult:
    if len(data) > max_bytes:
        return AnswerCsvResult((), (_diagnostic("csv_too_large", None, None),))
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return AnswerCsvResult((), (_diagnostic("invalid_encoding", None, None),))

    reader = csv.reader(io.StringIO(text, newline=""), strict=True)
    try:
        headers = next(reader)
        values_rows = list(reader)
    except csv.Error:
        return AnswerCsvResult(
            (), (_diagnostic("malformed_csv", reader.line_num, None),)
        )
    except StopIteration:
        headers = []
        values_rows = []
    if tuple(headers) != HEADERS:
        return AnswerCsvResult((), (_diagnostic("invalid_headers", 1, "headers"),))

    rows: list[AnswerRow] = []
    diagnostics: list[CsvDiagnostic] = []
    seen: set[tuple[str, int, int]] = set()
    for source_row, values in enumerate(values_rows, start=2):
        if not values or all(not value.strip() for value in values):
            continue
        if len(values) != len(HEADERS):
            diagnostics.append(_diagnostic("invalid_row_width", source_row, None))
            continue
        raw = dict(zip(HEADERS, values, strict=True))
        row_start = len(diagnostics)
        for field in HEADERS[:-1]:
            if not raw[field].strip():
                diagnostics.append(_diagnostic("required", source_row, field))

        section = SECTION_VALUES.get(_key(raw["section"]))
        if raw["section"].strip() and section is None:
            diagnostics.append(_diagnostic("invalid_section", source_row, "section"))

        try:
            module = int(raw["module"])
        except ValueError:
            module = 0
        if raw["module"].strip() and module not in (1, 2):
            diagnostics.append(_diagnostic("invalid_module", source_row, "module"))

        try:
            question_number = int(raw["question_number"])
        except ValueError:
            question_number = 0
        if raw["question_number"].strip() and question_number <= 0:
            diagnostics.append(
                _diagnostic("invalid_question_number", source_row, "question_number")
            )

        response_type = TYPE_VALUES.get(_key(raw["type"]))
        if raw["type"].strip() and response_type is None:
            diagnostics.append(_diagnostic("invalid_response_type", source_row, "type"))

        answer = raw["correct_answer"].strip()
        accepted_answers: tuple[str, ...] = ()
        if answer and response_type == "multiple_choice":
            normalized_answer = answer.upper()
            if normalized_answer not in {"A", "B", "C", "D"}:
                diagnostics.append(
                    _diagnostic("invalid_mcq_answer", source_row, "correct_answer")
                )
            else:
                accepted_answers = (normalized_answer,)
        elif answer and response_type == "student_produced_response":
            accepted_answers = tuple(part.strip() for part in answer.split("|"))
            if not accepted_answers or any(not part for part in accepted_answers):
                diagnostics.append(
                    _diagnostic("invalid_spr_answer", source_row, "correct_answer")
                )

        raw_category = raw["category"].strip()
        category = CATEGORY_VALUES.get(_key(raw_category)) if raw_category else None
        allowed_categories = (
            set(READING_CATEGORIES)
            if section == "Reading and Writing"
            else set(MATH_CATEGORIES)
            if section == "Math"
            else set()
        )
        if raw_category and (category is None or category not in allowed_categories):
            diagnostics.append(_diagnostic("invalid_category", source_row, "category"))

        if section is not None and module in (1, 2) and question_number > 0:
            identity = (section, module, question_number)
            if identity in seen:
                diagnostics.append(
                    _diagnostic(
                        "duplicate_question_number", source_row, "question_number"
                    )
                )
            seen.add(identity)

        if len(diagnostics) == row_start:
            rows.append(
                AnswerRow(
                    section=section,
                    module=module,
                    question_number=question_number,
                    response_type=response_type,
                    accepted_answers=accepted_answers,
                    category=category,
                    source_row=source_row,
                )
            )
    return AnswerCsvResult(tuple(rows), tuple(diagnostics))


def blank_answer_csv() -> bytes:
    return (",".join(HEADERS) + "\r\n").encode("utf-8")


def example_answer_csv() -> bytes:
    return (
        ",".join(HEADERS)
        + "\r\nReading and Writing,1,1,multiple choice,A,Word in Context"
        + "\r\nMath,1,1,student-produced response,3/2|1.5,Algebra\r\n"
    ).encode("utf-8")
