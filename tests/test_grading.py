from whitebook.grading import (
    SPR_GLYPH_SUBSTITUTIONS,
    GradeStatus,
    GradingQuestion,
    LearnerResponse,
    grade_mcq,
    grade_question,
    grade_spr,
    summarize_grades,
)

MULTIPLE_CHOICE = "multiple_choice"
STUDENT_PRODUCED_RESPONSE = "student_produced_response"


def test_mcq_grades_correct_incorrect_and_unanswered() -> None:
    assert grade_mcq("A", "A") is GradeStatus.CORRECT
    assert grade_mcq("B", "A") is GradeStatus.INCORRECT
    assert grade_mcq(None, "A") is GradeStatus.UNANSWERED
    assert grade_mcq("  ", "A") is GradeStatus.UNANSWERED
    assert grade_mcq(" a ", "A") is GradeStatus.CORRECT


def test_mcq_grades_only_the_selected_response() -> None:
    response = LearnerResponse(selected="A", eliminated=("B", "C", "D"))
    question = GradingQuestion(
        response_type=MULTIPLE_CHOICE, accepted_answers=("A",)
    )

    assert grade_question(response, question) is GradeStatus.CORRECT

    wrong_despite_eliminating_answer = LearnerResponse(
        selected="B", eliminated=("A", "C", "D")
    )
    assert (
        grade_question(wrong_despite_eliminating_answer, question)
        is GradeStatus.INCORRECT
    )

    unanswered_with_eliminations = LearnerResponse(
        selected=None, eliminated=("A", "B")
    )
    assert (
        grade_question(unanswered_with_eliminations, question)
        is GradeStatus.UNANSWERED
    )


def test_grade_question_dispatches_by_response_type() -> None:
    mcq = GradingQuestion(response_type=MULTIPLE_CHOICE, accepted_answers=("C",))
    spr = GradingQuestion(
        response_type=STUDENT_PRODUCED_RESPONSE, accepted_answers=("3/2",)
    )

    assert grade_question(LearnerResponse(selected="c"), mcq) is GradeStatus.CORRECT
    assert (
        grade_question(LearnerResponse(selected="1.5"), spr) is GradeStatus.INCORRECT
    )
    assert grade_question(LearnerResponse(selected="3/2"), spr) is GradeStatus.CORRECT


def test_spr_matches_each_explicitly_supplied_representation() -> None:
    accepted = ("3/2", "1.5", "1 1/2")

    assert grade_spr("3/2", accepted) is GradeStatus.CORRECT
    assert grade_spr("1.5", accepted) is GradeStatus.CORRECT
    assert grade_spr("1 1/2", accepted) is GradeStatus.CORRECT
    assert grade_spr(None, accepted) is GradeStatus.UNANSWERED


def test_spr_trims_surrounding_whitespace() -> None:
    accepted = ("-1.5", "3/2")

    assert grade_spr("  -1.5\t", accepted) is GradeStatus.CORRECT
    assert grade_spr(" -1.5 ", accepted) is GradeStatus.CORRECT
    assert grade_spr("\n3/2", accepted) is GradeStatus.CORRECT


def test_spr_applies_only_the_safe_glyph_substitutions() -> None:
    accepted = ("-0.5",)

    for variant in ("-0.5", "−0.5", "－0.5", "﹣0.5"):
        assert grade_spr(variant, accepted) is GradeStatus.CORRECT
    for variant in ("-0．5", "−0．5", "－0．5", "﹣0．5"):
        assert grade_spr(variant, accepted) is GradeStatus.CORRECT
    for variant in ("-0。5", "−0。5", "－0。5", "﹣0。5"):
        assert grade_spr(variant, accepted) is GradeStatus.CORRECT

    assert set(SPR_GLYPH_SUBSTITUTIONS) == {
        "−",
        "－",
        "﹣",
        "．",
        "。",
    }
    assert set(SPR_GLYPH_SUBSTITUTIONS.values()) == {"-", "."}


def test_spr_does_not_solve_numeric_equivalence() -> None:
    accepted = ("1.5", "3/2")

    for non_equivalent in ("1.50", "1.500", "0.75 * 2", "6/4", "3 / 2", "1+0.5"):
        assert grade_spr(non_equivalent, accepted) is GradeStatus.INCORRECT


def test_spr_normalizes_glyphs_in_both_directions() -> None:
    # Glyph variants match whether the learner or the Answer CSV supplied them.
    assert grade_spr("−1.5", ("-1.5",)) is GradeStatus.CORRECT
    assert grade_spr("-1.5", ("−1.5",)) is GradeStatus.CORRECT
    assert grade_spr("1．5", ("1.5",)) is GradeStatus.CORRECT
    assert grade_spr("1.5", ("1．5",)) is GradeStatus.CORRECT


def test_raw_accuracy_keeps_unanswered_questions_in_the_denominator() -> None:
    summary = summarize_grades(
        [GradeStatus.CORRECT, GradeStatus.INCORRECT, GradeStatus.UNANSWERED]
    )

    assert (summary.correct, summary.incorrect, summary.unanswered, summary.total) == (
        1,
        1,
        1,
        3,
    )
    assert summary.percentage == 100 / 3


def test_raw_accuracy_defines_zero_question_behavior() -> None:
    empty = summarize_grades([])

    assert (empty.correct, empty.incorrect, empty.unanswered, empty.total) == (
        0,
        0,
        0,
        0,
    )
    assert empty.percentage == 0.0
