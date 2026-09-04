from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class GradeStatus(str, Enum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    UNANSWERED = "unanswered"


@dataclass(frozen=True)
class GradeSummary:
    correct: int
    incorrect: int
    unanswered: int
    total: int
    percentage: float


def grade_mcq(selected: str | None, correct: str) -> GradeStatus:
    if selected is None or not selected.strip():
        return GradeStatus.UNANSWERED
    return (
        GradeStatus.CORRECT
        if selected.strip().upper() == correct.strip().upper()
        else GradeStatus.INCORRECT
    )


def grade_spr(selected: str | None, accepted: tuple[str, ...]) -> GradeStatus:
    if selected is None or not selected.strip():
        return GradeStatus.UNANSWERED
    translations = str.maketrans(
        {
            "−": "-",
            "－": "-",
            "﹣": "-",
            "．": ".",
            "。": ".",
        }
    )

    def normalized(value: str) -> str:
        return value.strip().translate(translations)

    answer = normalized(selected)
    return (
        GradeStatus.CORRECT
        if any(answer == normalized(value) for value in accepted)
        else GradeStatus.INCORRECT
    )


def summarize_grades(statuses: list[GradeStatus]) -> GradeSummary:
    correct = statuses.count(GradeStatus.CORRECT)
    incorrect = statuses.count(GradeStatus.INCORRECT)
    unanswered = statuses.count(GradeStatus.UNANSWERED)
    total = len(statuses)
    return GradeSummary(
        correct=correct,
        incorrect=incorrect,
        unanswered=unanswered,
        total=total,
        percentage=(correct * 100 / total) if total else 0.0,
    )
