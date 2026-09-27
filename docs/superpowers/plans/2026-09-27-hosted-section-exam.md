# Hosted Section Exam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete a hosted, account-owned two-Module Section Exam with server-enforced module deadlines, private active answers, preserved Math tools, and measured browser journeys.

**Architecture:** Extend the existing `learner_attempts` API and React player. Freeze 44 Math or 54 Reading and Writing questions in one row, track generated Module and pause/transition phase in `state_json`, and use `deadline_at_ms` only for the running Module. Keep calculator configuration and the Reference Sheet behind authenticated Worker routes, and measure the complete browser flow against a deterministic same-origin API fixture, with Worker request and persisted-row measurements verified in tests.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, React 19, Vite, Vitest, Testing Library, and local Chrome.

**Spec:** `docs/superpowers/specs/2026-09-27-hosted-section-exam-design.md`

## Global Constraints

- The server selects 44 Math or 54 Reading and Writing questions from one entitled revision without replacement, then assigns 22 or 27 questions to each generated Module.
- Math Modules last 35 minutes; Reading and Writing Modules last 32 minutes.
- The existing Section Exam transition has no timed break. The 10-minute break remains exclusive to Simulation.
- The server owns deadlines, pause remainder, phase, editor lease, state version, and grading.
- Active Attempt and Question Presentation responses omit accepted answers and correctness data.
- The browser countdown updates once per second from server time anchors and makes no per-second request or row write.
- Active editor lease heartbeats run every 45 seconds; the lease expires 120 seconds after its latest accepted write or heartbeat.
- Math requires an authenticated Reference Sheet and a ready calculator before the clock starts; scientific calculator fallback remains available when Desmos is unconfigured or not ready.
- Question timing checkpoints occur only at accepted state changes, 45-second heartbeats, pause, Module finish, and deadline enforcement.
- Section Exam state reuses the account-owned `learner_attempts` row and its `state_json`; no second Attempt table or per-second timing table is introduced.
- No production deployment is part of this ticket.

## Review Focus

- A revision with insufficient or duplicate identities must fail creation without a partial Attempt, while valid questions from the other Section are ignored; Task 1 tests this.
- A request racing a Module deadline must not accept an answer or reset time; Task 2 tests fake server time, stale versions, and idempotent expiry.
- An unauthenticated or cross-account request must not read the calculator configuration or Reference Sheet; Task 3 tests authorization and cache headers.
- The Loading Gate must remain stopped if any question visual or the Math Reference Sheet is missing or undecodable; Task 4 tests failed resource preparation and retry.
- Countdown display, warning refresh, visibility return, and heartbeat scheduling must not produce duplicate or per-second requests; Task 5 tests fake timers and the browser measurement records actual cadence.

---

### Task 1: Create frozen two-Module Section Exam Attempts

**Files:**
- Modify: `hosted/src/attempts.ts`
- Test: `hosted/test/attempts.test.ts`

**Interfaces:**
- `POST /api/attempts` accepts `{ revisionId, kind: "section_exam", section }` for Section Exam creation; Practice keeps its current request shape.
- Section Exam snapshots expose `kind`, `section`, frozen `questions`, and server state, with `state.phase === "module"` and generated Module membership represented in each `QuestionLink`.
- New Section Exam records continue to use the current `learner_attempts` schema and one account-owned row.

- [x] **Step 1: Add failing Worker API tests** for Math creation selecting exactly 44 unique questions split 22/22 while ignoring Reading and Writing rows in the same revision, Reading and Writing selecting exactly 54 unique questions split 27/27, unsupported Section rejection, insufficient and duplicate-identity pool rejection, revision entitlement, repeat selection on a later Attempt, and no accepted-answer fields in active payloads.
- [x] **Step 2: Run the focused tests and confirm the Section Exam request fails against the current Practice-only parser.**

  Run: `npm --prefix hosted test -- test/attempts.test.ts`

