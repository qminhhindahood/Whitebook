import io
import json
from pathlib import Path

import pytest
from pypdf import PdfWriter

from tests.test_math_readiness_api import math_package, selection
from tests.test_simulation_engine import FakeClock, publish_full_package
from whitebook.attempts import AttemptEngine, AttemptError
from whitebook.authoring import PackageAuthoring
from whitebook.launcher import initialize_storage
from whitebook.storage import connect

CHECKS = dict.fromkeys(
    (
        "scriptLoaded",
        "constructorAvailable",
        "instanceCreated",
        "stateReadable",
        "usableSize",
    ),
    True,
)


def test_calculator_confirmation_cannot_override_missing_source(
    tmp_path: Path, monkeypatch
):
    package = math_package(tmp_path)
    monkeypatch.setenv("WHITEBOOK_DESMOS_API_KEY", "test-key")
    (tmp_path / "assets/reference-sheet.png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")
    PackageAuthoring(tmp_path).package_source_pdf(package["id"]).unlink()
    engine = AttemptEngine(tmp_path)
    gate = engine.prepare(
        package_id=package["id"], kind="practice", selection=selection()
    )
    updated = engine.confirm_calculator(gate["setupId"], CHECKS)
    assert updated["status"] == "failed"
    assert updated["failedStage"] == "source_validation"
    with pytest.raises(AttemptError, match="not ready"):
        engine.begin(gate["setupId"])


def test_math_resume_gate_consumes_setup_and_preserves_calculator_mode(
    tmp_path: Path, monkeypatch
):
    package = math_package(tmp_path)
    engine = AttemptEngine(tmp_path)
    gate = engine.prepare(
        package_id=package["id"], kind="practice", selection=selection()
    )
    engine.use_scientific(gate["setupId"])
    attempt = engine.begin(gate["setupId"])
    engine.pause(attempt["id"])
    monkeypatch.setenv("WHITEBOOK_DESMOS_API_KEY", "test-key")
    (tmp_path / "assets/reference-sheet.png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")
    gate = engine.prepare_resume(attempt["id"])
    engine.confirm_calculator(gate["setupId"], CHECKS)
    resumed = engine.begin(gate["setupId"])
    assert resumed["calculatorMode"] == "desmos"
    with pytest.raises(AttemptError, match="not found"):
        engine.begin(gate["setupId"])


def test_practice_navigation_keeps_one_total_countdown_across_modules(tmp_path: Path):
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    gate = engine.prepare(
        package_id=package["id"],
        kind="practice",
        selection={
            "sections": ["Reading and Writing"],
            "modules": [1, 2],
            "count": 4,
            "timing": "custom_countdown",
            "countdownSeconds": 120,
        },
    )
    attempt = engine.begin(gate["setupId"])
    assert attempt["remainingSeconds"] == 120
    clock.advance(10)
    target = attempt["plan"]["modules"][1]["questionIds"][0]
    moved = engine.navigate(attempt["id"], target)
    assert moved["activeModuleIndex"] == 1
    assert moved["remainingSeconds"] == 110
    engine.save_response(attempt["id"], target, "A")
    clock.advance(200)
    finished = engine.tick(attempt["id"])
    assert finished["result"]["correct"] == 1
    assert finished["elapsedSeconds"] == 120
    assert (
        finished["result"]["bySection"]["Reading and Writing"]["elapsedSeconds"] == 120
    )
    assert (
        finished["result"]["byModule"]["Reading and Writing · Module 2"][
            "elapsedSeconds"
        ]
        == 110
    )


def test_desmos_key_is_not_persisted_in_setups(tmp_path: Path, monkeypatch):
    package = math_package(tmp_path)
    monkeypatch.setenv("WHITEBOOK_DESMOS_API_KEY", "unique-not-for-storage-key")
    (tmp_path / "assets/reference-sheet.png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")
    engine = AttemptEngine(tmp_path)
    gate = engine.prepare(
        package_id=package["id"], kind="practice", selection=selection()
    )
    assert "unique-not-for-storage-key" in gate["mathTool"]["scriptUrl"]
    with connect(tmp_path) as connection:
        row = connection.execute("SELECT readiness_json FROM attempt_setups").fetchone()
    assert "unique-not-for-storage-key" not in json.dumps(dict(row))


def test_recovery_freezes_the_last_checkpoint_instead_of_counting_downtime(
    tmp_path: Path,
):
    package = math_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    gate = engine.prepare(
        package_id=package["id"],
        kind="practice",
        selection={
            **selection(),
            "timing": "custom_countdown",
            "countdownSeconds": 60,
            "calculatorMode": "scientific",
        },
    )
    attempt = engine.begin(gate["setupId"])
    clock.advance(10)
    engine.tick(attempt["id"])
    clock.advance(600)
    engine.recover_interrupted()
    recovered = engine.get_attempt(attempt["id"])
    assert recovered["status"] == "paused"
    assert recovered["remainingSeconds"] == 50
    gate = engine.prepare_resume(attempt["id"])
    assert engine.begin(gate["setupId"])["remainingSeconds"] == 50


