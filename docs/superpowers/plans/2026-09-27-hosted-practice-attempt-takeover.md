# Hosted Practice Attempt and Takeover Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** A signed-in learner can create, save, resume, submit, and review a Practice Attempt from one authorized Test Package, and explicitly transfer editing to another device without losing or overwriting work.

**Architecture:** Add account-owned Attempt records and an optimistic, server-enforced editor lease to the existing Cloudflare Worker and D1 API. The learner UI builds an Attempt from one library revision, preloads every selected Question Presentation and visual before starting its server clock, then uses versioned saves, explicit takeover, and server-side grading. Published presentations and answer keys stay separate and server-owned.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, React 19, Vite, Vitest, Testing Library.

**Spec:** D:/Notion/UI/.scratch/whitebook-account-learning-update/spec.md and D:/Notion/UI/.scratch/whitebook-account-learning-update/issues/05-hosted-practice-and-takeover.md

## Global Constraints

- Each Practice Attempt references exactly one immutable published Test Package revision and is owned by one Learner Account.
- Every Attempt read and mutation checks account ownership on the server.
- Active Attempt, setup, and Loading Gate responses never contain accepted answers; grading uses publication_answers on the server and reveals answers only after completion.
- The browser receives Question Presentations and manifest-listed visuals, never a Source PDF, source path, or answer manifest.
- The server is authoritative for start time, deadline, expiry, lease owner, and state version; a client countdown uses server time anchors and makes no per-second request.
- One editor lease renews on each accepted write or a 45-second heartbeat and expires 120 seconds after its most recent accepted write or heartbeat.
- Expired and stale editors cannot write silently; another device must take over explicitly and refresh state.
- Keep online-only behavior and do not add a paid service or dependency.
- Published Question Category metadata is absent from publication_questions. This ticket's Builder filters by Section and Module and offers count, ordering, and timing; it does not show a Question Category selector that cannot be enforced by the hosted API.

## Review Focus

- A learner guesses another account's Attempt ID: every route returns the same unavailable response and exposes no Attempt fields.
- Two devices race on takeover or save: only a current editor token with the current state version can mutate state.
- A backgrounded or disconnected editor returns after the 120-second expiry: it remains read-only until explicit reacquisition or takeover.
- A selected visual fails during the Loading Gate: the Attempt clock remains unstarted and the learner gets a retryable error.
- Active state and errors leak an accepted answer or completed review mutates original responses: only submit can grade, and completed Attempt state becomes immutable.

---

### Task 1: D1 Attempt model and account-scoped lifecycle API

**Files:**
- Create: hosted/migrations/0006_practice_attempts.sql
- Create: hosted/src/attempts.ts
- Modify: hosted/src/worker.ts
- Modify: hosted/src/library.ts
- Test: hosted/test/attempts.test.ts
- Test: hosted/test/worker.test.ts

**Interfaces:**
- POST /api/attempts accepts revisionId, section, modules, count, ordering, and timing settings; it validates entitlement and creates a preparing Practice Attempt with a server-selected, unique question order from that revision.
- GET /api/attempts lists only the signed-in account's records; GET /api/attempts/:id returns that account's state, selected Question Presentation IDs and metadata, lease status, stateVersion, and server time without answer data.
- POST /api/attempts/:id/start changes a preparing Attempt to active, creates the first editor lease, sets startedAt and any deadline from the server clock, and returns the plaintext editor token once.
- Persist owner, revision, immutable question order, status, timer fields, state JSON, stateVersion, hashed lease token, and lease expiry. Use the next migration number, 0006.
- Use currentSession and requireMutation from accounts.ts; follow failure, json, noStore, and Worker route patterns.