- [x] **Step 3: Implement Section Exam parsing and frozen question generation** in `hosted/src/attempts.ts`. Query the selected revision and Section, validate that the pool contains the required unique question IDs, securely shuffle server-side, take the exact count, then assign generated Module numbers 1 and 2 independent of source Module labels. Persist the Section Exam kind and initialize the phase, active Module index, locked Modules, response state, calculator state, and question timing counters.
- [x] **Step 4: Verify the focused API tests pass** and verify existing Practice creation still uses its existing validation and response shape.

  Run: `npm --prefix hosted test -- test/attempts.test.ts`

- [x] **Step 5: Commit the Section Exam creation API and tests.**

  ```powershell
  git add hosted/src/attempts.ts hosted/test/attempts.test.ts
  git commit -m "feat: create hosted section exam attempts"
  ```

### Task 2: Enforce Module deadlines, pause, transition, timing, and grading

**Files:**
- Modify: `hosted/src/attempts.ts`
- Test: `hosted/test/attempts.test.ts`

**Interfaces:**
- Section Exam lifecycle routes are `POST /api/attempts/:id/start`, `/write`, `/heartbeat`, `/finish-module`, `/continue`, `/pause`, `/resume`, and `/takeover`; completed grading is read through `/results`.
- The current running Module uses `deadline_at_ms`; preparing, paused, transition, and completed states have a null running deadline.
- Module 1 finish or expiry locks Module 1 and sets `phase: "transition"`; `/continue` starts Module 2's full Section duration. Module 2 finish or expiry completes and grades the Attempt.
- `/pause` stores server-computed remaining whole seconds and the active phase; `/resume` re-enters the Loading Gate before anchoring a new deadline from that remainder.
- Versioned writes accept response, mark, elimination, navigation, and bounded calculator-state changes only for the active Module. Per-question elapsed counters checkpoint only on accepted changes, heartbeat, pause, finish, and deadline enforcement.

- [x] **Step 1: Add failing lifecycle tests** for 35/32-minute Module deadlines, active-Module-only writes and navigation, early finish, expired Module 1 transition, expired Module 2 grading, untimed transition, explicit continuation, pause/remainder/resume, transition pause/resume, takeover without deadline reset, stale-write rejection, deadline/write races, idempotent expiry, answer secrecy, calculator-state writes, and question-time checkpoint boundaries.
- [x] **Step 2: Run the focused tests and confirm lifecycle requests fail before implementation.**

  Run: `npm --prefix hosted test -- test/attempts.test.ts`

- [x] **Step 3: Implement one idempotent server-side Module-close path** for early finish and deadline expiry. Validate deadlines before reads or mutations that can return or change an Attempt. Use expected state version and current server time in conditional D1 updates so deadline races cannot accept late responses or grant a fresh deadline. Keep Module 1's transition untimed; do not add a break state or break duration. Grade only after Module 2 closes, using `publication_answers` on the server.
- [x] **Step 4: Implement pause/resume and coarse per-question timing**. Pause computes remaining time on the server, checkpoints the active question, clears the deadline, and preserves transition state when applicable. Resume requires the Loading Gate, restores the saved remainder, and creates a new deadline from server time. Takeover changes the lease/token and state version without changing the deadline or paused remainder.
- [x] **Step 5: Verify all focused lifecycle tests pass**, including existing Practice submit, lease, and answer-hiding tests.

  Run: `npm --prefix hosted test -- test/attempts.test.ts`

- [x] **Step 6: Commit the server lifecycle and deadline tests.**

  ```powershell
  git add hosted/src/attempts.ts hosted/test/attempts.test.ts
  git commit -m "feat: enforce hosted section exam deadlines"
  ```

### Task 3: Serve Math tools through authenticated Worker routes

**Files:**
- Create: `hosted/src/mathTools.ts`
- Modify: `hosted/src/worker.ts`
- Modify: `hosted/package.json`
- Modify: `hosted/test/worker.test.ts`
- Create: `hosted/test/mathTools.test.ts`
- Create: `hosted/scripts/stage-reference-sheet.mjs`
- Source asset: `ref/reference-sheet.png`

