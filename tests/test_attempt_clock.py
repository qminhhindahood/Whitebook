"""Server-enforced Attempt clock: deadline anchors replace the per-second tick.

The engine must enforce expiration from stored server deadlines on reads and
mutations, charge timing only at coarse checkpoints, and never require a
per-second request or write to keep a countdown honest.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
from pathlib import Path

import pytest

from tests.test_simulation_engine import FakeClock, publish_full_package
from whitebook import attempts as attempts_module
from whitebook.attempts import AttemptEngine, AttemptError

COUNTDOWN_SECONDS = 600


def countdown_practice(engine: AttemptEngine, package: dict) -> dict:
    gate = engine.prepare(
        package_id=package["id"],
        kind="practice",
        selection={
            "sections": ["Reading and Writing"],
            "modules": [1],
            "count": 2,
            "timing": "custom_countdown",
            "countdownSeconds": COUNTDOWN_SECONDS,
        },
    )
    return engine.begin(gate["setupId"])


@pytest.fixture()
def write_counter(monkeypatch):
    """Records every durable write statement the engine executes."""
    writes: list[str] = []
    real_connect = attempts_module.connect

    @contextmanager
    def counting_connect(data_root):
        with real_connect(data_root) as connection:
            connection.set_trace_callback(
                lambda statement: (
                    writes.append(statement)
                    if statement.lstrip()[:6].upper() in {"INSERT", "UPDATE", "DELETE"}
                    else None
                )
            )
            yield connection

    monkeypatch.setattr(attempts_module, "connect", counting_connect)
    return writes


def test_countdown_reads_charge_no_writes_and_stay_server_honest(
    tmp_path: Path, write_counter: list[str]
):
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    attempt = countdown_practice(engine, package)
    write_counter.clear()

    # Simulate the old one-second client cadence with pure reads: the
    # countdown must advance from the stored deadline without a single write.
    for _ in range(120):
        clock.advance(1)
        attempt = engine.get_attempt(attempt["id"])

    assert attempt["remainingSeconds"] == COUNTDOWN_SECONDS - 120
    assert attempt["elapsedSeconds"] == 0
    assert write_counter == []


def test_expiration_is_enforced_by_the_server_without_any_client_tick(
    tmp_path: Path,
):
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    attempt = countdown_practice(engine, package)
    question_id = attempt["questions"][0]["id"]
    engine.save_response(attempt["id"], question_id, "A")

    clock.advance(COUNTDOWN_SECONDS * 2)
    expired = engine.get_attempt(attempt["id"])

    assert expired["status"] == "completed"
    assert expired["remainingSeconds"] == 0
    # Elapsed time is capped at the module duration despite the long overshoot.
    assert expired["elapsedSeconds"] == COUNTDOWN_SECONDS
    assert expired["result"]["correct"] == 1
    with pytest.raises(AttemptError, match="not active"):
        engine.save_response(attempt["id"], question_id, "B")


def test_per_question_timing_is_charged_at_coarse_checkpoints(tmp_path: Path):
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    attempt = countdown_practice(engine, package)
    first_id = attempt["questions"][0]["id"]
    second_id = attempt["questions"][1]["id"]

    clock.advance(10)
    engine.navigate(attempt["id"], second_id)
    clock.advance(20)
    engine.save_response(attempt["id"], second_id, "A")
    clock.advance(COUNTDOWN_SECONDS)
    finished = engine.get_attempt(attempt["id"])

    assert finished["status"] == "completed"
    assert finished["questionSeconds"][first_id] == 10
    assert finished["questionSeconds"][second_id] == 20 + (COUNTDOWN_SECONDS - 30)
    assert finished["elapsedSeconds"] == COUNTDOWN_SECONDS


def test_break_runs_on_the_server_clock_without_per_second_writes(
    tmp_path: Path, write_counter: list[str]
):
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    gate = engine.prepare(
        package_id=package["id"],
        kind="simulation",
        selection={"calculatorMode": "scientific"},
    )
    attempt = engine.begin(gate["setupId"])
    clock.advance(32 * 60)
    attempt = engine.get_attempt(attempt["id"])
    attempt = engine.continue_after_transition(attempt["id"])
    clock.advance(32 * 60)
    attempt = engine.get_attempt(attempt["id"])
    assert attempt["status"] == "break"
    assert attempt["breakRemainingSeconds"] == 10 * 60
    write_counter.clear()

    for _ in range(60):
        clock.advance(1)
        attempt = engine.get_attempt(attempt["id"])
        assert attempt["status"] == "break"

    assert write_counter == []
    assert attempt["breakRemainingSeconds"] == 9 * 60

    clock.advance(10 * 60)
    transitioned = engine.get_attempt(attempt["id"])
    assert transitioned["status"] == "transition"


def test_refreshing_reads_cannot_extend_remaining(tmp_path: Path):
    """The server stores an absolute deadline, so re-reading (refreshing) an
    Attempt can never hand back more time than the clock has actually spent —
    remaining only moves downward while the module runs."""
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    attempt = countdown_practice(engine, package)

    clock.advance(60)
    previous = engine.get_attempt(attempt["id"])["remainingSeconds"]
    assert previous == COUNTDOWN_SECONDS - 60
    for step in range(50):
        clock.advance(3 if step % 2 else 0)
        current = engine.get_attempt(attempt["id"])["remainingSeconds"]
        assert current <= previous
        previous = current
    assert previous == COUNTDOWN_SECONDS - 60 - 75


def test_representative_attempt_write_budget(tmp_path: Path):
    """Writes per representative timed Attempt: durable state changes only on
    learner actions and clock transitions, never on the passage of time."""
    package = publish_full_package(tmp_path)
    clock = FakeClock()
    engine = AttemptEngine(tmp_path, clock=clock)
    attempt = countdown_practice(engine, package)

    actions: list[Callable[[], object]] = [
        lambda: engine.save_response(attempt["id"], attempt["questions"][0]["id"], "A"),
        lambda: engine.navigate(attempt["id"], attempt["questions"][1]["id"]),
        lambda: engine.save_review_state(
            attempt["id"],
            attempt["questions"][1]["id"],
            marked=True,
            eliminated_choices=[],
        ),
        lambda: engine.pause(attempt["id"]),
    ]
    for step, action in enumerate(actions):
        clock.advance(30)
        action()
        for _ in range(30):
            clock.advance(1)
            engine.get_attempt(attempt["id"])

    with attempts_module.connect(tmp_path) as connection:
        updates = connection.execute(
            "SELECT COUNT(*) FROM attempts WHERE id = ?", (attempt["id"],)
        ).fetchone()[0]

    # Sanity: the attempt survived four actions plus four minutes of reads.
    assert updates == 1
    final = engine.get_attempt(attempt["id"])
    assert final["status"] == "paused"
    # Three write checkpoints each absorb their preceding idle minute; the
    # final pause charges only its own 30-second wait.
    assert final["elapsedSeconds"] == 3 * 60 + 30