- [x] **Step 1: Write failing ownership and creation tests**
  - Test unauthenticated create returns 401.
  - Test a signed-in account cannot create from an unentitled revision.
  - Test an entitled create stores one revision, a unique order, and no accepted answers in its response.
  - Test account B cannot read account A's Attempt by ID.

    const created = await postAttempt(learnerA, { revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1], count: 2, ordering: "source", timing: { mode: "elapsed" } });
    expect(created.status).toBe(201);
    expect(await created.text()).not.toMatch(/acceptedAnswers|answerKey|sourcePdf/);
    expect((await getAttempt(learnerB, attemptId)).status).toBe(404);

- [x] **Step 2: Run the focused test and confirm it fails for the missing route/model**

    cd hosted
    npm test -- test/attempts.test.ts

- [x] **Step 3: Add migration, ownership checks, revision entitlement validation, and preparing/start lifecycle**
  - Select question IDs and display metadata only from publication_questions for the authorized revision.
  - Reject zero, out-of-range, duplicate, or cross-revision selection inputs with structured 400 responses.
  - Start time and deadline are written only by start after the Loading Gate succeeds.

- [x] **Step 4: Re-run the focused test and verify creation, start, resume data, and ownership behavior**

    cd hosted
    npm test -- test/attempts.test.ts

- [x] **Step 5: Commit the independently reviewable lifecycle API**

    git add hosted/migrations/0006_practice_attempts.sql hosted/src/attempts.ts hosted/src/worker.ts hosted/test/attempts.test.ts hosted/test/worker.test.ts
    git commit -m "feat: add hosted practice attempt lifecycle"

### Task 2: Versioned saves, editor lease, takeover, and server grading

**Files:**
- Modify: hosted/src/attempts.ts
- Modify: hosted/migrations/0006_practice_attempts.sql
- Test: hosted/test/attempts.test.ts

**Interfaces:**
- POST /api/attempts/:id/write accepts editorToken, expected stateVersion, and one validated response, mark, elimination, or navigation change.
- POST /api/attempts/:id/heartbeat accepts editorToken and expected stateVersion; an accepted heartbeat renews lease expiry to serverNow + 120 seconds.
- POST /api/attempts/:id/takeover explicitly replaces the lease token and returns freshly read state and a new token; the stale token is immediately invalid.
- POST /api/attempts/:id/submit validates the live lease, enforces deadline, grades against publication_answers, and atomically marks the Attempt completed.
- GET /api/attempts/:id/results returns answers and correctness only after completion. Completed responses and timing history are immutable.

- [ ] **Step 1: Write failing lease, conflict, and grading tests**
  - Use an injected server clock.
  - Test a write renews the lease and a heartbeat at 45 seconds extends expiry by 120 seconds.
  - Test a write after expiry fails until explicit takeover or reacquisition.
  - Test takeover returns the latest saved response and rejects the prior token.
  - Race two writes with the same stateVersion and assert exactly one succeeds and stored state matches that winner.
  - Test stale stateVersion returns 409 without changing response, mark, elimination, or navigation.
  - Test answer data is absent before submit, Results contain server-graded correctness after submit, and post-submit writes fail.

    vi.setSystemTime(1_800_000_000_000);
    const first = await write(attempt, editorA, 0, { questionId: "q1", response: "B" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ stateVersion: 1, saveStatus: "saved" });
    const stale = await write(attempt, editorB, 0, { questionId: "q1", response: "A" });
    expect(stale.status).toBe(409);
    await expect((await getAttempt(learnerA, attemptId)).json()).resolves.toMatchObject({ responses: { q1: "B" } });

- [ ] **Step 2: Run the focused test and confirm the missing server behavior**

    cd hosted
    npm test -- test/attempts.test.ts

- [ ] **Step 3: Implement atomic version checks and lease renewal**
  - Hash editor tokens at rest.
  - Require matching account, active status, non-expired lease, token, and expected stateVersion for every write.
  - Each accepted mutation increments stateVersion and sets lease expiry from injected server time.
  - Permit takeover only through its explicit endpoint; expired writes do not reacquire automatically.
  - Keep timer fields independent from lease changes.