**Interfaces:**
- `GET /api/math/calculator-config` requires a learner session and returns the configured Desmos script URL, or an explicit unconfigured result when `DESMOS_API_KEY` is absent.
- `GET /api/math/reference-sheet.png` requires a learner session and returns `hosted/dist/assets/reference-sheet.png` as private, non-cacheable PNG content; the file is not in the public static-asset allowlist.
- `GET /app/calculator-frame` serves the calculator bridge with a request-specific nonce and a frame-only CSP allowing the required Desmos script and connections. The dashboard CSP permits this same-origin sandboxed frame.
- `npm --prefix hosted run build` runs the staging web build and then stages the owner-provided Reference Sheet into `hosted/dist/assets/`.

- [x] **Step 1: Add failing Worker tests** for authenticated and unauthenticated calculator configuration, absent Desmos configuration, authenticated and unauthenticated Reference Sheet reads, `private, no-store` headers, denial through the public asset route, calculator-frame CSP isolation, and absence of the Reference Sheet route from static allowlists.
- [x] **Step 2: Run the focused Worker tests and confirm the new routes are not served.**

  Run: `npm --prefix hosted test -- test/worker.test.ts test/mathTools.test.ts`

- [x] **Step 3: Implement `mathTools.ts` and Worker dispatch** using the current account session helper and D1 `ASSETS` binding. Return only the client-visible Desmos URL, never persist the key in Attempt state, and return the Reference Sheet with `Content-Type: image/png`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.
- [x] **Step 4: Stage the existing Reference Sheet after Vite empties and produces `hosted/dist/`**. Add the hosted build script and a staging script that copies `ref/reference-sheet.png` to `hosted/dist/assets/reference-sheet.png` and fails with a direct path message if the owner asset is unavailable.
- [x] **Step 5: Serve the sandboxed Desmos bridge** at `/app/calculator-frame` with a per-response nonce and the narrow frame CSP; add `frame-src 'self'` to the dashboard policy. Keep the external Desmos API key in the Worker secret binding `DESMOS_API_KEY`.
- [x] **Step 6: Run the focused Worker tests and hosted typecheck.**

  Run: `npm --prefix hosted test -- test/worker.test.ts test/mathTools.test.ts`

  Run: `npm --prefix hosted run typecheck`

- [x] **Step 7: Commit the protected Math resources and Worker tests.**

  ```powershell
  git add hosted/src/mathTools.ts hosted/src/worker.ts hosted/package.json hosted/test/worker.test.ts hosted/test/mathTools.test.ts hosted/scripts/stage-reference-sheet.mjs
  git commit -m "feat: serve hosted math tools securely"
  ```

### Task 4: Add Section Exam setup and Math Loading Gate

**Files:**
- Modify: `web/src/account/PracticeArea.tsx`
- Modify: `web/src/account/PracticeArea.test.tsx`
- Modify: `web/src/ReferenceSheet.tsx`
- Modify: `web/src/calculator.tsx`
- Modify: `web/src/account/account.css`

**Interfaces:**
- Practice and Section Exam creation are separate builder actions; Section Exam sends only `{ revisionId, kind: "section_exam", section }` and lets the server select count, order, Modules, and timing.
- The Loading Gate fetches all selected Question Presentations, protected visuals, and for Math the Reference Sheet and calculator configuration/readiness before calling `/start`.
- With Desmos configured and ready, the Math Attempt uses the hosted Desmos panel; if no key is configured or readiness fails, the learner can select the existing scientific calculator. Reference Sheet load or decode failure keeps the clock stopped and exposes retry.
- Section Exam and Practice share the existing history list and `learner_attempts` APIs without changing Practice Builder behavior.

- [x] **Step 1: Add failing `PracticeArea.test.tsx` tests** for the Section Exam builder request, fixed Section options, no learner-controlled count or timing, unchanged Practice request payload, and start remaining blocked until Math visuals, Reference Sheet decode, and calculator choice are ready.
- [x] **Step 2: Run the focused web tests and confirm the Section Exam builder and Math readiness UI are absent.**

  Run: `npm --prefix web test -- src/account/PracticeArea.test.tsx`

