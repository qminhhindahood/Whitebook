from whitebook.package_eligibility import QuestionDescriptor, classify_package


def full_shape() -> list[QuestionDescriptor]:
    return [
        QuestionDescriptor(section, module, question)
        for section, count in (("Reading and Writing", 27), ("Math", 22))
        for module in (1, 2)
        for question in range(1, count + 1)
    ]


def test_only_the_exact_standard_shape_is_simulation_eligible() -> None:
    result = classify_package(full_shape())
    assert result.practice_eligible is True
    assert result.simulation_eligible is True
    assert result.reasons == ()


def test_valid_partial_packages_remain_practice_eligible() -> None:
    result = classify_package([QuestionDescriptor("Math", 1, 1)])
    assert result.practice_eligible is True
    assert result.simulation_eligible is False
    assert "missing_standard_module" in result.reasons


def test_wrong_counts_duplicates_and_invalid_descriptors_are_precise() -> None:
    missing = classify_package(full_shape()[:-1])
    extra = classify_package(full_shape() + [QuestionDescriptor("Math", 2, 23)])
    duplicate = classify_package(full_shape() + [QuestionDescriptor("Math", 2, 22)])
    invalid = classify_package([QuestionDescriptor("Science", 3, 0)])

    assert "wrong_question_count" in missing.reasons
    assert "wrong_question_count" in extra.reasons
    assert "duplicate_question_number" in duplicate.reasons
    assert invalid.practice_eligible is False
    assert {"invalid_section", "invalid_module", "invalid_question_number"} <= set(
        invalid.reasons
    )


def test_single_complete_module_is_practice_only() -> None:
    questions = [
        QuestionDescriptor("Reading and Writing", 1, question)
        for question in range(1, 28)
    ]
    result = classify_package(questions)
    assert result.practice_eligible is True
    assert result.simulation_eligible is False
    assert set(result.reasons) == {"missing_standard_module"}


def test_single_section_packages_are_practice_only() -> None:
    reading_only = [
        QuestionDescriptor("Reading and Writing", module, question)
        for module in (1, 2)
        for question in range(1, 28)
    ]
    math_only = [
        QuestionDescriptor("Math", module, question)
        for module in (1, 2)
        for question in range(1, 23)
    ]
    for questions in (reading_only, math_only):
        result = classify_package(questions)
        assert result.practice_eligible is True
        assert result.simulation_eligible is False
        assert set(result.reasons) == {"missing_standard_module"}


def test_invalid_module_rejects_practice_precisely() -> None:
    result = classify_package([QuestionDescriptor("Math", 3, 5)])
    assert result.practice_eligible is False
    assert result.simulation_eligible is False
    assert set(result.reasons) == {"invalid_module", "missing_standard_module"}


def test_empty_packages_are_ineligible() -> None:
    result = classify_package([])
    assert result.practice_eligible is False
    assert result.simulation_eligible is False
    assert set(result.reasons) == {"empty_package", "missing_standard_module"}


def test_gap_in_numbering_blocks_simulation_but_not_practice() -> None:
    gapped = [
        question
        for question in full_shape()
        if not (
            question.section == "Reading and Writing"
            and question.module == 1
            and question.question_number == 27
        )
    ]
    insert_at = next(
        index
        for index, question in enumerate(gapped)
        if question.section == "Reading and Writing" and question.module == 2
    )
    gapped.insert(insert_at, QuestionDescriptor("Reading and Writing", 1, 28))

    result = classify_package(gapped)

    assert result.practice_eligible is True
    assert result.simulation_eligible is False
    assert set(result.reasons) == {"unordered_question_numbers"}


def test_shuffled_numbering_blocks_simulation_but_not_practice() -> None:
    shuffled = full_shape()
    shuffled[-1], shuffled[-2] = shuffled[-2], shuffled[-1]

    result = classify_package(shuffled)

    assert result.practice_eligible is True
    assert result.simulation_eligible is False
    assert set(result.reasons) == {"unordered_question_numbers"}


def test_short_but_contiguous_module_reports_only_the_count() -> None:
    result = classify_package(full_shape()[:-1])

    assert set(result.reasons) == {"wrong_question_count"}


def test_interleaved_module_rows_block_simulation_but_not_practice() -> None:
    rows = full_shape()
    rw2 = [question for question in rows if question.module == 2]
    interleaved = [
        question
        for question in rows
        if question.section == "Reading and Writing" and question.module == 1
    ] + [
        question
        for question in rows
        if question.section == "Math" and question.module == 1
    ] + rw2

    result = classify_package(interleaved)

    assert result.practice_eligible is True
    assert result.simulation_eligible is False
    assert set(result.reasons) == {"interleaved_modules"}
