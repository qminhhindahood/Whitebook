# 01 — Generate and complete a Section Exam Attempt

**What to build:** Start Exam creates a randomized, timed two-Module Section Exam Attempt from the clicked Test Package, with durable progress and results.

**Blocked by:** None — can start immediately.

**Status:** ready-for-human

**Difficulty:** Hard

**Why:** Crosses selection, persisted Attempt structure, API, readiness, player timing, grading and History. Keep the complete flow in one slice by reusing the existing Attempt machinery.

## Acceptance criteria

- [x] Clicking Start Exam on an active single-section Test Package creates exactly two Math Modules of 22 questions each, or two Reading and Writing Modules of 27 questions each.
- [x] Select and shuffle questions on the server without replacement across the entire Attempt, using only the clicked package. Questions used in earlier Attempts remain eligible. Uniqueness uses question identity; semantic duplicate detection is outside scope.
- [x] Generate Module membership independently of source Module labels, while preserving source question identity, grading data and presentation. Do not mutate the published Test Package.
- [x] Eligibility depends on sufficient valid questions for the selected Section rather than the existing four-Module Simulation eligibility flag. Archived, invalid, insufficient and unsupported mixed-section packages cannot silently start an incorrect exam; show an actionable reason.
- [x] Persist selected questions, generated Module membership and order once. Loading retries and save/pause/resume preserve them, along with answers, question state and remaining time.
- [x] The Attempt Loading Gate completes before questions become accessible or timers begin, including existing Math resource readiness checks.
- [x] Math Modules each receive 35 minutes; Reading and Writing Modules each receive 32 minutes. Timer expiry closes only the active Module. Module 1 offers Continue to Module 2 with no timed break, and Module 2 completes the Attempt.
- [x] Closed Modules cannot be reopened for answering. History and Results recognize Section Exam Attempts and grade using the generated Modules, with unanswered questions included in Raw Accuracy.
- [x] Start Exam has pending and error states and prevents accidental duplicate Attempt creation. Existing Practice Attempts and full Simulation Attempts remain functional.
- [x] Tests cover exact and insufficient pool sizes, no cross-Module overlap, controlled random selection/order, readiness, durable resume, timer transitions and grading. Avoid flaky tests that require two random runs to differ.

## Execution constraints

Use the approved Dashboard, landing page and generated exams specification as the source of truth. Preserve existing local changes and private question-bank data. Before implementation, establish a reproducible baseline that includes relevant current fixes; frontend redesign work uses a separate worktree from that baseline. Do not use subagents. Difficulty is a planning category, not a replacement for dependency checks.

## Comments

- Implemented server-owned Section Exam generation and persistence, the Finish Module lifecycle, exact timing/expiry/transition behavior, eligibility metadata, and frontend Start Exam/History/Results/player integration.
- Verification: `uv run pytest -q` (160 passed), `npm --prefix web run test` (64 passed), `npm --prefix web run typecheck`, `npm run build`, and targeted Ruff checks all pass.
- Remaining risk: browser-level manual verification with real PDFs and live Desmos was not run in this change; existing Loading Gate and Math readiness tests remain green.
