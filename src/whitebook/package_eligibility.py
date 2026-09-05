from __future__ import annotations

from dataclasses import dataclass


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

    expected = {
        ("Reading and Writing", 1): 27,
        ("Reading and Writing", 2): 27,
        ("Math", 1): 22,
        ("Math", 2): 22,
    }
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
    return PackageEligibility(
        practice_eligible=structurally_valid,
        simulation_eligible=structurally_valid and not reasons,
        reasons=tuple(reasons),
    )
