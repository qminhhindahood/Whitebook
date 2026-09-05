from __future__ import annotations

from whitebook.answer_csv import (
    blank_answer_csv,
    example_answer_csv,
    parse_answer_csv,
)

HEADERS = "section,module,question_number,type,correct_answer,category\n"


def test_parses_and_canonicalizes_the_v1_contract() -> None:
    result = parse_answer_csv(
        (
            HEADERS
            + " reading   and writing ,1,1, multiple choice ,A, word   in context \n"
            + "MATH,2,4,student-produced response, 1.5 | 3/2 , advanced math\n"
        ).encode()
    )

    assert result.diagnostics == ()
    assert [(row.section, row.module, row.question_number) for row in result.rows] == [
        ("Reading and Writing", 1, 1),
        ("Math", 2, 4),
    ]
    assert result.rows[0].response_type == "multiple_choice"
    assert result.rows[0].accepted_answers == ("A",)
    assert result.rows[0].category == "Word in Context"
    assert result.rows[1].response_type == "student_produced_response"
    assert result.rows[1].accepted_answers == ("1.5", "3/2")
    assert result.rows[1].category == "Advanced Math"


def test_reports_header_encoding_row_and_duplicate_errors_without_answer_content() -> (
    None
):
    invalid = parse_answer_csv(
        (
            HEADERS
            + "Math,3,0,essay,SENSITIVE ANSWER,not a category\n"
            + "Math,1,1,multiple choice,E,Algebra\n"
            + "Math,1,1,multiple choice,A,Algebra\n"
        ).encode()
    )
    invalid_encoding = parse_answer_csv(b"\xff\xfe")
    wrong_headers = parse_answer_csv(
        b"section,module,question_number,type,correct_answer\n"
    )

    codes = {item.code for item in invalid.diagnostics}
    assert {
        "invalid_module",
        "invalid_question_number",
        "invalid_response_type",
        "invalid_category",
        "invalid_mcq_answer",
        "duplicate_question_number",
    } <= codes
    assert all("SENSITIVE ANSWER" not in item.message for item in invalid.diagnostics)
    assert invalid_encoding.diagnostics[0].code == "invalid_encoding"
    assert wrong_headers.diagnostics[0].code == "invalid_headers"


def test_rejects_oversized_and_missing_values() -> None:
    oversized = parse_answer_csv(b"a" * 21, max_bytes=20)
    missing = parse_answer_csv((HEADERS + "Math,1,1,multiple choice,,\n").encode())

    assert oversized.diagnostics[0].code == "csv_too_large"
    assert any(
        item.code == "required" and item.field == "correct_answer"
        for item in missing.diagnostics
    )


def test_blank_and_example_downloads_use_the_same_contract() -> None:
    blank = parse_answer_csv(blank_answer_csv())
    example = parse_answer_csv(example_answer_csv())

    assert blank.diagnostics == ()
    assert blank.rows == ()
    assert example.diagnostics == ()
    assert {row.response_type for row in example.rows} == {
        "multiple_choice",
        "student_produced_response",
    }


def test_malformed_quoted_csv_returns_diagnostics():
    from whitebook.answer_csv import parse_answer_csv

    result = parse_answer_csv(
        b'section,module,question_number,type,correct_answer,category\n"Math,1,1,spr,2,Algebra'
    )
    assert not result.rows
    assert result.diagnostics[0].code == "malformed_csv"
