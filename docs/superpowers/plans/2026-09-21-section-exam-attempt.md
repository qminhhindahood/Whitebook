# Section Exam Attempt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, persist, run, and grade a randomized two-Module Section Exam Attempt from exactly one selected Test Package while preserving Practice and Full Simulation behavior.

**Architecture:** Extend the existing `AttemptEngine` with a `section_exam` kind and reuse its setup/loading-gate, durable state, clock, transition, and grading machinery. Generate the frozen question plan during setup preparation, store generated module membership separately from source question metadata, and add explicit Section Exam completion semantics for module finish/expiry. Update the existing React Library, Loading Gate, Player, History, Results, and shared types to consume the new kind without changing Practice or Simulation API contracts.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, pytest, React 19, TypeScript, Vite, Vitest, Testing Library.

**Spec:** `.scratch/dashboard-exam-redesign/spec.md` and `.scratch/dashboard-exam-redesign/issues/01-section-exam.md`

## Global Constraints

- Start Exam uses only the clicked single-section Test Package.
- Math creates exactly two Modules of 22 questions each; Reading and Writing creates exactly two Modules of 27 questions each.
- Questions are sampled and shuffled without repetition within one Attempt; previous Attempts do not exclude questions.
- Generated selection, order, Module membership, responses, review state, and remaining time are durable.
- Attempt Loading Gate and existing Math readiness remain prerequisites for Begin and timing.
- Math Modules receive 35 minutes each; Reading and Writing Modules receive 32 minutes each.
- The published Test Package is immutable.
- Existing Practice and Full Simulation behavior must remain functional.
- Do not use subagents or destructive Git commands; preserve unrelated untracked work.

### Task 1: Define Section Exam eligibility and package-facing metadata

**Files:**
- Modify: `src/whitebook/sat_policy.py`
- Modify: `src/whitebook/authoring.py`
- Modify: `web/src/types.ts`
- Test: `tests/test_package_eligibility.py`
- Test: `web/src/screens/Library.test.tsx`

**Interfaces:**
- Produce `section_exam_module_count(section: str) -> int | None`, `section_exam_total_questions(section: str) -> int | None`, and a pure eligibility result that identifies the single supported Section, valid pool count, and actionable failure reason.
- Expose `sectionExamEligible`, `sectionExamSection`, `sectionExamQuestionCount`, and `sectionExamEligibilityReasons` in Test Package payloads.

- [x] **Step 1: Write failing eligibility tests** for exact Math/RW totals, mixed sections, unsupported sections, invalid question data, duplicate identities, and insufficient valid pools; add a Library fixture assertion for Section Exam eligibility rather than `simulationEligible`.
- [x] **Step 2: Run focused tests and verify the new assertions fail** because package payloads and eligibility helpers do not exist.
- [x] **Step 3: Implement the pure policy/eligibility helper** using only package question data; do not read Attempt history and do not mutate package data.
- [x] **Step 4: Add the computed metadata to package payloads and TypeScript types.**
- [x] **Step 5: Run `uv run pytest tests/test_package_eligibility.py -q` and `npm --prefix web run test -- src/screens/Library.test.tsx`; verify green.

### Task 2: Generate and persist a frozen Section Exam plan

**Files:**
- Modify: `src/whitebook/attempts.py`
- Modify: `src/whitebook/app.py`
- Test: `tests/test_section_exam_engine.py`
- Test: `tests/test_attempt_api.py`

**Interfaces:**
- Extend `AttemptEngine.prepare(..., kind=...)` and `_build_plan(...)` with `kind == "section_exam"`.
- Add an injectable random source to `AttemptEngine` for deterministic tests while using a fresh server random source by default.
- Add `AttemptEngine.finish_module(attempt_id: str) -> dict[str, object]` for confirmed frontend completion.
- Add the `/api/attempts/{attempt_id}/finish-module` endpoint.

- [x] **Step 1: Write failing engine/API tests** for exact 44/54 question totals, two generated Modules, no cross-Module overlap, package-only selection, controlled random order, previously used-question reuse, insufficient pools, invalid/mixed packages, archived package rejection, and published-package immutability.
- [x] **Step 2: Run `uv run pytest tests/test_section_exam_engine.py tests/test_attempt_api.py -q` and verify failures are caused by the missing Section Exam kind/endpoint.
- [x] **Step 3: Implement Section Exam plan generation** by validating the clicked active package, selecting exactly the target total from valid questions without replacement, shuffling with the injected random source, and partitioning into generated Modules 1 and 2 while retaining source question identity/presentation/grading data.
- [x] **Step 4: Persist the generated plan in `attempt_setups.plan_json` and preserve it when retrying the Loading Gate; only copy the frozen plan into the Attempt on Begin.
- [x] **Step 5: Add clear `AttemptError` codes/messages for unsupported, invalid, insufficient, archived, and not-found package cases; map them through the existing FastAPI error handling.
- [x] **Step 6: Run the focused backend tests and verify green.

### Task 3: Add Section Exam timing, save/pause/resume, transitions, and grading

