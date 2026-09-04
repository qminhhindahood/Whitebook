from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class GradeStatus(str, Enum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    UNANSWERED = "unanswered"


MULTIPLE_CHOICE = "multiple_choice"
STUDENT_PRODUCED_RESPONSE = "student_produced_response"

SPR_GLYPH_SUBSTITUTIONS: dict[str, str] = {
    "−": "-",  # U+2212 MINUS SIGN
    "－": "-",  # U+FF0D FULLWIDTH HYPHEN-MINUS
    "﹣": "-",  # U+FE63 SMALL HYPHEN-MINUS
    "．": ".",  # U+FF0E FULLWIDTH FULL STOP
    "。": ".",  # U+3002 IDEOGRAPHIC FULL STOP
}
_SPR_TRANSLATIONS = str.maketrans(SPR_GLYPH_SUBSTITUTIONS)


@dataclass(frozen=True)
class LearnerResponse:
    """One recorded answer; only the selected response participates in grading."""

    selected: str | None
    eliminated: tuple[str, ...] = ()


@dataclass(frozen=True)
class GradingQuestion:
    response_type: str
    accepted_answers: tuple[str, ...]


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


def _normalize_spr(value: str) -> str:
    return value.strip().translate(_SPR_TRANSLATIONS)


def grade_spr(selected: str | None, accepted: tuple[str, ...]) -> GradeStatus:
    if selected is None or not selected.strip():
        return GradeStatus.UNANSWERED
    answer = _normalize_spr(selected)
    return (
        GradeStatus.CORRECT
        if any(answer == _normalize_spr(value) for value in accepted)
        else GradeStatus.INCORRECT
    )


def grade_question(response: LearnerResponse, question: GradingQuestion) -> GradeStatus:
    if question.response_type == MULTIPLE_CHOICE:
        return grade_mcq(response.selected, question.accepted_answers[0])
    if question.response_type == STUDENT_PRODUCED_RESPONSE:
        return grade_spr(response.selected, question.accepted_answers)
    raise ValueError(f"unsupported response type: {question.response_type}")


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
