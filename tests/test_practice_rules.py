from whitebook.practice_rules import (
    PracticeQuestion,
    PracticeRequest,
    build_practice_plan,
)

QUESTIONS = tuple(
    PracticeQuestion(
        id=f"rw-{module}-{number}",
        section="Reading and Writing",
        module=module,
        question_number=number,
        category=None if number == 1 else "Grammar",
    )
    for module in (1, 2)
    for number in range(1, 28)
)


def test_all_questions_includes_uncategorized_and_caps_without_duplicates() -> None:
    result = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1, 2),
            count=100,
            timing="elapsed",
        ),
    )
    assert result.errors == ()
    assert result.plan is not None
    assert len(result.plan.questions) == 54
    assert len({question.id for question in result.plan.questions}) == 54
    assert result.plan.capped is True
    assert result.plan.module_allocation == (1, 27, 2, 27)


def test_category_filter_even_allocation_and_exact_override() -> None:
    even = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1, 2),
            count=5,
            category="Grammar",
            timing="custom_countdown",
            countdown_seconds=600,
        ),
    )
    exact = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1, 2),
            count=5,
            module_counts=((1, 1), (2, 4)),
            timing="elapsed",
        ),
    )

    assert even.plan is not None and even.plan.module_allocation == (1, 3, 2, 2)
    assert all(question.category == "Grammar" for question in even.plan.questions)
    assert exact.plan is not None and exact.plan.module_allocation == (1, 1, 2, 4)


def test_source_order_and_deterministic_shuffle_stay_within_sections() -> None:
    ordered = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",), modules=(1, 2), count=6, timing="elapsed"
        ),
    )
    shuffled_a = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1, 2),
            count=6,
            timing="elapsed",
            shuffle=True,
            seed=8,
        ),
    )
    shuffled_b = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1, 2),
            count=6,
            timing="elapsed",
            shuffle=True,
            seed=8,
        ),
    )

    assert ordered.plan is not None
    assert [question.question_number for question in ordered.plan.questions] == [
        1,
        2,
        3,
        1,
        2,
        3,
    ]
    assert shuffled_a.plan == shuffled_b.plan
    assert shuffled_a.plan != ordered.plan


def test_sat_paced_requires_exactly_one_complete_module() -> None:
    complete = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1,),
            count=27,
            timing="sat_paced",
        ),
    )
    partial = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1,),
            count=10,
            timing="sat_paced",
        ),
    )
    bad_countdown = build_practice_plan(
        QUESTIONS,
        PracticeRequest(
            sections=("Reading and Writing",),
            modules=(1,),
            count=10,
            timing="custom_countdown",
            countdown_seconds=0,
        ),
    )

    assert complete.plan is not None and complete.plan.duration_seconds == 32 * 60
    assert partial.errors == ("sat_paced_requires_complete_module",)
    assert bad_countdown.errors == ("invalid_countdown",)
