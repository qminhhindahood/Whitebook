# Remaining browser acceptance

Use a separate test data directory so these checks do not modify your real question bank:

```powershell
uv run python scripts/create-smoke-fixtures.py
.\start.ps1 -DataDir .scratch\runtime-review
```

Fixtures are original synthetic content under `.scratch/runtime-review/input/`. Copy your Reference Sheet into this test directory's `assets/` folder to test Math. The root `.env` supplies Desmos configuration for either data directory.

- [ ] In Chrome and Edge at a laptop viewport, Import `synthetic-practice.pdf` with `synthetic-answers.csv`.
- [ ] Map one region on each of the four pages to the matching Section/Module. Inspect suggested boundaries before confirming them; no suggestion is automatically confirmed.
- [ ] Resize a region, add and reorder another, and inspect the ordered preview. Reopen Import to verify saved progress.
- [ ] Publish. Confirm the four-question package is Practice-only, not eligible for full Simulation.
- [ ] Select Both Sections and both Modules, set exact counts, and prepare a Practice Attempt.
- [ ] Before Begin, verify every region renders and Math tools/reference loading completes. Verify a missing Reference Sheet blocks Begin.
- [ ] Test Desmos failure, Retry and explicit scientific fallback. Scientific functions include roots, powers, logs and trigonometry with degree/radian selection.
- [ ] Answer rapidly, navigate across Modules, eliminate a choice, mark for review, resize the divider and zoom question content.
- [ ] Save & Pause, reload and resume. Confirm responses, current question, timing and calculator work survive.
- [ ] Cancel a browser-close warning and confirm the Attempt remains usable. Then actually close/reopen and check recovery.
- [ ] Submit with at least one wrong and one unanswered response. Verify both lower Raw Accuracy and review filters match.
- [ ] Open Results breakdowns. Section/Module times should sum to the recorded question times.
- [ ] Practice Mistakes opens the Practice Builder using only missed questions from that source. Retake leaves the original result unchanged.
- [ ] Archive/restore the package. Verify Results remain available. Test deletion only on this synthetic package.
- [ ] Export a backup, change only test data, restore with confirmation, and verify the Reference Sheet and Attempts return.

Full Simulation's four timed Modules, break and locking have deterministic engine tests. Complete their visible-player acceptance with a full 98-question test fixture before closing ticket 15.

The current browser upload connector rejects this workspace path. That tooling limitation is not evidence that application import fails, and it is not a completed browser acceptance check.

## Attempt clock (server-enforced, 2026-09)

The player no longer sends a per-second tick. The countdown renders locally
from server-provided remaining seconds; the server stores absolute deadlines
and enforces expiration on every relevant read and mutation. A single sync
request fires when the local countdown reaches zero. Accepted evidence for
ticket 01 of `whitebook-account-learning-update`:

- Real-browser network trace (Chrome-family client, 3-minute Practice
  countdown, no interaction): 1 POST `begin`, 0 API requests during 75 s of
  idle countdown, 1 GET of the Attempt when the countdown reached zero, and
  the server-graded Results screen afterwards (elapsed capped at exactly the
  module duration).
- Engine write budget (`tests/test_attempt_clock.py`): 120 one-second idle
  reads produce zero database writes; durable writes occur only on learner
  actions and clock transitions.
- Break regression checks: idle break display makes zero API requests and does
  not increase module elapsed time. A read after a sleeping tab crosses both
  the module and break deadlines moves straight to the next transition; old
  tick-based break state also retains its original expiry.
