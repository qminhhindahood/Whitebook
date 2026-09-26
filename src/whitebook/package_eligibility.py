from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from whitebook.sat_policy import (
    SECTION_EXAM_SECTIONS,
    STANDARD_MODULE_COUNTS,
    section_exam_total_questions,
    standard_module_position,
)


@dataclass(frozen=True)
class QuestionDescriptor:
    section: str
    module: int
    question_number: int


@dataclass(frozen=True)
class PackageEligibility:
    practice_eligible: bool
    simulation_eligible: bool
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class SectionExamEligibility:
    eligible: bool
    section: str | None
    question_count: int
    reasons: tuple[str, ...]


def classify_package(questions: list[QuestionDescriptor]) -> PackageEligibility:
    reasons: list[str] = []

    def add(reason: str) -> None:
        if reason not in reasons:
            reasons.append(reason)

    if not questions:
        add("empty_package")
    seen: set[tuple[str, int, int]] = set()
    counts: dict[tuple[str, int], int] = {}
    numbers: dict[tuple[str, int], list[int]] = {}
    structurally_valid = bool(questions)
    for question in questions:
        if question.section not in {"Reading and Writing", "Math"}:
            add("invalid_section")
            structurally_valid = False
        if question.module not in {1, 2}:
            add("invalid_module")
            structurally_valid = False
        if question.question_number <= 0:
            add("invalid_question_number")
            structurally_valid = False
        identity = (question.section, question.module, question.question_number)
        if identity in seen:
            add("duplicate_question_number")
            structurally_valid = False
        seen.add(identity)
        counts[(question.section, question.module)] = (
            counts.get((question.section, question.module), 0) + 1
        )
        numbers.setdefault((question.section, question.module), []).append(
            question.question_number
        )

    expected = STANDARD_MODULE_COUNTS
    if any(module not in counts for module in expected):
        add("missing_standard_module")
    if any(
        module in counts and counts[module] != expected_count
        for module, expected_count in expected.items()
    ):
        add("wrong_question_count")
    for module, module_numbers in numbers.items():
        if module in expected and module_numbers != list(
            range(1, len(module_numbers) + 1)
        ):
            add("unordered_question_numbers")
    # Modules must appear as contiguous runs in the standard sitting order;
    # interleaved rows (e.g. RW1, M1, RW2, M2) would otherwise build a
    # Simulation plan with the Section break in the wrong place.
    positions = [
        position
        for question in questions
        if (
            position := standard_module_position((question.section, question.module))
        )
        is not None
    ]
    if positions != sorted(positions):
        add("interleaved_modules")
    return PackageEligibility(
        practice_eligible=structurally_valid,
        simulation_eligible=structurally_valid and not reasons,
        reasons=tuple(reasons),
    )


def classify_section_exam(questions: list[dict[str, Any]]) -> SectionExamEligibility:
    """Check whether a published package can supply one generated Section Exam."""
    reasons: list[str] = []

    def add(reason: str) -> None:
        if reason not in reasons:
            reasons.append(reason)

    sections = list(dict.fromkeys(question.get("section") for question in questions))
    supported_sections = [
        section for section in sections if section in SECTION_EXAM_SECTIONS
    ]
    section = supported_sections[0] if len(supported_sections) == 1 else None
    if not questions:
        add("empty_package")
    if any(value not in SECTION_EXAM_SECTIONS for value in sections):
        add("invalid_section")
    if len(sections) > 1:
        add("mixed_sections")

    seen_ids: set[str] = set()
    valid_count = 0
    for question in questions:
        question_id = question.get("id")
        response_type = question.get("response_type")
        accepted_answers = question.get("accepted_answers")
        valid = (
            isinstance(question_id, str)
            and bool(question_id)
            and question_id not in seen_ids
            and isinstance(question.get("module"), int)
            and question.get("module") in {1, 2}
            and isinstance(question.get("question_number"), int)
            and question.get("question_number") > 0
            and response_type in {"multiple_choice", "student_produced_response"}
            and isinstance(accepted_answers, list)
            and bool(accepted_answers)
            and (
                response_type != "multiple_choice"
                or accepted_answers[0] in {"A", "B", "C", "D"}
            )
        )
        if not valid:
            add("invalid_question")
            continue
        seen_ids.add(question_id)
        valid_count += 1

    required = section_exam_total_questions(section) if section else None
    if required is None:
        if not sections:
            add("empty_package")
    elif valid_count < required:
        add("insufficient_questions")

    return SectionExamEligibility(
        eligible=not reasons,
        section=section,
        question_count=valid_count,
        reasons=tuple(reasons),
    )
