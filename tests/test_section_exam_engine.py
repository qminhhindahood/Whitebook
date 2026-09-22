import io
from pathlib import Path

import pytest
from pypdf import PdfWriter

from tests.test_math_readiness_api import client_for
from tests.test_simulation_engine import FakeClock, publish_full_package
from whitebook.attempts import AttemptEngine, AttemptError
from whitebook.authoring import PackageAuthoring
from whitebook.launcher import initialize_storage


class ScriptedRandom:
    def sample(self, population, count):
        return list(population)[:count]

    def shuffle(self, values):
        values.reverse()


def publish_section_package(
    data_root: Path,
    *,
    section: str,
    question_count: int,
    source_module_size: int | None = None,
    title: str | None = None,
) -> dict:
    initialize_storage(data_root)
    (data_root / "assets/reference-sheet.png").write_bytes(
        b"\x89PNG\r\n\x1a\nfixture"
    )
    source = data_root / "runtime" / "section.pdf"
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.add_metadata({"/Marker": title or section})
    writer.write(output)
    source.write_bytes(output.getvalue())

    module_size = source_module_size or (22 if section == "Math" else 27)
    lines = ["section,module,question_number,type,correct_answer,category"]
    for index in range(question_count):
        module = index // module_size + 1
        number = index % module_size + 1
        category = "Algebra" if section == "Math" else "Grammar"
        lines.append(f"{section},{module},{number},multiple choice,A,{category}")
    authoring = PackageAuthoring(data_root)
    draft = authoring.create_import_draft(
        title=title or f"{section} Section Exam",
        original_filename="section.pdf",
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


@pytest.mark.parametrize(
    ("section", "question_count", "expected_module_size", "calculator_mode"),
    [
        ("Math", 44, 22, "scientific"),
        ("Reading and Writing", 54, 27, None),
    ],
)
def test_section_exam_generates_two_exact_non_overlapping_modules(
    tmp_path: Path,
    section: str,
    question_count: int,
    expected_module_size: int,
    calculator_mode: str | None,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(
        data_root, section=section, question_count=question_count
    )
    original_questions = package["questions"]
    selection = {"calculatorMode": calculator_mode} if calculator_mode else {}
    engine = AttemptEngine(data_root, random_source=ScriptedRandom())

    setup = engine.prepare(
        package_id=package["id"], kind="section_exam", selection=selection
    )
    assert setup["kind"] == "section_exam"
    assert setup["selection"]["section"] == section
    attempt = engine.begin(setup["setupId"])

    modules = attempt["plan"]["modules"]
    module_ids = [module["questionIds"] for module in modules]
    generated_ids = [question_id for ids in module_ids for question_id in ids]
    assert [len(ids) for ids in module_ids] == [
        expected_module_size,
        expected_module_size,
    ]
    assert len(generated_ids) == len(set(generated_ids)) == question_count
    assert set(generated_ids) == {question["id"] for question in original_questions}
    assert [module["module"] for module in modules] == [1, 2]
    assert [module["durationSeconds"] for module in modules] == [
        35 * 60 if section == "Math" else 32 * 60
    ] * 2
    reloaded = PackageAuthoring(data_root).get_package(package["id"])
    assert reloaded is not None
    assert reloaded["questions"] == original_questions


def test_section_exam_uses_controlled_order_and_retry_preserves_the_frozen_plan(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    engine = AttemptEngine(data_root, random_source=ScriptedRandom())

    setup = engine.prepare(
        package_id=package["id"],
        kind="section_exam",
        selection={"calculatorMode": "scientific"},
    )
    expected_order = [question["id"] for question in package["questions"]][::-1]
    assert setup["questions"]
    assert [question["id"] for question in setup["questions"]] == expected_order

    retried = engine.retry_setup(setup["setupId"])

    assert [question["id"] for question in retried["questions"]] == expected_order


def test_section_exam_never_pools_questions_from_another_package(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    clicked = publish_section_package(data_root, section="Math", question_count=44)
    other = publish_section_package(
        data_root, section="Math", question_count=44, title="Other Math Section Exam"
    )
    engine = AttemptEngine(data_root, random_source=ScriptedRandom())

    setup = engine.prepare(
        package_id=clicked["id"],
        kind="section_exam",
        selection={"calculatorMode": "scientific"},
    )

    selected_ids = {question["id"] for question in setup["questions"]}
    assert selected_ids == {question["id"] for question in clicked["questions"]}
    assert selected_ids.isdisjoint(
        {question["id"] for question in other["questions"]}
    )


def test_section_exam_does_not_exclude_questions_used_by_an_earlier_attempt(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    engine = AttemptEngine(data_root, random_source=ScriptedRandom())
    selection = {"calculatorMode": "scientific"}

    first_setup = engine.prepare(
        package_id=package["id"], kind="section_exam", selection=selection
    )
    first = engine.begin(first_setup["setupId"])
    engine.finish_module(first["id"])
    engine.continue_after_transition(first["id"])
    engine.finish_module(first["id"])

    second_setup = engine.prepare(
        package_id=package["id"], kind="section_exam", selection=selection
    )

    assert {question["id"] for question in second_setup["questions"]} == {
        question["id"] for question in package["questions"]
    }


def test_section_exam_rejects_insufficient_mixed_and_archived_packages(
    tmp_path: Path,
) -> None:
    insufficient_root = tmp_path / "insufficient"
    insufficient = publish_section_package(
        insufficient_root, section="Math", question_count=43
    )
    with pytest.raises(AttemptError, match="44 valid") as insufficient_error:
        AttemptEngine(insufficient_root).prepare(
            package_id=insufficient["id"], kind="section_exam", selection={}
        )
    assert insufficient_error.value.code == "section_exam_insufficient_questions"

    mixed_root = tmp_path / "mixed"
    mixed = publish_full_package(mixed_root)
    with pytest.raises(AttemptError, match="only one supported Section") as mixed_error:
        AttemptEngine(mixed_root).prepare(
            package_id=mixed["id"], kind="section_exam", selection={}
        )
    assert mixed_error.value.code == "section_exam_mixed_sections"

    archived_root = tmp_path / "archived"
    archived = publish_section_package(archived_root, section="Math", question_count=44)
    PackageAuthoring(archived_root).set_archived(archived["id"], archived=True)
    with pytest.raises(AttemptError, match="not found"):
        AttemptEngine(archived_root).prepare(
            package_id=archived["id"], kind="section_exam", selection={}
        )


def test_section_exam_readiness_keeps_math_loading_gate_before_begin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    monkeypatch.delenv("WHITEBOOK_DESMOS_API_KEY", raising=False)

    setup = AttemptEngine(data_root).prepare(
        package_id=package["id"],
        kind="section_exam",
        selection={"calculatorMode": "scientific"},
    )

    assert setup["status"] == "ready"
    assert setup["stages"][-1] == {"name": "ready", "status": "ready"}


def test_section_exam_math_readiness_blocks_begin_until_a_calculator_is_ready(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    monkeypatch.delenv("WHITEBOOK_DESMOS_API_KEY", raising=False)

    engine = AttemptEngine(data_root)
    setup = engine.prepare(
        package_id=package["id"], kind="section_exam", selection={}
    )

    assert setup["status"] == "failed"
    assert setup["failedStage"] == "math_tools"
    with pytest.raises(AttemptError, match="not ready"):
        engine.begin(setup["setupId"])


def test_section_exam_api_supports_begin_finish_transition_and_results(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    client = client_for(data_root)

    setup_response = client.post(
        "/api/attempt-setups",
        json={
            "packageId": package["id"],
            "kind": "section_exam",
            "selection": {"calculatorMode": "scientific"},
        },
    )

    assert setup_response.status_code == 201
    gate = setup_response.json()
    assert gate["kind"] == "section_exam"
    assert len(gate["questions"]) == 44
    attempt = client.post(f"/api/attempt-setups/{gate['setupId']}/begin").json()
    assert attempt["remainingSeconds"] == 35 * 60

    first_finished = client.post(f"/api/attempts/{attempt['id']}/finish-module")
    assert first_finished.status_code == 200
    assert first_finished.json()["status"] == "transition"
    second = client.post(f"/api/attempts/{attempt['id']}/continue").json()
    completed = client.post(f"/api/attempts/{second['id']}/finish-module")

    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["result"]["total"] == 44


def test_section_exam_pause_resume_preserves_answers_and_remaining_time(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    clock = FakeClock()
    engine = AttemptEngine(data_root, clock=clock, random_source=ScriptedRandom())
    setup = engine.prepare(
        package_id=package["id"],
        kind="section_exam",
        selection={"calculatorMode": "scientific"},
    )
    attempt = engine.begin(setup["setupId"])
    first_id = attempt["currentQuestionId"]
    engine.save_response(attempt["id"], first_id, "A")

    clock.advance(17)
    paused = engine.pause(attempt["id"])
    clock.advance(500)
    engine.prepare_resume(attempt["id"])
    resumed = engine.resume(attempt["id"])

    assert paused["remainingSeconds"] == 35 * 60 - 17
    assert resumed["remainingSeconds"] == paused["remainingSeconds"]
    assert resumed["responses"] == {first_id: "A"}
    assert resumed["plan"]["modules"] == attempt["plan"]["modules"]
    assert [question["id"] for question in resumed["questions"]] == [
        question["id"] for question in attempt["questions"]
    ]


def test_section_exam_expiry_locks_each_module_and_grades_unanswered_questions(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    clock = FakeClock()
    engine = AttemptEngine(data_root, clock=clock, random_source=ScriptedRandom())
    setup = engine.prepare(
        package_id=package["id"],
        kind="section_exam",
        selection={"calculatorMode": "scientific"},
    )
    attempt = engine.begin(setup["setupId"])
    engine.save_response(attempt["id"], attempt["currentQuestionId"], "A")

    clock.advance(35 * 60)
    first_expired = engine.tick(attempt["id"])

    assert first_expired["status"] == "transition"
    assert first_expired["lockedModules"] == [0]
    assert first_expired["remainingSeconds"] == 0
    with pytest.raises(AttemptError, match="not active"):
        engine.save_response(attempt["id"], attempt["currentQuestionId"], "A")

    second = engine.continue_after_transition(attempt["id"])
    assert second["remainingSeconds"] == 35 * 60
    clock.advance(35 * 60)
    completed = engine.tick(attempt["id"])

    assert completed["status"] == "completed"
    assert completed["lockedModules"] == [0, 1]
    assert completed["result"]["correct"] == 1
    assert completed["result"]["unanswered"] == 43
    assert {
        bucket["total"] for bucket in completed["result"]["byModule"].values()
    } == {22}


def test_section_exam_finish_is_single_use_and_expiry_race_cannot_skip_module(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(data_root, section="Math", question_count=44)
    clock = FakeClock()
    engine = AttemptEngine(data_root, clock=clock, random_source=ScriptedRandom())
    setup = engine.prepare(
        package_id=package["id"],
        kind="section_exam",
        selection={"calculatorMode": "scientific"},
    )
    attempt = engine.begin(setup["setupId"])
    first_finished = engine.finish_module(attempt["id"])

    assert first_finished["status"] == "transition"
    with pytest.raises(AttemptError, match="not active"):
        engine.finish_module(attempt["id"])

    second = engine.continue_after_transition(attempt["id"])
    clock.advance(35 * 60)
    expired = engine.tick(second["id"])
    assert expired["status"] == "completed"
    with pytest.raises(AttemptError, match="not active"):
        engine.finish_module(attempt["id"])


def test_section_exam_results_use_generated_module_membership_not_source_labels(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    package = publish_section_package(
        data_root, section="Math", question_count=48, source_module_size=24
    )
    engine = AttemptEngine(data_root, random_source=ScriptedRandom())
    setup = engine.prepare(
        package_id=package["id"],
        kind="section_exam",
        selection={"calculatorMode": "scientific"},
    )
    attempt = engine.begin(setup["setupId"])
    engine.finish_module(attempt["id"])
    engine.continue_after_transition(attempt["id"])
    completed = engine.finish_module(attempt["id"])
    result_by_id = {question["id"]: question for question in completed["result"]["questions"]}

    for generated_module, module in enumerate(attempt["plan"]["modules"], start=1):
        assert {
            result_by_id[question_id]["module"]
            for question_id in module["questionIds"]
        } == {generated_module}
