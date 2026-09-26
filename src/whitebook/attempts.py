from __future__ import annotations

import json
import os
import random
import time
import uuid
from collections import Counter
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from whitebook.authoring import PackageAuthoring
from whitebook.diagnostics import DiagnosticLog
from whitebook.grading import (
    MULTIPLE_CHOICE,
    VALID_MCQ_ANSWERS,
    GradeStatus,
    GradingQuestion,
    LearnerResponse,
    grade_question,
    summarize_grades,
)
from whitebook.math_config import load_math_configuration, reference_sheet_setting
from whitebook.package_eligibility import classify_section_exam
from whitebook.practice_rules import (
    PracticeQuestion,
    PracticeRequest,
    build_practice_plan,
)
from whitebook.sat_policy import (
    BREAK_SECONDS,
    section_exam_module_count,
    section_exam_total_questions,
    standard_module_position,
    standard_module_seconds,
)
from whitebook.storage import connect


class AttemptError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


class Clock(Protocol):
    def now(self) -> float: ...


class RandomSource(Protocol):
    def sample(
        self, population: list[dict[str, Any]], count: int
    ) -> list[dict[str, Any]]: ...

    def shuffle(self, values: list[dict[str, Any]]) -> None: ...


class SystemClock:
    def now(self) -> float:
        return time.time()


