from __future__ import annotations

import json
import os
import time
import uuid
from collections import Counter
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from whitebook.authoring import PackageAuthoring
from whitebook.grading import GradeStatus, grade_mcq, grade_spr, summarize_grades
from whitebook.math_config import load_math_configuration
from whitebook.practice_rules import (
    PracticeQuestion,
    PracticeRequest,
    build_practice_plan,
)
from whitebook.storage import connect


class AttemptError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


class Clock(Protocol):
    def now(self) -> float: ...


class SystemClock:
    def now(self) -> float:
        return time.time()


class AttemptEngine:
    """Owns frozen plans, durable learner state, and Raw Accuracy results."""

    def __init__(self, data_root: Path, *, clock: Clock | None = None) -> None:
        self._data_root = data_root
        self._authoring = PackageAuthoring(data_root)
        self._clock = clock or SystemClock()

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
        package = self._require_package(package_id)
        if kind not in {"practice", "simulation"}:
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
            plan = self._build_plan(package, kind, selection)

        stages, math_tool = self._readiness_stages(package, plan, selection)
        failed = next((stage for stage in stages if stage["status"] == "failed"), None)
        loading = next(
            (stage for stage in stages if stage["status"] == "loading"), None
        )
        gate_status = "failed" if failed else "loading" if loading else "ready"
        if failed and failed["name"] == "math_tools":
            allowed_actions = ["retry", "return_to_setup", "use_scientific"]
        elif loading and loading["name"] == "math_tools":
            allowed_actions = [
                "confirm_calculator_ready",
                "retry",
                "return_to_setup",
                "use_scientific",
            ]
        else:
            allowed_actions = (
                ["begin"] if gate_status == "ready" else ["retry", "return_to_setup"]
            )
        readiness = {
            "status": gate_status,
            "failedStage": failed["name"] if failed else None,
            "allowedActions": allowed_actions,
            "stages": stages,
            "mathTool": math_tool,
        }
        setup_id = str(uuid.uuid4())
        now = self._timestamp()
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
                    json.dumps(readiness, separators=(",", ":")),
                    resume_attempt_id,
                    now,
                ),
            )
            connection.commit()
        return {
            "setupId": setup_id,
            "packageId": package_id,
            "kind": kind,
            "selection": selection,
            **readiness,
        }

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
            return self.resume(setup["resume_attempt_id"])

        plan = json.loads(setup["plan_json"])
        attempt_id = str(uuid.uuid4())
        now = self._timestamp()
        questions = plan["questions"]
        state = {
            "currentQuestionId": questions[0]["id"],
            "activeModuleIndex": 0,
            "responses": {},
            "reviewState": {},
            "lockedModules": [],
            "elapsedSeconds": 0,
            "questionSeconds": {question["id"]: 0 for question in questions},
            "remainingSeconds": plan["modules"][0].get("durationSeconds"),
            "breakRemainingSeconds": None,
            "lastTick": self._clock.now(),
            "resumeReady": False,
            "calculatorState": None,
            "calculatorMode": plan["selection"].get("calculatorMode", "none"),
        }
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
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def get_attempt(self, attempt_id: str) -> dict[str, object] | None:
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        return self._attempt_payload(row) if row else None

    def tick(self, attempt_id: str) -> dict[str, object]:
        row, plan, state = self._load_attempt(attempt_id)
        status = row["status"]
        if status not in {"active", "break"}:
            attempt = self.get_attempt(attempt_id)
            assert attempt is not None
            return attempt
        now = self._clock.now()
        last_tick = float(state.get("lastTick") or now)
        elapsed = max(0.0, now - last_tick)
        state["lastTick"] = now
        result = None
        if status == "active":
            state["elapsedSeconds"] += elapsed
            current = state["currentQuestionId"]
            state["questionSeconds"][current] = (
                state["questionSeconds"].get(current, 0) + elapsed
            )
            if state["remainingSeconds"] is not None:
                state["remainingSeconds"] = max(
                    0.0, state["remainingSeconds"] - elapsed
                )
                if state["remainingSeconds"] == 0:
                    status, result = self._expire_active(row, plan, state)
        else:
            state["breakRemainingSeconds"] = max(
                0.0, state["breakRemainingSeconds"] - elapsed
            )
            if state["breakRemainingSeconds"] == 0:
                state["lastTick"] = None
                status = "transition"
        self._persist(row, state, status=status, result=result)
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def list_attempts(self) -> list[dict[str, object]]:
        with connect(self._data_root) as connection:
            rows = connection.execute(
                "SELECT * FROM attempts ORDER BY updated_at DESC"
            ).fetchall()
        return [self._attempt_payload(row) for row in rows]

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
            state["responses"][question_id] = response
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
                if choice in "ABCD"
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
        self._require_active_question(plan, state, question_id)
        state["currentQuestionId"] = question_id
        self._save_state(row, state)
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def pause(self, attempt_id: str) -> dict[str, object]:
        self.tick(attempt_id)
        row, _plan, state = self._active_attempt(attempt_id)
        state["lastTick"] = None
        state["resumeReady"] = False
        self._save_state(row, state, status="paused")
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

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
        state["lastTick"] = self._clock.now()
        state["resumeReady"] = False
        self._save_state(row, state, status="active")
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def submit(self, attempt_id: str) -> dict[str, object]:
        row, plan, state = self._active_attempt(attempt_id)
        if row["kind"] == "simulation":
            raise AttemptError(
                "simulation_early_submit",
                "Simulation Modules close only when their standard time expires.",
            )
        result = self._grade(plan, state)
        state["lastTick"] = None
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
        state["remainingSeconds"] = plan["modules"][next_index].get("durationSeconds")
        state["breakRemainingSeconds"] = None
        state["lastTick"] = self._clock.now()
        self._persist(row, state, status="active")
        attempt = self.get_attempt(attempt_id)
        assert attempt is not None
        return attempt

    def end_break(self, attempt_id: str, *, confirmed: bool) -> dict[str, object]:
        self.tick(attempt_id)
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
        state["lastTick"] = None
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
        }
        return self.prepare(
            package_id=attempt["packageId"], kind="practice", selection=selection
        )

    def _build_plan(
        self, package: dict[str, Any], kind: str, selection: dict[str, Any]
    ) -> dict[str, Any]:
        if kind == "simulation":
            selected = package["questions"]
            duration = None
        elif selection.get("questionIds"):
            wanted = selection["questionIds"]
            by_id = {question["id"]: question for question in package["questions"]}
            if len(set(wanted)) != len(wanted) or any(
                item not in by_id for item in wanted
            ):
                raise AttemptError(
                    "invalid_question_selection",
                    "Practice question selection is invalid.",
                )
            selected = [by_id[item] for item in wanted]
            duration = None
        else:
            descriptors = tuple(
                PracticeQuestion(
                    id=question["id"],
                    section=question["section"],
                    module=int(question["module"]),
                    question_number=int(question["question_number"]),
                    category=question.get("category"),
                )
                for question in package["questions"]
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

        modules: list[dict[str, object]] = []
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
            for module in modules:
                module["durationSeconds"] = (
                    32 * 60 if module["section"] == "Reading and Writing" else 35 * 60
                )
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

    def _readiness_stages(
        self,
        package: dict[str, Any],
        plan: dict[str, Any],
        selection: dict[str, Any],
    ) -> tuple[list[dict[str, str]], dict[str, object] | None]:
        source = self._authoring.package_source_pdf(package["id"])
        source_status = "ready" if source and source.is_file() else "failed"
        regions_status = (
            "ready"
            if all(question.get("regions") for question in plan["questions"])
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
                    "assets/reference-sheet.png",
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
                    json.dumps(readiness, separators=(",", ":")),
                    setup_id,
                ),
            )
            connection.commit()

    def _setup_payload(self, setup_id: str) -> dict[str, object]:
        setup = self._load_setup(setup_id)
        return {
            "setupId": setup["id"],
            "packageId": setup["package_id"],
            "kind": setup["kind"],
            "selection": json.loads(setup["selection_json"]),
            **json.loads(setup["readiness_json"]),
        }

    def _active_attempt(self, attempt_id: str) -> tuple[object, dict, dict]:
        self.tick(attempt_id)
        row, plan, state = self._load_attempt(attempt_id)
        if row["status"] != "active":
            raise AttemptError("attempt_not_active", "Attempt is not active.")
        return row, plan, state

    def _load_attempt(self, attempt_id: str) -> tuple[object, dict, dict]:
        with connect(self._data_root) as connection:
            row = connection.execute(
                "SELECT * FROM attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        if row is None:
            raise AttemptError("attempt_not_found", "Attempt not found.")
        return row, json.loads(row["plan_json"]), json.loads(row["state_json"])

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
            state["lastTick"] = None
            return "completed", self._grade(plan, state)
        active_index = state["activeModuleIndex"]
        if active_index not in state["lockedModules"]:
            state["lockedModules"].append(active_index)
        state["lastTick"] = None
        if active_index == len(plan["modules"]) - 1:
            return "completed", self._grade(plan, state)
        if active_index == 1:
            state["breakRemainingSeconds"] = 10 * 60
            state["lastTick"] = self._clock.now()
            return "break", None
        return "transition", None

    def _grade(self, plan: dict, state: dict) -> dict[str, object]:
        question_results = []
        statuses = []
        for question in plan["questions"]:
            response = state["responses"].get(question["id"])
            if question["response_type"] == "multiple_choice":
                status = grade_mcq(response, question["accepted_answers"][0])
            else:
                status = grade_spr(response, tuple(question["accepted_answers"]))
            statuses.append(status)
            review = state["reviewState"].get(
                question["id"], {"marked": False, "eliminatedChoices": []}
            )
            question_results.append(
                {
                    "id": question["id"],
                    "section": question["section"],
                    "module": question["module"],
                    "questionNumber": question["question_number"],
                    "category": question.get("category"),
                    "responseType": question["response_type"],
                    "learnerResponse": response,
                    "acceptedAnswers": question["accepted_answers"],
                    "status": status.value,
                    "marked": review["marked"],
                    "elapsedSeconds": state["questionSeconds"].get(question["id"], 0),
                    "regions": question["regions"],
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
                bucket = target.setdefault(key, {"correct": 0, "total": 0})
                bucket["total"] += 1
                bucket["correct"] += question["status"] == "correct"
            if question["category"]:
                bucket = by_category.setdefault(
                    question["category"], {"correct": 0, "total": 0}
                )
                bucket["total"] += 1
                bucket["correct"] += question["status"] == "correct"
        return {
            **asdict(summary),
            "questions": question_results,
            "elapsedSeconds": state["elapsedSeconds"],
            "bySection": by_section,
            "byModule": by_module,
            "byCategory": by_category,
        }

    def _require_package(self, package_id: str) -> dict[str, Any]:
        package = self._authoring.get_package(package_id)
        if package is None or package["archived"]:
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
    def _attempt_payload(row: object) -> dict[str, object]:
        plan = json.loads(row["plan_json"])
        state = json.loads(row["state_json"])
        return {
            "id": row["id"],
            "packageId": row["package_id"],
            "kind": row["kind"],
            "status": row["status"],
            "plan": plan,
            "questions": plan["questions"],
            **state,
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(UTC).isoformat()
