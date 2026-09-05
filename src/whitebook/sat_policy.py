"""SAT policy constants shared by eligibility, practice rules, and attempts.

One module owns the standard shapes so a policy change is a single edit.
"""

READING_AND_WRITING = "Reading and Writing"
MATH = "Math"

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


def standard_module_seconds(section: str) -> int:
    """Standard countdown of one complete Module for the Section."""
    return 32 * 60 if section == READING_AND_WRITING else 35 * 60


BREAK_SECONDS = 10 * 60