def test_break_can_be_paused_and_resumed_without_skipping_it(tmp_path: Path):
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    gate = engine.prepare(
        package_id=package["id"],
        kind="simulation",
        selection={"calculatorMode": "scientific"},
    )
    attempt = engine.begin(gate["setupId"])
    clock.advance(1920)
    engine.tick(attempt["id"])
    engine.continue_after_transition(attempt["id"])
    clock.advance(1920)
    engine.tick(attempt["id"])
    clock.advance(60)
    paused = engine.pause(attempt["id"])
    assert paused["status"] == "paused"
    clock.advance(1000)
    gate = engine.prepare_resume(attempt["id"])
    resumed = engine.begin(gate["setupId"])
    assert resumed["status"] == "break"
    assert resumed["breakRemainingSeconds"] == 540


def test_mcq_with_no_accepted_answers_surfaces_clean_grading_error(
    tmp_path: Path,
):
    initialize_storage(tmp_path)
    source = tmp_path / "runtime" / "mcq.pdf"
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    source.write_bytes(output.getvalue())
    authoring = PackageAuthoring(tmp_path)
    draft = authoring.create_import_draft(
        title="MCQ module",
        original_filename="mcq.pdf",
        temporary_pdf=source,
        answer_csv=(
            b"section,module,question_number,type,correct_answer,category\n"
            b"Reading and Writing,1,1,multiple choice,A,Grammar\n"
        ),
    )
    authoring.set_question_regions(
        draft.id,
        0,
        [
            {
                "page_number": 1,
                "x": 0.05,
                "y": 0.05,
                "width": 0.9,
                "height": 0.9,
                "confirmed": True,
            }
        ],
    )
    package = authoring.publish(draft.id)
    engine = AttemptEngine(tmp_path)
    gate = engine.prepare(
        package_id=package["id"],
        kind="practice",
        selection={
            "sections": ["Reading and Writing"],
            "modules": [1],
            "count": 1,
            "timing": "elapsed",
        },
    )
    attempt = engine.begin(gate["setupId"])
    with connect(tmp_path) as connection:
        plan = json.loads(
            connection.execute(
                "SELECT plan_json FROM attempts WHERE id = ?", (attempt["id"],)
            ).fetchone()[0]
        )
    plan["questions"][0]["accepted_answers"] = []
    with connect(tmp_path) as connection:
        connection.execute(
            "UPDATE attempts SET plan_json = ? WHERE id = ?",
            (json.dumps(plan), attempt["id"]),
        )
        connection.commit()
    with pytest.raises(ValueError, match="no accepted answers"):
        engine.submit(attempt["id"])


def test_off_contract_mcq_selection_is_rejected_at_save_time(tmp_path: Path):
    package = publish_full_package(tmp_path)
    engine = AttemptEngine(tmp_path)
    gate = engine.prepare(
        package_id=package["id"],
        kind="practice",
        selection={
            "sections": ["Reading and Writing"],
            "modules": [1],
            "count": 1,
            "timing": "elapsed",
        },
    )
    attempt = engine.begin(gate["setupId"])
    question_id = attempt["questions"][0]["id"]

    for junk in ("E", "AB", "Z"):
        with pytest.raises(AttemptError, match="A, B, C, or D"):
            engine.save_response(attempt["id"], question_id, junk)
        assert attempt["responses"] == {}

    saved = engine.save_response(attempt["id"], question_id, "b")
    assert saved["attempt"]["responses"] == {question_id: "B"}


def test_legacy_off_contract_response_grades_incorrect_without_wedging(
    tmp_path: Path,
):
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    gate = engine.prepare(
        package_id=package["id"],
        kind="practice",
        selection={
            "sections": ["Reading and Writing"],
            "modules": [1],
            "count": 1,
            "timing": "custom_countdown",
            "countdownSeconds": 60,
        },
    )
    attempt = engine.begin(gate["setupId"])
    question_id = attempt["questions"][0]["id"]
    engine.save_response(attempt["id"], question_id, "A")
    with connect(tmp_path) as connection:
        state = json.loads(
            connection.execute(
                "SELECT state_json FROM attempts WHERE id = ?", (attempt["id"],)
            ).fetchone()[0]
        )
    state["responses"][question_id] = "Z"
    with connect(tmp_path) as connection:
        connection.execute(
            "UPDATE attempts SET state_json = ? WHERE id = ?",
            (json.dumps(state), attempt["id"]),
        )
        connection.commit()

    clock.advance(120)
    expired = engine.tick(attempt["id"])

    assert expired["status"] == "completed"
    graded = expired["result"]["questions"][0]
    assert graded["learnerResponse"] == "Z"
    assert graded["status"] == "incorrect"
    assert expired["result"]["correct"] == 0