- [ ] **Step 4: Implement server-only grading and completed Results**
  - Load publication_answers only in submit/results server code.
  - Return no answer fields from list, create, start, active read, write, heartbeat, or takeover.
  - Preserve original response and completion timestamp; reject all later edits.

- [ ] **Step 5: Re-run lease and grading tests and commit**

    cd hosted
    npm test -- test/attempts.test.ts
    cd ..
    git add hosted/src/attempts.ts hosted/migrations/0006_practice_attempts.sql hosted/test/attempts.test.ts
    git commit -m "feat: enforce hosted attempt editor leases"

### Task 3: Practice Builder and Loading Gate in the hosted learner UI

**Files:**
- Create: web/src/account/PracticeArea.tsx
- Create: web/src/account/PracticeArea.test.tsx
- Create: web/src/account/practice.css
- Modify: web/src/account/AccountApp.tsx
- Modify: web/src/account/CuratedLibrary.tsx

**Interfaces:**
- The Library's selected package opens a Builder scoped to that exact revision; the Builder cannot combine revisions.
- The Builder selects Section, Modules, question count, source/random ordering, and elapsed/custom/SAT-paced timing from the selected revision's question metadata.
- The Loading Gate creates a preparing Attempt, loads every selected Question Presentation, extracts all image_asset and asset visual paths, fetches every visual, then calls start. A failure leaves the timer unstarted and exposes retry.
- After start, the selected Attempt opens in the hosted Player; the active deadline comes from the server.

- [ ] **Step 1: Write failing rendered tests for one-package setup and Loading Gate**
  - Verify only the chosen revision is sent to POST /api/attempts.
  - Verify start is not called until every presentation and visual fetch succeeds.
  - Verify a failed visual prevents start and shows a retryable Loading Gate error.
  - Verify the UI does not offer an unavailable Question Category filter.

    expect(createAttempt).toHaveBeenCalledWith(expect.objectContaining({ revisionId: "reviewed-math" }));
    expect(startAttempt).not.toHaveBeenCalled();
    rejectVisual();
    expect(await screen.findByRole("alert")).toHaveTextContent(/visual/i);
    expect(startAttempt).not.toHaveBeenCalled();

- [ ] **Step 2: Run the focused web test and confirm it fails before the Builder exists**

    cd web
    npm test -- src/account/PracticeArea.test.tsx

- [ ] **Step 3: Add the Builder, preparation loader, and AccountApp/Library entry points**
  - Derive Sections and Modules from the selected revision's question metadata.
  - Validate count against the selected pool before calling the API.
  - Preload question JSON and all referenced visuals with same-origin credentials and cache: no-store.
  - Keep attempt creation in preparing status until selected content is ready; start only after that boundary.

- [ ] **Step 4: Re-run the focused web test and commit the Builder/Loading Gate**

    cd web
    npm test -- src/account/PracticeArea.test.tsx
    cd ..
    git add web/src/account/PracticeArea.tsx web/src/account/PracticeArea.test.tsx web/src/account/practice.css web/src/account/AccountApp.tsx web/src/account/CuratedLibrary.tsx
    git commit -m "feat: add hosted practice builder and loading gate"

### Task 4: Hosted Player, truthful saves, resume, and explicit takeover

**Files:**
- Create: web/src/account/HostedAttempt.tsx
- Create: web/src/account/HostedAttempt.test.tsx
- Modify: web/src/account/PracticeArea.tsx
- Modify: web/src/account/practice.css

**Interfaces:**
- The Player consumes server state and versioned write APIs; answer, mark, elimination, and navigation actions update optimistically with visible pending, saved, or failed status.
- Submit transitions to Results rendered from the completed server result; later review reads never mutate the Attempt's original response state.
- A refresh loads the Attempt from the server. A second editor with an active lease is read-only and can explicitly take over.
- The active editor sends a heartbeat every 45 seconds. Any accepted write renews the lease. On 409, 401, offline failure, expiry, or stale token, editing stops until fresh state and a valid token are obtained through explicit action.
- A local countdown may update each second from serverNow and deadlineAt but sends no per-second request.