- [x] **Step 3: Implement the Section Exam setup panel** and send the exact Section Exam request shape. Retain the existing Practice form, request, and history behavior.
- [x] **Step 4: Add the Math Loading Gate** to load and decode the protected Reference Sheet, fetch calculator configuration, call `loadDesmos` and `DesmosReadinessProbe` when configured, and offer `ScientificCalculator` when Desmos is absent or fails readiness. No `/start` request runs before every required resource and calculator choice is ready.
- [x] **Step 5: Run focused web tests and typecheck.**

  Run: `npm --prefix web test -- src/account/PracticeArea.test.tsx`

  Run: `npm --prefix web run typecheck`

- [x] **Step 6: Commit the hosted Section Exam builder and Loading Gate.**

  ```powershell
  git add web/src/account/PracticeArea.tsx web/src/account/PracticeArea.test.tsx web/src/ReferenceSheet.tsx web/src/calculator.tsx web/src/account/account.css
  git commit -m "feat: add hosted section exam setup gate"
  ```

### Task 5: Add Module player, transitions, warning, and 45-second heartbeat

**Files:**
- Modify: `web/src/account/PracticeArea.tsx`
- Modify: `web/src/account/HostedAttempt.tsx`
- Modify: `web/src/account/HostedAttempt.test.tsx`
- Modify: `web/src/account/account.css`

**Interfaces:**
- The shared hosted player exposes only questions in the active generated Module, Math Calculator and Reference Sheet controls, explicit `Finish Module`, and a no-break untimed transition with explicit `Continue to Module 2`.
- A paused Attempt shows the Loading Gate before `/resume`; transition pause preserves the transition and does not start Module 2.
- The countdown derives from `serverNow` and `deadlineAt` using a local monotonic anchor and refreshes each second. At five minutes remaining, the existing low-time warning appears with `role="status"`; warning and countdown updates make no server calls.
- An active editor schedules one heartbeat per 45 seconds of monotonic active-editor time. There are no recurring heartbeats in preparing, paused, transition, completed, or read-only state. Visibility return, `pageshow`, or reconnection refreshes the server snapshot without duplicating the heartbeat interval.

- [x] **Step 1: Add failing `HostedAttempt.test.tsx` tests** for Module-only navigation, accepted-answer secrecy, finish/lock/transition/continue without break, pause/resume gate, five-minute warning threshold and clearing, countdown/warning updates with zero fetches, one heartbeat at 45 seconds, no heartbeat in inactive modes, visibility refresh without duplicate cadence, deadline expiry refresh, and Math tool controls.
- [x] **Step 2: Run the focused Player tests and confirm the Section Exam states and clock behaviors fail before implementation.**

  Run: `npm --prefix web test -- src/account/HostedAttempt.test.tsx`

- [x] **Step 3: Implement Section Exam player modes** using the phase and Module index from server state. Keep responses and accepted answers separated; show only the active Module's questions; make finish and transition actions versioned server mutations; show no timed break.
- [x] **Step 4: Implement pause/resume Loading Gate integration and Math controls**. Save Desmos state using the versioned Attempt write path. Scientific calculator remains usable when selected. Reference Sheet opens as the existing zoomable overlay.
- [x] **Step 5: Implement monotonic countdown, warning, heartbeat, and reconnect refresh**. Use one independent one-second display interval and one 45-second active-editor heartbeat interval. Refresh on `visibilitychange`, `pageshow`, and online reconnection, and replace intervals from the refreshed server state without duplicate timers.
- [x] **Step 6: Run focused Player tests and web typecheck.**

  Run: `npm --prefix web test -- src/account/HostedAttempt.test.tsx`

  Run: `npm --prefix web run typecheck`

- [x] **Step 7: Commit the hosted Section Exam player and clock tests.**

  ```powershell
  git add web/src/account/PracticeArea.tsx web/src/account/HostedAttempt.tsx web/src/account/HostedAttempt.test.tsx web/src/account/account.css
  git commit -m "feat: run hosted section exam modules"
  ```

### Task 6: Measure requests and complete the browser journey

