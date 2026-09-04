from whitebook.grading import GradeStatus, grade_mcq, grade_spr, summarize_grades


def test_mcq_grades_only_the_selected_response() -> None:
    assert grade_mcq("A", "A") is GradeStatus.CORRECT
    assert grade_mcq("B", "A") is GradeStatus.INCORRECT
    assert grade_mcq(None, "A") is GradeStatus.UNANSWERED


def test_spr_uses_only_explicit_representations_and_safe_glyph_normalization() -> None:
    accepted = ("-1.5", "3/2")
    assert grade_spr("  −1．5 ", accepted) is GradeStatus.CORRECT
    assert grade_spr("3/2", accepted) is GradeStatus.CORRECT
    assert grade_spr("1.50", accepted) is GradeStatus.INCORRECT
    assert grade_spr(None, accepted) is GradeStatus.UNANSWERED


def test_raw_accuracy_keeps_unanswered_questions_in_the_denominator() -> None:
    summary = summarize_grades(
        [GradeStatus.CORRECT, GradeStatus.INCORRECT, GradeStatus.UNANSWERED]
    )
    empty = summarize_grades([])

    assert (summary.correct, summary.incorrect, summary.unanswered, summary.total) == (
        1,
        1,
        1,
        3,
    )
    assert summary.percentage == 100 / 3
    assert empty.percentage == 0.0