class AttemptEngine:
    """Owns frozen plans, durable learner state, and Raw Accuracy results."""

    def __init__(
        self,
        data_root: Path,
        *,
        clock: Clock | None = None,
        random_source: RandomSource | None = None,
    ) -> None:
        self._data_root = data_root
        self._authoring = PackageAuthoring(data_root)
        self._clock = clock or SystemClock()
        self._random = random_source or random.SystemRandom()
        self._diagnostics = DiagnosticLog(data_root)

    def practice_options(self, package_id: str) -> dict[str, object]:
        package = self._require_package(package_id)
        questions = package["questions"]
        sections = list(dict.fromkeys(question["section"] for question in questions))
        groups: dict[tuple[str, int], int] = Counter(
            (question["section"], int(question["module"])) for question in questions
        )
        categories = list(
            dict.fromkeys(
                question["category"]
                for question in questions
                if question.get("category") is not None
            )
        )
        return {
            "packageId": package_id,
            "sections": sections,
            "modules": [
                {"section": section, "module": module, "questionCount": count}
                for (section, module), count in groups.items()
            ],
            "categories": categories,
            "questionCount": len(questions),
            "simulationEligible": package["simulationEligible"],
        }

    def prepare(
        self,
        *,
        package_id: str,
        kind: str,
        selection: dict[str, Any],
        resume_attempt_id: str | None = None,
    ) -> dict[str, object]:
        package = self._require_package(
            package_id, allow_archived=bool(resume_attempt_id)
        )
        if kind not in {"practice", "simulation", "section_exam"}:
            raise AttemptError("invalid_attempt_kind", "Attempt kind is not supported.")
        if kind == "simulation" and not package["simulationEligible"]:
            raise AttemptError(
                "simulation_unavailable",
                "This Test Package is not eligible for Full SAT Simulation.",
            )

        if resume_attempt_id:
            attempt = self.get_attempt(resume_attempt_id)
            if attempt is None:
                raise AttemptError("attempt_not_found", "Attempt not found.")
            plan = attempt["plan"]
            selection = plan["selection"]
        else:
            try:
                plan = self._build_plan(package, kind, selection)
            except (TypeError, ValueError, KeyError, OverflowError) as error:
                raise AttemptError(
                    "invalid_selection",
                    "Check the Practice selection fields and try again.",
                ) from error
        selection = plan["selection"]

        readiness = self._readiness(package, plan, selection)
        return self._create_setup(
            package_id=package_id,
            kind=kind,
            selection=selection,
            plan=plan,
            readiness=readiness,
            resume_attempt_id=resume_attempt_id,
        )

    def begin(self, setup_id: str) -> dict[str, object]:
        with connect(self._data_root) as connection:
            setup = connection.execute(
                "SELECT * FROM attempt_setups WHERE id = ?", (setup_id,)
            ).fetchone()
        if setup is None:
            raise AttemptError("setup_not_found", "Attempt setup not found.")
        readiness = json.loads(setup["readiness_json"])
        if readiness["status"] != "ready":
            raise AttemptError("setup_not_ready", "Attempt setup is not ready.")
        if setup["resume_attempt_id"]:
            row, plan, state = self._load_attempt(setup["resume_attempt_id"])
            state["resumeReady"] = True
            selection = json.loads(setup["selection_json"])
            state["calculatorMode"] = selection.get("calculatorMode", "none")
            plan["selection"] = selection
            with connect(self._data_root) as connection:
                connection.execute(
                    "UPDATE attempts SET plan_json = ? WHERE id = ?",
                    (json.dumps(plan), row["id"]),
                )
                connection.execute(
                    "DELETE FROM attempt_setups WHERE id = ?", (setup_id,)
                )
                connection.commit()
            self._save_state(row, state)
            return self.resume(setup["resume_attempt_id"])

        plan = json.loads(setup["plan_json"])
        attempt_id = str(uuid.uuid4())
        questions = plan["questions"]
        remaining = (
            plan.get("durationSeconds")
            if setup["kind"] == "practice"
            else plan["modules"][0].get("durationSeconds")
        )
        started_at = self._clock.now()
        state = {
            "currentQuestionId": questions[0]["id"],
            "activeModuleIndex": 0,
            "responses": {},
            "reviewState": {},
            "lockedModules": [],
            "elapsedSeconds": 0,
            "questionSeconds": {question["id"]: 0 for question in questions},
            "remainingSeconds": remaining,
            # The stored deadline is the authoritative server anchor: the
            # client renders it locally and enforcement compares it against
            # the server clock on every relevant read or mutation.
            "moduleDeadlineAt": (
                started_at + remaining if remaining is not None else None
            ),
            "breakRemainingSeconds": None,
            "breakDeadlineAt": None,
            "lastAnchorAt": started_at,
            "resumeReady": False,
            "calculatorState": None,
            "calculatorMode": plan["selection"].get("calculatorMode", "none"),
        }
        now = self._timestamp()
        with connect(self._data_root) as connection:
            connection.execute(
                """
                INSERT INTO attempts (
                    id, package_id, kind, status, plan_json, state_json,
                    result_json, created_at, updated_at
                ) VALUES (?, ?, ?, 'active', ?, ?, NULL, ?, ?)
                """,
                (
                    attempt_id,
                    setup["package_id"],
                    setup["kind"],
                    setup["plan_json"],
                    json.dumps(state, separators=(",", ":")),
                    now,
                    now,
                ),
            )
            connection.execute("DELETE FROM attempt_setups WHERE id = ?", (setup_id,))
            connection.commit()
        attempt = self.get_attempt(attempt_id, at=started_at)
        assert attempt is not None
        return attempt

    def retry_setup(self, setup_id: str) -> dict[str, object]:
        setup = self._load_setup(setup_id)
        selection = json.loads(setup["selection_json"])
        if setup["kind"] == "section_exam" and not setup["resume_attempt_id"]:
            package = self._require_package(setup["package_id"])
            plan = json.loads(setup["plan_json"])
            readiness = self._readiness(package, plan, selection)
            replacement = self._create_setup(
                package_id=setup["package_id"],
                kind=setup["kind"],
                selection=selection,
                plan=plan,
                readiness=readiness,
                resume_attempt_id=setup["resume_attempt_id"],
            )
        else:
            replacement = self.prepare(
                package_id=setup["package_id"],
                kind=setup["kind"],
                selection=selection,
                resume_attempt_id=setup["resume_attempt_id"],
            )
        with connect(self._data_root) as connection:
            connection.execute("DELETE FROM attempt_setups WHERE id = ?", (setup_id,))
            connection.commit()
        return replacement

    def _create_setup(
        self,
        *,
        package_id: str,
        kind: str,
        selection: dict[str, Any],
        plan: dict[str, Any],
        readiness: dict[str, Any],
        resume_attempt_id: str | None,
    ) -> dict[str, object]:
        setup_id = str(uuid.uuid4())
        with connect(self._data_root) as connection:
            connection.execute(
                """
                INSERT INTO attempt_setups (
                    id, package_id, kind, selection_json, plan_json,
                    readiness_json, resume_attempt_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    setup_id,
                    package_id,
                    kind,
                    json.dumps(selection, separators=(",", ":")),
                    json.dumps(plan, separators=(",", ":")),
                    self._stored_readiness(readiness),
                    resume_attempt_id,
                    self._timestamp(),
                ),
            )
            connection.commit()
        self._log_readiness(setup_id, readiness)
        return {
            "setupId": setup_id,
            "packageId": package_id,
            "kind": kind,
            "selection": selection,
            "sourcePdfUrl": plan["sourcePdfUrl"],
            "questions": plan["questions"],
            **readiness,
        }

    def get_attempt(
        self, attempt_id: str, *, at: float | None = None
    ) -> dict[str, object] | None:
        self._enforce_deadlines(attempt_id)
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        return (
            self._attempt_payload(row, self._clock.now() if at is None else at)
            if row
            else None
        )

    def list_attempts(self) -> list[dict[str, object]]:
        with connect(self._data_root) as connection:
            rows = connection.execute(
                "SELECT id FROM attempts ORDER BY updated_at DESC"
            ).fetchall()
        attempts = [self.get_attempt(row["id"]) for row in rows]
        return [attempt for attempt in attempts if attempt is not None]

    def delete_unfinished(self, attempt_id: str, *, confirmed: bool) -> dict[str, bool]:
        attempt = self.get_attempt(attempt_id)
        if attempt is None:
            raise AttemptError("attempt_not_found", "Attempt not found.")
        if not confirmed:
            raise AttemptError(
                "confirmation_required",
                "Deleting an unfinished Attempt requires confirmation.",
            )
        if attempt["status"] == "completed":
            raise AttemptError(
                "completed_attempt_protected",
                "Completed Results are removed only with their Test Package.",
            )
        with connect(self._data_root) as connection:
            connection.execute("DELETE FROM attempts WHERE id = ?", (attempt_id,))
            connection.commit()
        return {"deleted": True}

    def save_response(
        self, attempt_id: str, question_id: str, response: str | None
    ) -> dict[str, object]:
        row, plan, state = self._active_attempt(attempt_id)
        self._require_active_question(plan, state, question_id)
        if response is None or not response.strip():
            state["responses"].pop(question_id, None)
        else:
            question = next(
                item for item in plan["questions"] if item["id"] == question_id
            )
            cleaned = response.strip()
            if question["response_type"] == MULTIPLE_CHOICE:
                # The grading kernel fails closed on non A-D selections; never
                # persist one, or module expiry would wedge the Attempt.
                cleaned = cleaned.upper()
                if cleaned not in VALID_MCQ_ANSWERS:
                    raise AttemptError(
                        "invalid_response",
                        "Multiple-choice responses must be A, B, C, or D.",
                    )
            state["responses"][question_id] = cleaned
        self._save_state(row, state)
        return {"saved": True, "attempt": self.get_attempt(attempt_id)}

    def save_review_state(
        self,
        attempt_id: str,
        question_id: str,
        *,
        marked: bool,
        eliminated_choices: list[str],
    ) -> dict[str, object]:
        row, plan, state = self._active_attempt(attempt_id)
        self._require_active_question(plan, state, question_id)
        state["reviewState"][question_id] = {
            "marked": bool(marked),
            "eliminatedChoices": [
                choice
                for choice in dict.fromkeys(eliminated_choices)
                if choice in VALID_MCQ_ANSWERS
            ],
        }
        self._save_state(row, state)
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def save_calculator_state(
        self, attempt_id: str, calculator_state: dict[str, Any]
    ) -> dict[str, object]:
        row, plan, state = self._active_attempt(attempt_id)
        if not any(question["section"] == "Math" for question in plan["questions"]):
            raise AttemptError(
                "calculator_unavailable", "Calculator state is available only for Math."
            )
        state["calculatorState"] = calculator_state
        self._save_state(row, state)
        return {"saved": True}

    def navigate(self, attempt_id: str, question_id: str) -> dict[str, object]:
        row, plan, state = self._active_attempt(attempt_id)
        if row["kind"] == "practice":
            for index, module in enumerate(plan["modules"]):
                if question_id in module["questionIds"]:
                    state["activeModuleIndex"] = index
                    break
        self._require_active_question(plan, state, question_id)
        # Charge the anchored interval before switching questions so the
        # coarse checkpoint lands on the question the learner actually left.
        self._charge(state, self._clock.now(), mode="module")
        state["currentQuestionId"] = question_id
        self._save_state(row, state)
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def pause(self, attempt_id: str) -> dict[str, object]:
        self._enforce_deadlines(attempt_id)
        row, _plan, state = self._load_attempt(attempt_id)
        if row["status"] == "completed":
            return self.get_attempt(attempt_id)
        now = self._clock.now()
        if row["status"] == "active":
            # Charge before clearing the anchor; the checkpoint inside
            # _save_state would otherwise see a zero delta.
            self._charge(state, now, mode="module")
        elif row["status"] == "break":
            self._charge(state, now, mode="break")
        if row["status"] != "paused":
            state["pausedStatus"] = row["status"]
        state["lastAnchorAt"] = None
        state["moduleDeadlineAt"] = None
        state["breakDeadlineAt"] = None
        state["resumeReady"] = False
        self._save_state(row, state, status="paused")
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def recover_interrupted(self) -> None:
        """Called only after the launcher owns its data lock; never charges downtime."""
        with connect(self._data_root) as connection:
            rows = connection.execute(
                "SELECT * FROM attempts WHERE status IN ('active', 'break', 'transition')"
            ).fetchall()
            for row in rows:
                state = self._normalize_state(json.loads(row["state_json"]))
                # Freeze at the last persisted checkpoint: the downtime belongs
                # to the launcher, not the Attempt.
                anchor = state.get("lastAnchorAt")
                if anchor is not None:
                    deadline = state.get("moduleDeadlineAt")
                    if deadline is not None:
                        state["remainingSeconds"] = max(0.0, deadline - anchor)
                    break_deadline = state.get("breakDeadlineAt")
                    if break_deadline is not None:
                        state["breakRemainingSeconds"] = max(
                            0.0, break_deadline - anchor
                        )
                state.update(
                    lastAnchorAt=None,
                    moduleDeadlineAt=None,
                    breakDeadlineAt=None,
                    resumeReady=False,
                    pausedStatus=row["status"],
                )
                connection.execute(
                    "UPDATE attempts SET status='paused', state_json=? WHERE id=?",
                    (json.dumps(state), row["id"]),
                )
            connection.execute("DELETE FROM attempt_setups")
            connection.commit()

    def prepare_resume(self, attempt_id: str) -> dict[str, object]:
        attempt = self.get_attempt(attempt_id)
        if attempt is None:
            raise AttemptError("attempt_not_found", "Attempt not found.")
        if attempt["status"] != "paused":
            raise AttemptError("attempt_not_paused", "Only Paused Attempts can resume.")
        gate = self.prepare(
            package_id=attempt["packageId"],
            kind=attempt["kind"],
            selection=attempt["plan"]["selection"],
            resume_attempt_id=attempt_id,
        )
        if gate["status"] == "ready":
            row, _plan, state = self._load_attempt(attempt_id)
            state["resumeReady"] = True
            self._save_state(row, state, status="paused")
        return gate

    def resume(self, attempt_id: str) -> dict[str, object]:
        row, _plan, state = self._load_attempt(attempt_id)
        if row["status"] != "paused" or not state.get("resumeReady"):
            raise AttemptError(
                "resume_not_ready", "Run the Attempt Loading Gate before resuming."
            )
        now = self._clock.now()
        state["lastAnchorAt"] = now
        if state.get("pausedStatus") == "break":
            state["moduleDeadlineAt"] = None
            break_remaining = state.get("breakRemainingSeconds")
            state["breakDeadlineAt"] = (
                now + break_remaining if break_remaining is not None else None
            )
        elif state.get("pausedStatus") == "transition":
            # continue_after_transition arms the next Module; a paused
            # transition has no running module time to restore.
            state["moduleDeadlineAt"] = None
            state["breakDeadlineAt"] = None
        else:
            remaining = state.get("remainingSeconds")
            state["moduleDeadlineAt"] = (
                now + remaining if remaining is not None else None
            )
            state["breakDeadlineAt"] = None
        state["resumeReady"] = False
        self._save_state(row, state, status=state.pop("pausedStatus", "active"))
        attempt = self.get_attempt(attempt_id, at=now)
        assert attempt is not None
        return attempt

    def submit(self, attempt_id: str) -> dict[str, object]:
        row, plan, state = self._active_attempt(attempt_id)
        if row["kind"] == "simulation":
            raise AttemptError(
                "simulation_early_submit",
                "Simulation Modules close only when their standard time expires.",
            )
        if row["kind"] == "section_exam":
            raise AttemptError(
                "section_exam_finish_module_required",
                "Section Exam Modules close with Finish Module or timer expiry.",
            )
        self._charge(state, self._clock.now(), mode="module")
        state["lastAnchorAt"] = None
        state["moduleDeadlineAt"] = None
        result = self._grade(plan, state)
        now = self._timestamp()
        with connect(self._data_root) as connection:
            connection.execute(
                """
                UPDATE attempts
                SET status = 'completed', state_json = ?, result_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps(state, separators=(",", ":")),
                    json.dumps(result, separators=(",", ":")),
                    now,
                    attempt_id,
                ),
            )
            connection.commit()
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def finish_module(self, attempt_id: str) -> dict[str, object]:
        row, plan, state = self._active_attempt(attempt_id)
        if row["kind"] != "section_exam":
            raise AttemptError(
                "finish_module_unavailable",
                "Finish Module is available only for Section Exam Attempts.",
            )
        self._charge(state, self._clock.now(), mode="module")
        status, result = self._close_section_exam_module(plan, state)
        self._persist(row, state, status=status, result=result)
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def continue_after_transition(self, attempt_id: str) -> dict[str, object]:
        row, plan, state = self._load_attempt(attempt_id)
        if row["status"] != "transition":
            raise AttemptError(
                "transition_unavailable", "Attempt is not waiting at a transition."
            )
        next_index = state["activeModuleIndex"] + 1
        if next_index >= len(plan["modules"]):
            raise AttemptError("attempt_complete", "No future Module is available.")
        state["activeModuleIndex"] = next_index
        state["currentQuestionId"] = plan["modules"][next_index]["questionIds"][0]
        remaining = plan["modules"][next_index].get("durationSeconds")
        state["remainingSeconds"] = remaining
        state["breakRemainingSeconds"] = None
        now = self._clock.now()
        state["lastAnchorAt"] = now
        state["moduleDeadlineAt"] = now + remaining if remaining is not None else None
        state["breakDeadlineAt"] = None
        self._persist(row, state, status="active")
        attempt = self.get_attempt(attempt_id, at=now)
        assert attempt is not None
        return attempt

    def end_break(self, attempt_id: str, *, confirmed: bool) -> dict[str, object]:
        self._enforce_deadlines(attempt_id)
        row, _plan, state = self._load_attempt(attempt_id)
        if row["status"] == "transition":
            attempt = self.get_attempt(attempt_id)
            assert attempt is not None
            return attempt
        if row["status"] != "break":
            raise AttemptError(
                "break_unavailable", "Attempt is not on its Section break."
            )
        if not confirmed:
            raise AttemptError(
                "break_confirmation_required",
                "Ending the break early requires confirmation.",
            )
        state["breakRemainingSeconds"] = 0
        state["breakDeadlineAt"] = None
        state["lastAnchorAt"] = None
        self._persist(row, state, status="transition")
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def use_scientific(self, setup_id: str) -> dict[str, object]:
        setup = self._load_setup(setup_id)
        selection = json.loads(setup["selection_json"])
        plan = json.loads(setup["plan_json"])
        readiness = json.loads(setup["readiness_json"])
        selection["calculatorMode"] = "scientific"
        plan["selection"] = selection
        for stage in readiness["stages"]:
            if stage["name"] == "math_tools":
                stage["status"] = "ready"
        if not any(stage["status"] == "failed" for stage in readiness["stages"]):
            if not any(stage["name"] == "ready" for stage in readiness["stages"]):
                readiness["stages"].append({"name": "ready", "status": "ready"})
            readiness.update(
                {
                    "status": "ready",
                    "failedStage": None,
                    "allowedActions": ["begin"],
                    "mathTool": {"mode": "scientific", "status": "ready"},
                }
            )
        self._save_setup(setup_id, selection, plan, readiness)
        return self._setup_payload(setup_id)

    def confirm_calculator(
        self, setup_id: str, checks: dict[str, bool]
    ) -> dict[str, object]:
        setup = self._load_setup(setup_id)
        selection = json.loads(setup["selection_json"])
        plan = json.loads(setup["plan_json"])
        readiness = json.loads(setup["readiness_json"])
        required = (
            "scriptLoaded",
            "constructorAvailable",
            "instanceCreated",
            "stateReadable",
            "usableSize",
        )
        failed_check = next((name for name in required if not checks.get(name)), None)
        for stage in readiness["stages"]:
            if stage["name"] == "math_tools":
                stage["status"] = "failed" if failed_check else "ready"
        if failed_check:
            readiness.update(
                {
                    "status": "failed",
                    "failedStage": "math_tools",
                    "allowedActions": [
                        "retry",
                        "return_to_setup",
                        "use_scientific",
                    ],
                }
            )
            readiness["mathTool"]["status"] = "failed"
            readiness["mathTool"]["failedCheck"] = failed_check
        else:
            if not any(stage["name"] == "ready" for stage in readiness["stages"]):
                readiness["stages"].append({"name": "ready", "status": "ready"})
            selection["calculatorMode"] = "desmos"
            plan["selection"] = selection
            readiness.update(
                {
                    "status": "ready",
                    "failedStage": None,
                    "allowedActions": ["begin"],
                }
            )
            readiness["mathTool"]["status"] = "ready"
            readiness["mathTool"].pop("failedCheck", None)
        self._save_setup(setup_id, selection, plan, readiness)
        return self._setup_payload(setup_id)

    def retake(self, attempt_id: str) -> dict[str, object]:
        attempt = self._require_completed(attempt_id)
        return self.prepare(
            package_id=attempt["packageId"],
            kind=attempt["kind"],
            selection=attempt["plan"]["selection"],
        )

    def practice_mistakes(self, attempt_id: str) -> dict[str, object]:
        attempt = self._require_completed(attempt_id)
        result = attempt["result"]
        missed = [
            question["id"]
            for question in result["questions"]
            if question["status"] != GradeStatus.CORRECT.value
        ]
        if not missed:
            raise AttemptError("no_mistakes", "This Attempt has no missed questions.")
        original = attempt["plan"]["selection"]
        selection = {
            **original,
            "questionIds": missed,
            "count": len(missed),
            "timing": "elapsed",
            "sections": list(
                dict.fromkeys(
                    q["section"] for q in result["questions"] if q["id"] in missed
                )
            ),
            "modules": list(
                dict.fromkeys(
                    q["module"] for q in result["questions"] if q["id"] in missed
                )
            ),
            "moduleCounts": None,
            "category": None,
        }
        return self.prepare(
            package_id=attempt["packageId"], kind="practice", selection=selection
        )

    def _build_plan(
        self, package: dict[str, Any], kind: str, selection: dict[str, Any]
    ) -> dict[str, Any]:
        if kind == "section_exam":
            eligibility = classify_section_exam(package["questions"])
            if not eligibility.eligible:
                if "mixed_sections" in eligibility.reasons:
                    raise AttemptError(
                        "section_exam_mixed_sections",
                        "Section Exam requires a package containing only one supported Section.",
                    )
                if "invalid_section" in eligibility.reasons:
                    raise AttemptError(
                        "section_exam_invalid_section",
                        "Section Exam supports only Math or Reading and Writing questions.",
                    )
                if "invalid_question" in eligibility.reasons:
                    raise AttemptError(
                        "section_exam_invalid_questions",
                        "This Test Package contains invalid questions for a Section Exam.",
                    )
                required = section_exam_total_questions(eligibility.section or "")
                raise AttemptError(
                    "section_exam_insufficient_questions",
                    f"This Test Package needs {required} valid {eligibility.section} questions for a Section Exam, but only {eligibility.question_count} are available.",
                )
            section = eligibility.section
            assert section is not None
            required = section_exam_total_questions(section)
            assert required is not None
            module_count = section_exam_module_count(section)
            assert module_count is not None
            selected = list(
                self._random.sample(list(package["questions"]), required)
            )
            self._random.shuffle(selected)
            selection = {**selection, "section": section}
            module_size = required // module_count
            modules = [
                {
                    "section": section,
                    "module": module_number,
                    "questionIds": [
                        question["id"]
                        for question in selected[
                            (module_number - 1) * module_size : module_number * module_size
                        ]
                    ],
                    "durationSeconds": standard_module_seconds(section),
                }
                for module_number in range(1, module_count + 1)
            ]
            duration = None
        elif kind == "simulation":
            selected = package["questions"]
            duration = None
        else:
            candidates = package["questions"]
            if selection.get("questionIds"):
                wanted = selection["questionIds"]
                by_id = {q["id"]: q for q in candidates}
                if len(set(wanted)) != len(wanted) or any(
                    item not in by_id for item in wanted
                ):
                    raise AttemptError(
                        "invalid_question_selection",
                        "Practice question selection is invalid.",
                    )
                candidates = [by_id[item] for item in wanted]
            descriptors = tuple(
                PracticeQuestion(
                    id=question["id"],
                    section=question["section"],
                    module=int(question["module"]),
                    question_number=int(question["question_number"]),
                    category=question.get("category"),
                )
                for question in candidates
            )
            module_counts = selection.get("moduleCounts")
            request = PracticeRequest(
                sections=tuple(selection.get("sections", ())),
                modules=tuple(int(item) for item in selection.get("modules", ())),
                count=int(selection.get("count", 0)),
                timing=selection.get("timing", "elapsed"),
                category=selection.get("category"),
                module_counts=(
                    tuple(
                        (int(item["module"]), int(item["count"]))
                        for item in module_counts
                    )
                    if module_counts
                    else None
                ),
                countdown_seconds=selection.get("countdownSeconds"),
                shuffle=bool(selection.get("shuffle", False)),
                seed=selection.get("seed"),
            )
            planned = build_practice_plan(descriptors, request)
            if planned.plan is None:
                raise AttemptError(planned.errors[0], "Practice selection is invalid.")
            by_id = {question["id"]: question for question in package["questions"]}
            selected = [by_id[item.id] for item in planned.plan.questions]
            duration = planned.plan.duration_seconds

        if kind != "section_exam":
            modules = []
            for question in selected:
                identity = (question["section"], int(question["module"]))
                if (
                    not modules
                    or (modules[-1]["section"], modules[-1]["module"]) != identity
                ):
                    modules.append(
                        {
                            "section": identity[0],
                            "module": identity[1],
                            "questionIds": [],
                        }
                    )
                modules[-1]["questionIds"].append(question["id"])
        if kind == "simulation":
            # A Simulation follows the standard sitting order regardless of
            # Answer CSV row order, so the Section break always lands after
            # Reading and Writing Module 2.
            selected = sorted(
                selected,
                key=lambda question: (
                    standard_module_position(
                        (question["section"], int(question["module"]))
                    ),
                    int(question["question_number"]),
                ),
            )
            for module in modules:
                module["durationSeconds"] = standard_module_seconds(module["section"])
        elif len(modules) == 1:
            modules[0]["durationSeconds"] = duration
        return {
            "packageId": package["id"],
            "packageTitle": package["title"],
            "packageRevision": package["revision"],
            "sourcePdfUrl": package["sourcePdfUrl"],
            "selection": selection,
            "questions": selected,
            "modules": modules,
            "durationSeconds": duration,
        }

    def _readiness(
        self,
        package: dict[str, Any],
        plan: dict[str, Any],
        selection: dict[str, Any],
    ) -> dict[str, object]:
        stages, math_tool = self._readiness_stages(package, plan, selection)
        failed = next((stage for stage in stages if stage["status"] == "failed"), None)
        loading = next((stage for stage in stages if stage["status"] == "loading"), None)
        gate_status = "failed" if failed else "loading" if loading else "ready"
        return {
            "status": gate_status,
            "failedStage": failed["name"] if failed else None,
            "allowedActions": self._gate_actions(gate_status, failed, loading),
            "stages": stages,
            "mathTool": math_tool,
        }

    def _readiness_stages(
        self,
        package: dict[str, Any],
        plan: dict[str, Any],
        selection: dict[str, Any],
    ) -> tuple[list[dict[str, str]], dict[str, object] | None]:
        source_status = (
            "ready"
            if self._authoring.verify_package_source(package["id"])
            else "failed"
        )
        regions_status = (
            "ready"
            if all(
                question.get("presentation") or question.get("regions")
                for question in plan["questions"]
            )
            else "failed"
        )
        autosave_status = "ready"
        try:
            with connect(self._data_root) as connection:
                connection.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                    ("autosave_probe", str(uuid.uuid4())),
                )
                connection.execute("DELETE FROM settings WHERE key = 'autosave_probe'")
                connection.commit()
        except OSError:
            autosave_status = "failed"
        stages = [
            {"name": "source_validation", "status": source_status},
            {"name": "question_region_preparation", "status": regions_status},
            {"name": "interface_assets", "status": "ready"},
        ]
        math_tool: dict[str, object] | None = None
        has_math = any(question["section"] == "Math" for question in plan["questions"])
        if has_math:
            if selection.get("calculatorMode") == "scientific":
                math_status = "ready"
                math_tool = {"mode": "scientific", "status": "ready"}
            else:
                configuration = load_math_configuration(
                    self._data_root,
                    os.environ,
                    reference_sheet_setting(self._data_root),
                )
                if configuration.configuration is None:
                    math_status = "failed"
                    math_tool = {
                        "mode": "desmos",
                        "status": "failed",
                        "diagnostics": [
                            {"code": item.code, "message": item.message}
                            for item in configuration.diagnostics
                        ],
                    }
                else:
                    math_status = "loading"
                    key = configuration.configuration.reveal_desmos_api_key()
                    math_tool = {
                        "mode": "desmos",
                        "status": "loading",
                        "scriptUrl": (
                            "https://www.desmos.com/api/v1.12/calculator.js?apiKey="
                            + quote(key, safe="")
                        ),
                        "options": {
                            "images": False,
                            "folders": False,
                            "notes": False,
                            "links": False,
                            "pasteGraphLink": False,
                            "authorFeatures": False,
                        },
                    }
            stages.append({"name": "math_tools", "status": math_status})
            reference = load_math_configuration(
                self._data_root,
                {"WHITEBOOK_DESMOS_API_KEY": "reference-check"},
                reference_sheet_setting(self._data_root),
            )
            stages.append(
                {
                    "name": "reference_sheet",
                    "status": "ready" if reference.configuration else "failed",
                }
            )
        stages.append({"name": "autosave_verification", "status": autosave_status})
        if all(stage["status"] == "ready" for stage in stages):
            stages.append({"name": "ready", "status": "ready"})
        return stages, math_tool

    def _load_setup(self, setup_id: str) -> object:
        with connect(self._data_root) as connection:
            setup = connection.execute(
                "SELECT * FROM attempt_setups WHERE id = ?", (setup_id,)
            ).fetchone()
        if setup is None:
            raise AttemptError("setup_not_found", "Attempt setup not found.")
        return setup

    def _save_setup(
        self,
        setup_id: str,
        selection: dict[str, Any],
        plan: dict[str, Any],
        readiness: dict[str, Any],
    ) -> None:
        self._refresh_readiness(readiness)
        with connect(self._data_root) as connection:
            connection.execute(
                """
                UPDATE attempt_setups
                SET selection_json = ?, plan_json = ?, readiness_json = ?
                WHERE id = ?
                """,
                (
                    json.dumps(selection, separators=(",", ":")),
                    json.dumps(plan, separators=(",", ":")),
                    self._stored_readiness(readiness),
                    setup_id,
                ),
            )
            connection.commit()
        self._log_readiness(setup_id, readiness)

    def _log_readiness(self, setup_id: str, readiness: dict) -> None:
        try:
            for stage in readiness["stages"]:
                self._diagnostics.record(
                    "loading_stage",
                    stage=stage["name"],
                    error_code=stage["status"],
                    resource_id=setup_id,
                )
        except OSError:
            # Diagnostic IO must not interrupt a durable learning-state operation.
            pass

    def _setup_payload(self, setup_id: str) -> dict[str, object]:
        setup = self._load_setup(setup_id)
        plan = json.loads(setup["plan_json"])
        readiness = json.loads(setup["readiness_json"])
        tool = readiness.get("mathTool")
        if (
            tool
            and tool["mode"] == "desmos"
            and os.environ.get("WHITEBOOK_DESMOS_API_KEY")
        ):
            tool["scriptUrl"] = (
                "https://www.desmos.com/api/v1.12/calculator.js?apiKey="
                + quote(os.environ["WHITEBOOK_DESMOS_API_KEY"], safe="")
            )
        return {
            "setupId": setup["id"],
            "packageId": setup["package_id"],
            "kind": setup["kind"],
            "selection": json.loads(setup["selection_json"]),
            "sourcePdfUrl": plan["sourcePdfUrl"],
            "questions": plan["questions"],
            **readiness,
        }

    @staticmethod
    def _stored_readiness(readiness: dict) -> str:
        stored = {**readiness}
        if stored.get("mathTool"):
            stored["mathTool"] = {
                key: value
                for key, value in stored["mathTool"].items()
                if key != "scriptUrl"
            }
        return json.dumps(stored, separators=(",", ":"))

    @staticmethod
    def _gate_actions(
        gate_status: str,
        failed: dict[str, str] | None,
        loading: dict[str, str] | None,
    ) -> list[str]:
        """Single owner of the gate's transition table, shared by prepare()
        and _refresh_readiness() so the two paths cannot drift."""
        if failed and failed["name"] == "math_tools":
            return ["retry", "return_to_setup", "use_scientific"]
        if loading and loading["name"] == "math_tools":
            return [
                "confirm_calculator_ready",
                "retry",
                "return_to_setup",
                "use_scientific",
            ]
        if gate_status == "ready":
            return ["begin"]
        return ["retry", "return_to_setup"]

    @staticmethod
    def _refresh_readiness(readiness: dict) -> None:
        stages = [stage for stage in readiness["stages"] if stage["name"] != "ready"]
        failed = next((s for s in stages if s["status"] == "failed"), None)
        loading = next((s for s in stages if s["status"] == "loading"), None)
        readiness["status"] = "failed" if failed else "loading" if loading else "ready"
        readiness["failedStage"] = failed["name"] if failed else None
        readiness["allowedActions"] = AttemptEngine._gate_actions(
            readiness["status"], failed, loading
        )
        if not (failed or loading):
            stages.append({"name": "ready", "status": "ready"})
        readiness["stages"] = stages

    def _active_attempt(self, attempt_id: str) -> tuple[object, dict, dict]:
        self._enforce_deadlines(attempt_id)
        row, plan, state = self._load_attempt(attempt_id)
        if row["status"] != "active":
            raise AttemptError("attempt_not_active", "Attempt is not active.")
        return row, plan, state

    def _enforce_deadlines(self, attempt_id: str) -> None:
        """Compare stored deadlines against the server clock and persist the
        resulting transition once. Runs on every relevant read and mutation,
        so a sleeping tab, changed device clock, or takeover can never extend
        time — and no per-second tick or write is needed to get there."""
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        if row is None:
            return
        plan, state = (
            json.loads(row["plan_json"]),
            self._normalize_state(json.loads(row["state_json"])),
        )
        status = row["status"]
        now = self._clock.now()
        if status == "active":
            deadline = state.get("moduleDeadlineAt")
            if deadline is not None and now >= deadline:
                self._charge(state, now, mode="module")
                status, result = self._expire_active(row, plan, state)
                self._persist(row, state, status=status, result=result)
        elif status == "break":
            deadline = state.get("breakDeadlineAt")
            if deadline is not None and now >= deadline:
                self._charge(state, now, mode="break")
                state["lastAnchorAt"] = None
                self._persist(row, state, status="transition")

    def _charge(self, state: dict, now: float, *, mode: str) -> None:
        """Charge wall-clock time since the anchor into the durable counters
        at a coarse checkpoint. The module charge is capped at the stored
        remaining seconds so a late read can never overshoot the deadline."""
        anchor = state.get("lastAnchorAt")
        if anchor is None:
            state["lastAnchorAt"] = now
            return
        delta = max(0.0, now - anchor)
        if mode == "break":
            break_remaining = state.get("breakRemainingSeconds")
            if break_remaining is not None:
                state["breakRemainingSeconds"] = max(0.0, break_remaining - delta)
        else:
            remaining = state.get("remainingSeconds")
            if remaining is not None:
                delta = min(delta, remaining)
            state["elapsedSeconds"] = state.get("elapsedSeconds", 0) + delta
            current = state.get("currentQuestionId")
            if current is not None:
                question_seconds = state.setdefault("questionSeconds", {})
                question_seconds[current] = question_seconds.get(current, 0) + delta
            if remaining is not None:
                state["remainingSeconds"] = max(0.0, remaining - delta)
        state["lastAnchorAt"] = now

    def _load_attempt(self, attempt_id: str) -> tuple[object, dict, dict]:
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        if row is None:
            raise AttemptError("attempt_not_found", "Attempt not found.")
        return (
            row,
            json.loads(row["plan_json"]),
            self._normalize_state(json.loads(row["state_json"])),
        )

    @staticmethod
    def _normalize_state(state: dict) -> dict:
        """Map pre-anchor durable state from the per-second tick era onto
        deadline anchors so an upgrade can never extend a running Attempt."""
        if "lastAnchorAt" in state:
            return state
        anchor = state.pop("lastTick", None)
        state["lastAnchorAt"] = anchor
        remaining = state.get("remainingSeconds")
        state["moduleDeadlineAt"] = (
            anchor + remaining if anchor is not None and remaining is not None else None
        )
        state["breakDeadlineAt"] = None
        return state

    @staticmethod
    def _require_active_question(plan: dict, state: dict, question_id: str) -> None:
        active_ids = plan["modules"][state["activeModuleIndex"]]["questionIds"]
        if question_id not in active_ids:
            raise AttemptError(
                "question_not_active",
                "Only questions in the active Module are available.",
            )

    def _save_state(
        self, row: object, state: dict, *, status: str | None = None
    ) -> None:
        # Every durable write is a coarse timing checkpoint; reads never charge.
        if row["status"] == "active":
            self._charge(state, self._clock.now(), mode="module")
        elif row["status"] == "break":
            self._charge(state, self._clock.now(), mode="break")
        with connect(self._data_root) as connection:
            connection.execute(
                """
                UPDATE attempts SET status = ?, state_json = ?, updated_at = ? WHERE id = ?
                """,
                (
                    status or row["status"],
                    json.dumps(state, separators=(",", ":")),
                    self._timestamp(),
                    row["id"],
                ),
            )
            connection.commit()

    def _persist(
        self,
        row: object,
        state: dict,
        *,
        status: str,
        result: dict[str, object] | None = None,
    ) -> None:
        with connect(self._data_root) as connection:
            connection.execute(
                """
                UPDATE attempts
                SET status = ?, state_json = ?, result_json = COALESCE(?, result_json),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    json.dumps(state, separators=(",", ":")),
                    json.dumps(result, separators=(",", ":")) if result else None,
                    self._timestamp(),
                    row["id"],
                ),
            )
            connection.commit()

    def _expire_active(
        self, row: object, plan: dict, state: dict
    ) -> tuple[str, dict[str, object] | None]:
        if row["kind"] == "practice":
            state["lastAnchorAt"] = None
            state["moduleDeadlineAt"] = None
            return "completed", self._grade(plan, state)
        if row["kind"] == "section_exam":
            return self._close_section_exam_module(plan, state)
        active_index = state["activeModuleIndex"]
        if active_index not in state["lockedModules"]:
            state["lockedModules"].append(active_index)
        if active_index == len(plan["modules"]) - 1:
            state["lastAnchorAt"] = None
            state["moduleDeadlineAt"] = None
            return "completed", self._grade(plan, state)
        if active_index == 1:
            now = self._clock.now()
            state["breakRemainingSeconds"] = BREAK_SECONDS
            state["breakDeadlineAt"] = now + BREAK_SECONDS
            state["lastAnchorAt"] = now
            return "break", None
        state["lastAnchorAt"] = None
        state["moduleDeadlineAt"] = None
        return "transition", None

    def _close_section_exam_module(
        self, plan: dict, state: dict
    ) -> tuple[str, dict[str, object] | None]:
        active_index = state["activeModuleIndex"]
        if active_index not in state["lockedModules"]:
            state["lockedModules"].append(active_index)
        state["lastAnchorAt"] = None
        state["moduleDeadlineAt"] = None
        if active_index == len(plan["modules"]) - 1:
            return "completed", self._grade(plan, state)
        state["breakRemainingSeconds"] = None
        return "transition", None

    def _grade(self, plan: dict, state: dict) -> dict[str, object]:
        question_results = []
        statuses = []
        module_by_question = {
            question_id: module["module"]
            for module in plan["modules"]
            for question_id in module["questionIds"]
        }
        for question in plan["questions"]:
            response = state["responses"].get(question["id"])
            if (
                question["response_type"] == MULTIPLE_CHOICE
                and response is not None
                and response.strip().upper() not in VALID_MCQ_ANSWERS
            ):
                # Durable state written before save_response validation may
                # hold an off-contract selection; grade it incorrect instead
                # of wedging every future tick on the kernel's contract. Plan
                # corruption (e.g. no accepted answers) still surfaces.
                status = GradeStatus.INCORRECT
            else:
                status = grade_question(
                    LearnerResponse(selected=response),
                    GradingQuestion(
                        response_type=question["response_type"],
                        accepted_answers=tuple(question["accepted_answers"]),
                    ),
                )
            statuses.append(status)
            review = state["reviewState"].get(
                question["id"], {"marked": False, "eliminatedChoices": []}
            )
            question_results.append(
                {
                    "id": question["id"],
                    "section": question["section"],
                    "module": module_by_question.get(
                        question["id"], question["module"]
                    ),
                    "questionNumber": question["question_number"],
                    "category": question.get("category"),
                    "responseType": question["response_type"],
                    "learnerResponse": response,
                    "acceptedAnswers": question["accepted_answers"],
                    "status": status.value,
                    "marked": review["marked"],
                    "elapsedSeconds": state["questionSeconds"].get(question["id"], 0),
                    "regions": question["regions"],
                    **(
                        {"presentation": question["presentation"]}
                        if question.get("presentation")
                        else {}
                    ),
                }
            )
        summary = summarize_grades(statuses)
        by_section: dict[str, dict[str, int]] = {}
        by_module: dict[str, dict[str, int]] = {}
        by_category: dict[str, dict[str, int]] = {}
        for question in question_results:
            for key, target in (
                (question["section"], by_section),
                (f"{question['section']} · Module {question['module']}", by_module),
            ):
                bucket = target.setdefault(
                    key, {"correct": 0, "total": 0, "elapsedSeconds": 0}
                )
                bucket["total"] += 1
                bucket["correct"] += question["status"] == "correct"
                bucket["elapsedSeconds"] += question["elapsedSeconds"]
            if question["category"]:
                bucket = by_category.setdefault(
                    question["category"],
                    {"correct": 0, "total": 0, "elapsedSeconds": 0},
                )
                bucket["total"] += 1
                bucket["correct"] += question["status"] == "correct"
                bucket["elapsedSeconds"] += question["elapsedSeconds"]
        return {
            **asdict(summary),
            "questions": question_results,
            "elapsedSeconds": state["elapsedSeconds"],
            "bySection": by_section,
            "byModule": by_module,
            "byCategory": by_category,
        }

    def _require_package(
        self, package_id: str, *, allow_archived: bool = False
    ) -> dict[str, Any]:
        package = self._authoring.get_package(package_id)
        if package is None or (package["archived"] and not allow_archived):
            raise AttemptError("package_not_found", "Test Package not found.")
        return package

    def _require_completed(self, attempt_id: str) -> dict[str, Any]:
        attempt = self.get_attempt(attempt_id)
        if attempt is None:
            raise AttemptError("attempt_not_found", "Attempt not found.")
        if attempt["status"] != "completed":
            raise AttemptError("attempt_not_completed", "Attempt is not completed.")
        return attempt

    @staticmethod
    def _attempt_payload(row: object, now: float) -> dict[str, object]:
        plan = json.loads(row["plan_json"])
        state = AttemptEngine._normalize_state(json.loads(row["state_json"]))
        status = row["status"]
        # Remaining time is derived from the stored server deadline at read
        # time rather than accumulated by per-second writes.
        if status == "active" and state.get("moduleDeadlineAt") is not None:
            state["remainingSeconds"] = max(0.0, state["moduleDeadlineAt"] - now)
        elif status == "break" and state.get("breakDeadlineAt") is not None:
            state["breakRemainingSeconds"] = max(0.0, state["breakDeadlineAt"] - now)
        return {
            "id": row["id"],
            "packageId": row["package_id"],
            "kind": row["kind"],
            "status": status,
            "plan": plan,
            "questions": plan["questions"],
            **state,
            # Lets the client detect skew while keeping the server clock
            # authoritative for every deadline decision.
            "serverNow": now,
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(UTC).isoformat()