**Files:**
- Modify: `hosted/test/attempts.test.ts`
- Modify: `hosted/test/worker.test.ts`
- Create: `hosted/test/section-exam-browser.test.ts`
- Create: `hosted/evidence/section-exam-browser-journey.md`

**Interfaces:**
- The Chrome API fixture records each browser HTTP request and its simulated Attempt mutations; the Worker test fixture independently measures request count and changed Attempt rows.
- A manual local Chrome journey starts the hosted UI against a deterministic same-origin API fixture and reviewed 44-question Math / 54-question Reading and Writing data; Worker tests separately exercise the authoritative server API and row mutations.
- Two independent browser contexts represent the learner's original and takeover devices. Evidence records complete Math and Reading and Writing journey totals, client cadence checks, local countdown/warning behavior, and the Worker fixture row mutations. Browser fixture limitations are stated in the evidence.

- [x] **Step 1: Add failing fixture counter tests** for total API requests, summed D1 row reads/writes, per-route counts, and zero D1 writes during one-second countdown and warning refreshes.
- [x] **Step 2: Run the focused Worker tests and confirm attempt-route request/write totals are not yet captured.**

  Run: `npm --prefix hosted test -- test/attempts.test.ts test/worker.test.ts`

- [x] **Step 3: Extend the fixture counters** so every local Worker request and every D1 statement's reported read/write metadata is attributed to the journey; include protected presentation, visual, calculator config, Reference Sheet, Attempt, Results, and history requests.
- [x] **Step 4: Add the real-browser journey**. In Math and Reading and Writing, create and start an Attempt, answer and navigate in both Modules, finish Module 1, verify the untimed transition, continue, finish Module 2, and verify server grading and history. In a second context, verify read-only access, take over explicitly, reject the stale editor, and assert the Module deadline did not change. Exercise Math Reference Sheet and calculator availability. Use browser fake time for a 45-second heartbeat interval while keeping Worker server time deterministic.
- [x] **Step 5: Record measured requests and row writes** in `hosted/evidence/section-exam-browser-journey.md`, including the exact journey conditions, active time, per-heartbeat timestamps, inactive-state counts, and the one-second local display measurement. Include totals for one complete Math and one complete Reading and Writing journey.
- [x] **Step 6: Run the manual browser journey and focused Worker tests; verify the evidence contains observed totals and explicitly distinguishes browser fixture observations from Worker measurements.**

  Run: `npm --prefix hosted test -- test/attempts.test.ts test/worker.test.ts`

- [x] **Step 7: Commit the measurement harness and browser evidence.**

  ```powershell
  git add hosted/test/attempts.test.ts hosted/test/worker.test.ts hosted/test/section-exam-browser.test.ts hosted/evidence/section-exam-browser-journey.md
  git commit -m "test: measure hosted section exam journey"
  ```

### Task 7: Full verification and inline review

**Files:**
- Modify: `D:/Notion/UI/.scratch/whitebook-account-learning-update/issues/06-hosted-section-exam.md`

- [x] **Step 1: Run the complete hosted and web test suites.**

  Run: `npm --prefix hosted test`

  Run: `npm --prefix web test`

- [x] **Step 2: Run both typechecks and production builds.**

  Run: `npm --prefix hosted run typecheck`

  Run: `npm --prefix web run typecheck`

  Run: `npm --prefix hosted run build`

- [x] **Step 3: Re-read the ticket and design spec** and check each acceptance criterion against the implementation and measured browser evidence. Mark a criterion complete only when its tests or journey directly verify it; set the local ticket status to `ready-for-human` after every criterion is evidenced.
- [x] **Step 4: Review the complete branch diff inline** for scope, security, interface consistency, answer leakage, deadline races, inactive heartbeat behavior, and any regression to hosted Practice. The repository `AGENTS.md` permits subagents only when the user explicitly requests them, so perform this review in-session.
- [x] **Step 5: Run `git diff --check`, verify every commit on this feature branch and the final worktree status, then commit any final verification or ticket-status changes.**

  ```powershell
  git diff --check
  git status --short --branch
  git log --oneline main..HEAD
  ```
