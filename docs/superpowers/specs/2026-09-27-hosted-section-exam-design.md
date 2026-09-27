# Hosted Section Exam Attempt Design

**Date:** 2026-09-27
**Ticket:** `.scratch/whitebook-account-learning-update/issues/06-hosted-section-exam.md`
**Related decisions:** `.scratch/whitebook-account-learning-update/spec.md`; tickets 01 and 05

## Goal

Allow an authenticated learner to complete a hosted Section Exam Attempt from one entitled Test Package. The server owns question selection, Module deadlines, transitions, pause and resume state, editor ownership, and grading. The browser displays a smooth local countdown without a per-second request or row write.

## Existing behavior and constraints

- The local Section Exam selects 44 Math questions or 54 Reading and Writing questions from one eligible package, without repeats. It divides the shuffled selection evenly into two generated Modules. Later Attempts may reuse questions.
- A Math Module lasts 35 minutes. A Reading and Writing Module lasts 32 minutes. Module 1 locks when finished or when its deadline expires. The learner explicitly continues through a transition before Module 2's timer starts. Module 2 locks on finish or expiry, then the server grades the full Attempt.
- The existing Section Exam flow has no timed break. Its transition must remain untimed. The 10-minute break belongs to the four-Module Simulation flow.
- Math readiness includes a working calculator and the owner-provided Reference Sheet. The local Loading Gate confirms these resources before timing begins. Desmos is used when configured and ready; the local scientific calculator is the fallback.
- The existing local flow supports pause and resume. Pausing preserves remaining Module time; resuming passes the Loading Gate before the server anchors a new deadline.
- Hosted Practice already uses the account-owned `learner_attempts` row, server-generated `serverNow` and `deadlineAt`, versioned writes, a 45-second editor heartbeat, a 120-second lease, explicit takeover, and server-side grading.
- Active hosted Attempt payloads and Question Presentation routes do not expose accepted answers. Results are returned only after server completion.

## Architecture

Extend the existing hosted Attempt API and player. Keep one `learner_attempts` row for each Section Exam Attempt and reuse the existing account ownership, CSRF protections, state version, editor token, lease, answer source, and immutable package revision. Use `kind: "section_exam"` to distinguish the mode. No second Attempt table or separate grading implementation is needed.

Keep the database's overall Attempt status as `preparing`, `active`, or `completed`. Store the in-progress phase in `state_json` and include it explicitly in snapshots and summaries. Section Exam phase values are `module`, `transition`, and `paused`; the active Module view also has a `warning` mode when five minutes or less remain. Warning is a presentation mode derived from the authoritative deadline, not a persisted phase. Store the active Module index, locked Module indexes, current question, responses, review marks, eliminated choices, remaining seconds while paused, paused phase, and coarse elapsed-time counters in that state. The existing `deadline_at_ms` is the authoritative deadline for the currently running Module and is null while the Attempt is preparing, in transition, or paused.

The Section Exam creation request supplies one entitled `revisionId`, `kind: "section_exam"`, and a supported `section`. The server validates eligibility and available question count, selects 44 Math or 54 Reading and Writing questions from that revision without replacement, shuffles them, and assigns 22 or 27 questions to each generated Module. The server records the generated Module membership in the frozen Attempt plan, independent of source Module labels. Later Attempts can select those questions again.

The Loading Gate loads every selected Question Presentation and required visual before starting the Attempt clock. For Math, it also loads and decodes the owner-provided Reference Sheet through an authenticated route and confirms that a calculator is ready. The hosted Worker reads an optional `DESMOS_API_KEY` secret. When configured, it supplies the Desmos script URL to the authenticated Loading Gate, which checks the sandboxed same-origin calculator frame. If the secret is absent or the readiness check fails, offer the existing scientific calculator fallback. If the Reference Sheet cannot load or neither calculator is ready, timing remains stopped and the learner can retry.

The hosted release build stages the existing owner-provided `ref/reference-sheet.png` as `hosted/dist/assets/reference-sheet.png`, separate from question-specific visuals and raw Source PDFs. The Worker serves it through `GET /api/math/reference-sheet.png` only after learner-session authorization; the static PNG is not added to the public asset allowlist. The route returns private, non-cacheable content. A configured Desmos key remains Worker runtime configuration and is never stored in Attempt state. The sandboxed calculator frame applies a separate Content Security Policy that permits the Desmos resources it needs. Calculator state is saved through the existing versioned Attempt write path when the selected calculator supports saved state.

The initial start anchors Module 1's deadline to server time. A finish or expiry checkpoints timing and locks the current Module. Closing Module 1 sets phase to `transition` and clears the running deadline. Continuing from the transition starts Module 2 with its own full Section deadline. Closing or expiring Module 2 completes the Attempt and stores server grading for all selected questions. The active state and separate question routes continue to omit accepted answers; the Results route is available only after completion.

## Clock, pause, and takeover behavior

The client renders the countdown from the latest `serverNow` and `deadlineAt` using a local monotonic clock, refreshing the display once per second without network traffic. At five minutes remaining, the player shows the existing low-time warning treatment with `role="status"`; it clears on Module transition, pause, or completion. The warning is computed from the local countdown anchored to server time and makes no request or row write. On page visibility return, `pageshow`, or reconnection, the client fetches the Attempt snapshot. The server applies any expired Module deadline before returning the snapshot. Writes, heartbeats, takeover, pause, continue, resume, finish, and Results reads also validate the current server deadline before accepting or returning state.

