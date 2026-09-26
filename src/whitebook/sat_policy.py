"""SAT policy constants shared by eligibility, practice rules, and attempts.

One module owns the standard shapes so a policy change is a single edit.
"""

READING_AND_WRITING = "Reading and Writing"
MATH = "Math"

SECTION_EXAM_SECTIONS = (READING_AND_WRITING, MATH)

STANDARD_MODULE_COUNTS: dict[tuple[str, int], int] = {
    (READING_AND_WRITING, 1): 27,
    (READING_AND_WRITING, 2): 27,
    (MATH, 1): 22,
    (MATH, 2): 22,
}


def standard_module_count(section: str) -> int | None:
    """Question count of one standard Module; None for non-standard Sections."""
    if section == READING_AND_WRITING:
        return 27
    if section == MATH:
        return 22
    return None


def standard_module_position(module: tuple[str, int]) -> int | None:
    """Position of a Module in the standard sitting order; None if non-standard.

    The sitting order is the iteration order of STANDARD_MODULE_COUNTS:
    Reading and Writing Module 1, then 2, then Math Modules 1 and 2.
    """
    for position, standard in enumerate(STANDARD_MODULE_COUNTS):
        if standard == module:
            return position
    return None


def standard_module_seconds(section: str) -> int:
    """Standard countdown of one complete Module for the Section."""
    return 32 * 60 if section == READING_AND_WRITING else 35 * 60


def section_exam_module_count(section: str) -> int | None:
    """Number of generated Modules in a Section Exam for one Section."""
    return 2 if section in SECTION_EXAM_SECTIONS else None


def section_exam_total_questions(section: str) -> int | None:
    """Total questions required by a generated two-Module Section Exam."""
    count = standard_module_count(section)
    return count * 2 if count is not None else None


BREAK_SECONDS = 10 * 60
