from __future__ import annotations

import io
from pathlib import Path

import pytest
from pypdf import PdfWriter

from whitebook.attempts import AttemptEngine, AttemptError
from whitebook.authoring import PackageAuthoring
from whitebook.launcher import initialize_storage


class FakeClock:
    def __init__(self, value: float = 1_000.0) -> None:
        self.value = value

    def now(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def publish_full_package(data_root: Path) -> dict:
    initialize_storage(data_root)
    source = data_root / "runtime" / "full.pdf"
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    source.write_bytes(output.getvalue())
    lines = ["section,module,question_number,type,correct_answer,category"]
    for section, count, category in (
        ("Reading and Writing", 27, "Grammar"),
        ("Math", 22, "Algebra"),
    ):
        for module in (1, 2):
            for number in range(1, count + 1):
                lines.append(
                    f"{section},{module},{number},multiple choice,A,{category}"
                )
    authoring = PackageAuthoring(data_root)
    draft = authoring.create_import_draft(
        title="Full simulation",
        original_filename="full.pdf",
        temporary_pdf=source,
        answer_csv=("\n".join(lines) + "\n").encode(),
    )
    for index in range(draft.question_count):
        authoring.set_question_regions(
            draft.id,
            index,
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
    return authoring.publish(draft.id)


def test_simulation_uses_standard_modules_breaks_and_atomic_expiration(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_full_package(data_root)
    clock = FakeClock()
    engine = AttemptEngine(data_root, clock=clock)
    setup = engine.prepare(
        package_id=package["id"],
        kind="simulation",
        selection={"calculatorMode": "scientific"},
    )
    attempt = engine.begin(setup["setupId"])

    assert attempt["remainingSeconds"] == 32 * 60
    assert attempt["activeModuleIndex"] == 0

    clock.advance(32 * 60)
    expired = engine.tick(attempt["id"])
    assert expired["status"] == "transition"
    assert expired["lockedModules"] == [0]
    with pytest.raises(AttemptError, match="not active"):
        engine.save_response(attempt["id"], package["questions"][0]["id"], "A")

    second_rw = engine.continue_after_transition(attempt["id"])
    assert second_rw["activeModuleIndex"] == 1
    assert second_rw["remainingSeconds"] == 32 * 60
    clock.advance(32 * 60)
    on_break = engine.tick(attempt["id"])
    assert on_break["status"] == "break"
    assert on_break["breakRemainingSeconds"] == 10 * 60
    with pytest.raises(AttemptError, match="confirmation"):
        engine.end_break(attempt["id"], confirmed=False)

    clock.advance(10 * 60)
    after_break = engine.tick(attempt["id"])
    assert after_break["status"] == "transition"
    first_math = engine.continue_after_transition(attempt["id"])
    assert first_math["activeModuleIndex"] == 2
    assert first_math["remainingSeconds"] == 35 * 60

    clock.advance(35 * 60)
    engine.tick(attempt["id"])
    engine.continue_after_transition(attempt["id"])
    clock.advance(35 * 60)
    completed = engine.tick(attempt["id"])

    assert completed["status"] == "completed"
    assert completed["lockedModules"] == [0, 1, 2, 3]
    assert completed["result"]["total"] == 98
    assert completed["result"]["unanswered"] == 98


def test_paused_countdown_does_not_consume_recovery_time(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    package = publish_full_package(data_root)
    clock = FakeClock()
    engine = AttemptEngine(data_root, clock=clock)
    setup = engine.prepare(
        package_id=package["id"],
        kind="practice",
        selection={
            "sections": ["Math"],
            "modules": [1],
            "count": 1,
            "timing": "custom_countdown",
            "countdownSeconds": 60,
            "calculatorMode": "scientific",
        },
    )
    attempt = engine.begin(setup["setupId"])
    clock.advance(10)
    paused = engine.pause(attempt["id"])
    assert paused["remainingSeconds"] == 50

    clock.advance(500)
    gate = engine.prepare_resume(attempt["id"])
    assert gate["status"] == "ready"
    resumed = engine.resume(attempt["id"])
    assert resumed["remainingSeconds"] == 50
    clock.advance(5)
    assert engine.tick(attempt["id"])["remainingSeconds"] == 45
