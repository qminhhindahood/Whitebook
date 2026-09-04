from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass(frozen=True)
class PracticeQuestion:
    id: str
    section: str
    module: int
    question_number: int
    category: str | None = None


@dataclass(frozen=True)
class PracticeRequest:
    sections: tuple[str, ...]
    modules: tuple[int, ...]
    count: int
    timing: str
    category: str | None = None
    module_counts: tuple[tuple[int, int], ...] | None = None
    countdown_seconds: int | None = None
    shuffle: bool = False
    seed: int | None = None


@dataclass(frozen=True)
class PracticePlan:
    questions: tuple[PracticeQuestion, ...]
    capped: bool
    module_allocation: tuple[int, ...]
    duration_seconds: int | None


@dataclass(frozen=True)
class PracticePlanResult:
    plan: PracticePlan | None
    errors: tuple[str, ...]


def build_practice_plan(
    questions: tuple[PracticeQuestion, ...], request: PracticeRequest
) -> PracticePlanResult:
    errors: list[str] = []
    if request.count <= 0:
        errors.append("invalid_count")
    if not request.sections or not request.modules:
        errors.append("empty_selection")
    if request.timing not in {"elapsed", "custom_countdown", "sat_paced"}:
        errors.append("invalid_timing")
    if request.timing == "custom_countdown" and (
        request.countdown_seconds is None or request.countdown_seconds <= 0
    ):
        errors.append("invalid_countdown")

    matching = [
        question
        for question in questions
        if question.section in request.sections
        and question.module in request.modules
        and (request.category is None or question.category == request.category)
    ]
    if not matching:
        errors.append("no_matching_questions")

    duration: int | None = None
    if request.timing == "sat_paced":
        standard_count = None
        if len(request.sections) == 1 and len(request.modules) == 1:
            standard_count = (
                27
                if request.sections[0] == "Reading and Writing"
                else 22
                if request.sections[0] == "Math"
                else None
            )
        if (
            standard_count is None
            or request.count != standard_count
            or len(matching) != standard_count
        ):
            errors.append("sat_paced_requires_complete_module")
        else:
            duration = (
                32 * 60 if request.sections[0] == "Reading and Writing" else 35 * 60
            )
    elif request.timing == "custom_countdown":
        duration = request.countdown_seconds

    if errors:
        return PracticePlanResult(None, tuple(dict.fromkeys(errors)))

    final_count = min(request.count, len(matching))
    capped = final_count < request.count
    module_order = tuple(dict.fromkeys(request.modules))
    buckets = {
        module: [question for question in matching if question.module == module]
        for module in module_order
    }

    allocations: dict[int, int]
    if request.module_counts is not None:
        allocations = dict(request.module_counts)
        if (
            set(allocations) != set(module_order)
            or sum(allocations.values()) != final_count
        ):
            return PracticePlanResult(None, ("invalid_module_allocation",))
        if any(
            count < 0 or count > len(buckets[module])
            for module, count in allocations.items()
        ):
            return PracticePlanResult(None, ("invalid_module_allocation",))
    else:
        allocations = {module: 0 for module in module_order}
        remaining = final_count
        while remaining:
            progressed = False
            for module in module_order:
                if remaining and allocations[module] < len(buckets[module]):
                    allocations[module] += 1
                    remaining -= 1
                    progressed = True
            if not progressed:
                break

    selected: list[PracticeQuestion] = []
    for section in request.sections:
        section_questions: list[PracticeQuestion] = []
        for module in module_order:
            section_questions.extend(
                question
                for question in buckets[module][: allocations[module]]
                if question.section == section
            )
        if request.shuffle:
            random.Random(request.seed).shuffle(section_questions)
        selected.extend(section_questions)

    flat_allocation = tuple(
        value for module in module_order for value in (module, allocations[module])
    )
    return PracticePlanResult(
        PracticePlan(tuple(selected), capped, flat_allocation, duration), ()
    )