- [ ] **Step 1: Write failing Player tests for saves, read-only state, takeover refresh, and timer continuity**
  - A response action shows pending and then saved only after server acknowledgement.
  - Parameterized response, mark, elimination, and navigation actions each show pending, then saved after server acknowledgement.
  - A failed request shows failed and preserves the response visibly without claiming it saved.
  - A second device can navigate and read but cannot submit writes before takeover.
  - Explicit takeover shows the newest server response and makes the prior token fail.
  - deadlineAt is identical before and after takeover.
  - Submit shows server-graded Results; reopening completed Results leaves the original response unchanged.

    expect(screen.getByRole("status")).toHaveTextContent(/pending/i);
    await saveResponse.resolve(savedState);
    expect(screen.getByRole("status")).toHaveTextContent(/saved/i);
    expect(takeoverState.deadlineAt).toBe(before.deadlineAt);

- [ ] **Step 2: Run the focused test and confirm it fails against the preview-only Library**

    cd web
    npm test -- src/account/HostedAttempt.test.tsx

- [ ] **Step 3: Implement the Player controls and explicit editor transfer**
  - Reuse HostedBlocks and HostedChoices for the existing presentation and response contracts.
  - Store the editor token in tab-scoped sessionStorage so refresh in the same tab can resume; never put answer keys or Attempt state in localStorage.
  - Serialize local saves so multiple edits do not send the same stateVersion concurrently.
  - Show explicit Take over editing or Reacquire editing action when the lease is unavailable or expired.
  - Keep the displayed timer anchored to serverNow/deadlineAt and never reset it on heartbeat or takeover.

- [ ] **Step 4: Re-run Player tests and commit the hosted Player**

    cd web
    npm test -- src/account/HostedAttempt.test.tsx
    cd ..
    git add web/src/account/HostedAttempt.tsx web/src/account/HostedAttempt.test.tsx web/src/account/PracticeArea.tsx web/src/account/practice.css
    git commit -m "feat: sync hosted practice attempts across devices"

### Task 5: Two-learner/two-device journey and final verification

**Files:**
- Modify: hosted/test/attempts.test.ts
- Modify: hosted/test/worker.test.ts
- Modify: hosted/README.md

- [ ] **Step 1: Add a Worker journey with two Learner Accounts and two editor tokens**
  - Account A creates, starts, answers, marks, navigates, and resumes an Attempt.
  - Account B receives no private history and cannot read, mutate, or submit A's Attempt.
  - Device A saves a response; Device B sees read-only state, explicitly takes over, and receives that saved response.
  - A stale write from Device A receives 409; Device B continues without resetting deadlineAt.
  - Submit returns server-graded Results; a later read proves original responses and Result history are unchanged.

- [ ] **Step 2: Run focused hosted and web checks**

    cd hosted
    npm test -- test/attempts.test.ts test/worker.test.ts
    npm run typecheck
    cd ..
    npm --prefix web test -- src/account/PracticeArea.test.tsx src/account/HostedAttempt.test.tsx
    npm --prefix web run typecheck
    npm --prefix web run build

- [ ] **Step 3: Run the hosted Worker suite and web suite requested by the ticket**
  - Record any pre-existing failure by its test name and output.
  - Do not claim a suite or build passed without fresh command output.

    cd hosted
    npm test
    cd ..
    npm --prefix web test

- [ ] **Step 4: Review the full branch diff and commit verification evidence**

    git diff --check
    git status --short
    git log --oneline origin/main..HEAD
    git add hosted/test/attempts.test.ts hosted/test/worker.test.ts hosted/README.md
    git commit -m "test: verify hosted practice ownership and takeover"