**Files:**
- Modify: `src/whitebook/attempts.py`
- Test: `tests/test_section_exam_engine.py`
- Test: `tests/test_attempt_regressions.py`
- Test: `tests/test_simulation_engine.py`

**Interfaces:**
- Section Exam attempts have `kind: "section_exam"`, two timed Modules, and the existing state fields for responses, review state, question time, remaining time, and calculator state.
- `finish_module` closes only the active Module; Module 1 becomes `transition`, and Module 2 becomes `completed` with one result.

- [x] **Step 1: Write failing lifecycle tests** for Math/RW durations, initial remaining time, answer/review persistence, pause/resume without charging downtime, timer expiry, locked modules, active-module-only access, transition continuation without a break, duplicate finish requests, finish/expiry races, unanswered grading, and generated-module result buckets.
- [x] **Step 2: Run the focused tests and verify they fail on missing Section Exam lifecycle behavior.
- [x] **Step 3: Implement Section Exam duration assignment and branch expiry/finish logic** so both finish and expiry use one idempotent module-closing path; preserve existing Simulation break behavior and Practice submission behavior.
- [x] **Step 4: Update grading to derive result Module numbers from generated plan membership for Section Exam attempts while leaving source package module labels untouched.
- [x] **Step 5: Verify the existing regression suites for Practice and Simulation still pass, then run all focused backend tests again.

### Task 4: Connect the frontend Start Exam and attempt types

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/screens/Library.tsx`
- Modify: `web/src/screens/History.tsx`
- Modify: `web/src/screens/Results.tsx`
- Test: `web/src/screens/Library.test.tsx`
- Test: `web/src/results.test.tsx`

**Interfaces:**
- `Attempt.kind` and `AttemptGate.kind` include `section_exam`.
- Library Start Exam calls `/api/attempt-setups` with `{ packageId, kind: "section_exam", selection: {} }` and is disabled only when Section Exam eligibility is false.
- History and Results label Section Exam Attempts clearly.

- [x] **Step 1: Write failing frontend tests** for Section Exam eligibility/button behavior, the exact setup request, pending/error handling in App-level start flow, and Section Exam labels in History/Results.
- [x] **Step 2: Run the focused Vitest files and verify failures before implementation.
- [x] **Step 3: Implement the new shared types and Library/App wiring** while retaining the existing Simulation API path for backend compatibility.
- [x] **Step 4: Update History/Results copy and any kind-dependent branches without changing Practice or Simulation behavior.
- [x] **Step 5: Run focused frontend tests and `npm --prefix web run typecheck`.

### Task 5: Add Section Exam player completion while preserving the Loading Gate and Math readiness

**Files:**
- Modify: `web/src/useAttemptSession.ts`
- Modify: `web/src/screens/Player.tsx`
- Modify: `web/src/screens/LoadingGate.tsx`
- Modify: `web/src/attemptRoute.ts`
- Test: `web/src/player.test.tsx`
- Test: `web/src/useAttemptSession.test.tsx`
- Test: `web/src/useAttemptClock.test.tsx`
- Test: `web/src/math-presentation.test.tsx`

**Interfaces:**
- Section Exam uses the existing Loading Gate resource preparation and Math readiness checks unchanged.
- Player exposes a confirmed Finish Module action for Section Exam attempts, calls `/finish-module`, and renders the existing transition screen or Results route from the server response.
- Save/pause/resume remains server-authoritative through the existing hooks.

- [x] **Step 1: Write failing frontend tests** for Begin remaining blocked until resources are ready, Math readiness behavior, Section Exam Finish Module confirmation/API call, transition into Module 2, completed-result routing, and timer-driven state updates.
- [x] **Step 2: Run the focused Vitest files and verify the new tests fail for the missing Section Exam UI path.
- [x] **Step 3: Implement the Section Exam branch in the session/player UI** with confirmation text that unanswered questions count in Raw Accuracy; keep Practice Submit and Simulation transition behavior unchanged.
- [x] **Step 4: Run focused frontend tests and typecheck; fix only scoped regressions.

### Task 6: Full verification, ticket status, review, and commit

**Files:**
- Modify: `.scratch/dashboard-exam-redesign/issues/01-section-exam.md`
- Modify: `docs/superpowers/plans/2026-09-21-section-exam-attempt.md`

- [x] **Step 1: Run the complete backend suite with `uv run pytest -q`.
- [x] **Step 2: Run the complete frontend suite with `npm --prefix web run test`.
- [x] **Step 3: Run `npm --prefix web run typecheck` and `npm run build`.
- [x] **Step 4: Inspect `git diff` and `git status`, confirm unrelated untracked files remain untouched, and perform an inline standards/spec review because repository instructions prohibit subagents.
- [x] **Step 5: Mark every completed acceptance criterion in the ticket, set the tracker status to `ready-for-human`, and record changed files, verification commands, and any remaining risks.
- [x] **Step 6: Commit only the implementation, tests, plan, and ticket-status files with `git add` paths explicitly listed, then verify the commit and working-tree status.