While an editor owns an active, running Attempt, the client sends one lease heartbeat every 45 seconds, measured from editor activation using a monotonic timer. This heartbeat cadence is independent of the one-second display refresh and may checkpoint coarse question timing. No recurring lease heartbeat is sent while preparing, paused, in transition, completed, or read-only. Visibility return or reconnection performs an immediate snapshot refresh; it does not restart or duplicate the 45-second interval, and normal heartbeat scheduling resumes from the refreshed active state.

The server checkpoints elapsed time for the current question at accepted state changes, the existing 45-second lease heartbeat, pause, Module finish, and deadline enforcement. A checkpoint assigns elapsed time only to the question active during that interval and caps it at the Module deadline. Ordinary display ticks do not update the Attempt row. These checkpoints retain useful per-question timing without a separate timing request loop.

Pausing stores the server-computed remaining time and phase, clears the active deadline, and keeps responses unchanged. Resuming requires the Loading Gate and creates a new server deadline from the saved remainder. Pausing during the untimed transition preserves the transition and does not start Module 2. Explicit takeover returns the latest state, increments the version, replaces the editor token, and does not change the active deadline or paused remainder. Stale editor writes continue to receive a conflict response.

If a tab sleeps through a deadline, a subsequent read or mutation closes the expired Module exactly once. Expired Module 1 enters the transition; expired Module 2 completes and grades. If expiry races with a response or finish request, the deadline wins and no response is accepted after expiry. A timed-out Attempt never receives a fresh Module deadline from refresh or takeover.

## Learner interface

Add Section Exam creation to the hosted Practice area for eligible curated packages. The builder chooses the package and its supported Section; question count, random order, Module sizes, and standard timing are fixed by the server. Existing Practice Builder behavior remains intact.

The shared Attempt player shows only the active Module's questions and navigation. Math Modules include the Calculator control and zoomable Reference Sheet overlay. The calculator uses configured Desmos when ready and exposes the scientific fallback when Desmos is unavailable. The transition view reports that the previous Module is locked and offers an explicit continue action. A paused Attempt resumes through the Loading Gate. The Attempt list identifies Section Exam Attempts and lets the learner resume an unfinished Attempt or review completed Results. The player surfaces pending, saved, conflict, read-only, takeover, and connection states. Active snapshots never contain accepted answers or correctness data.

## Requests and row-write measurement

Add deterministic counters to the Worker test fixture for HTTP requests and D1 rows read and written. Measure one complete Math and one complete Reading and Writing journey, including Loading Gate presentation and visual requests, the protected Math Reference Sheet request, calculator readiness, answer and navigation writes, editor heartbeats at their 45-second cadence, both Module transitions, completion, Results, and history refresh. Record heartbeat timestamps/request counts separately so the evidence demonstrates one heartbeat per 45 seconds of active editor time, with no heartbeat in paused, transition, or read-only states. Also record that the five-minute warning is derived locally. The local browser fixture mints isolated learner sessions for its two browser contexts; it does not use live Google OAuth. Record the observed totals and the journey conditions in `hosted/evidence/section-exam-browser-journey.md`. The measurement must demonstrate that one-second countdown and warning display updates cause zero server requests and zero D1 row writes.

## Verification

- Hosted API tests cover both sections' exact generated question and Module counts, no repeats within one Attempt, fixed per-Module durations, package entitlement, Loading Gate behavior, and absence of accepted answers before completion.
- Hosted API tests cover early finish, timeout, module locking, transition, continuation, pause/resume, and final grading. Fake server time verifies sleeping-tab reads, stale writes at the deadline, and that takeover never resets time.
- Math Loading Gate and browser tests cover authenticated Reference Sheet loading, missing or invalid sheet handling, absent Desmos configuration, Desmos readiness failure, scientific fallback, and no timer start while required resources are unavailable.
- Hosted API tests cover account ownership, editor version conflicts, read-only access, explicit takeover, stale token rejection, and unchanged Attempt history.
- Web tests cover the smooth local clock, Module-only navigation, transition, paused resume, completion Results, history labels, and editor takeover refresh.
- Web tests cover the five-minute warning threshold, its removal outside a running Module, and that countdown/warning refreshes do not invoke server actions. Browser measurement covers the explicit 45-second heartbeat cadence and its inactive-state behavior.
- A local real-browser journey uses a deterministic Worker and package fixture with two independent browser contexts. It completes both Modules for Math and Reading and Writing, checks grading and history, and verifies read-only and takeover states. The journey captures request and D1 row-write totals.
- Run the hosted and web test suites, type checks, production builds, and the browser journey after implementation. No production deployment is part of this ticket.

## Out of scope

- The existing Section Exam gains no timed break; the Simulation break remains exclusive to Simulation.
- No four-Module Simulation is added to the hosted learner site.
- No per-second server tick, separate timing table, accepted-answer endpoint during active play, live AI feature, production deployment, or paid hosting change is added.
