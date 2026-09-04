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
