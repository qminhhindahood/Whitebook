# Ticket 03 — staging Attempt reliability

**Result for this ticket:** The signed-in synthetic Attempt rehearsal on the design-kit staging deployment completed 24 of 24 created Section Exams with no HTTP 5xx, Worker invocation errors, or client transport failures. This is evidence for the Attempt reliability ticket, not an overall hosted-launch GO decision.

## Earlier NO-GO and cause isolation

The prior ticket 16 staging NO-GO record reported 2,160 generic 503 responses in 4,618 requests, only 3 completions among 23 created Section Exams, and no Worker CPU percentiles. The old run did not capture enough server detail to assign each 503 to one code path.

On the then-current staging deployment, a fresh single-learner probe found protected visuals unavailable. A comparable 24-learner replay found 4,436 failed visual requests out of 4,436 and no completions. The release build had omitted the private publication visuals. A separate clone with those visuals staged still failed under the original unbounded request fan-out: 4,122 failed visual requests out of 4,444 and no completions. Stage diagnostics also observed transient session and entitlement lookup failures during that burst. In the player, `Promise.all` loaded every question presentation and then every visual at once; it also checked visual response headers without consuming the bodies. These observations isolate two failure paths behind the service storm: a missing deploy asset set and excessive concurrent content reads. They do not prove the exact split of causes in the historical 2,160 responses.

The build now requires the approved `reviewed-five-20260927` private bundle, verifies all 2,272 PNGs against the manifest before and after staging, and fails without the private bundle. The player loads presentations and visuals one at a time, consumes each visual body before opening the timer, and retries transient content failures up to three attempts. Focused tests cover the asset gate, concurrency bound, response consumption, retries, and failure cleanup. The rehearsal uses the same loading bound and waits for in-flight work before cleaning up synthetic accounts.

## Design-kit staging deployment and comparable run

The custom-domain staging Worker `whitebook-ticket-03-staging` was built and deployed from `D:\Notion\worktrees\whitebook-hosted-redesign`, whose player imports the assets copied from `D:\Notion\Whitebook-Design-Kit\dist`. The four font files, paper texture, illustration, and font license matched the design-kit source hashes. The staged build contained 2,272 approved protected visuals totaling 260,980,875 bytes and no PDF. The deployed version was `a6203666-09cd-4334-858f-ed07bbe77a7f`; the target was `https://whitebook.docai.dpdns.org`. An anonymous protected-content request returned 401.

The [single-learner probe](ticket-03-design-kit-single.json) completed one Math Section Exam. The [concurrent run](ticket-03-design-kit-concurrent.json) ran from 2026-09-28 01:58:26 to 02:02:17 UTC with 24 isolated signed-in synthetic learners:

| Measure | Observed |
| --- | ---: |
| Created/completed Section Exams | 24/24 (12 Math, 12 Reading and Writing) |
| Question presentations | 1,176/1,176 loaded |
| Protected visual reads | 4,432/4,432 succeeded |
| Script requests | 7,048 |
| HTTP outcomes | 7,000 × 200; 24 × 201; 24 × expected stale-editor 409 |
| HTTP 5xx / client transport or body failures | 0 / 0 |
| Client wall time p95 / p99 | 541.45 / 823.36 ms |
| Worker CPU p95 / p99 | 2.822 / 6.58 ms |
| Worker invocation errors | 0 of 7,085 invocations in the interval |
| D1 Insights rows read / written delta | 23,310 / 738 |
| D1 database bytes before / peak | 3,891,200 / 4,349,952 |

All 24 server-clock and editor-takeover checks passed. Learner-visible reads and error responses contained no accepted answers or credentials. All 24 synthetic accounts were deleted; a separate D1 query found zero accounts and sessions with this run's provider prefix, and database size returned to 3,891,200 bytes.

CPU percentiles and invocation counts come from [Cloudflare's Worker analytics query](ticket-03-design-kit-cpu.json) over the run interval. They include any other requests to that Worker in the interval, which explains why the invocation count can differ from the rehearsal script's request count. D1 Insights is a delayed rolling 24-hour SQL-fingerprint aggregate; its before/after delta is indicative usage, not an exact per-run bill. Synthetic signed-in sessions exercise the hosted account/Attempt contracts but do not prove the Google sign-in browser flow.

## Remaining release boundary

Ticket 03's concurrent Attempt reliability check passes on staging. The complete learner journey, including reminders, approved decks, Practice, Results, History, and Study Plan continuity, still needs the final staging ticket's signed-in browser rehearsal. The earlier clipped-question-content finding also needs visual verification after the player changes. Production backup, restore, hostname, secrets, and cutover remain owner-operated gates; this record does not close them.
