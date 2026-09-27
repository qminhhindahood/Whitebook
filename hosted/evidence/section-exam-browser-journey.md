# Hosted Section Exam browser journey evidence

Run date: 2026-09-27

## Browser journey

Opened the staging `app.html` in local Chrome with two browser pages and a deterministic, same-origin API fixture. The fixture used a reviewed question set with 44 Math questions and 54 Reading and Writing questions, split evenly between generated Modules. It recorded every browser API request and every simulated mutation of its in-memory Attempt row. It did not call the hosted Worker or a D1 database; the Worker row-write measurement below comes from the Worker test fixture.

Both journeys created and started an Attempt, loaded all selected presentations, answered a question in Module 1, finished Module 1, crossed the untimed transition, continued to Module 2, finished the Section Exam, and displayed Results. Math displayed the scientific calculator fallback and opened the authenticated Reference Sheet route. Math Results showed 1/44 correct; Reading and Writing Results showed 1/54 correct. The completed Attempts appeared under Your Attempts.

The second browser page opened the active Math Attempt read-only, then used **Take over editing**. The browser showed the read-only state before takeover and returned to an editable Module afterward. The journey also observed 22 questions in a Math Module and 27 in a Reading and Writing Module. There was no break screen or timed break countdown.

## Browser request and fixture mutation counts

| Journey | API requests attributed to Attempt | Presentation loads | Math resource requests | In-memory Attempt row mutations |
|---|---:|---:|---:|---:|
| Math (including the second device loading presentations) | 103 | 88 | 2 | 11 |
| Reading and Writing | 61 | 54 | 0 | 6 |

Math made 44 presentation requests on first open and 44 more when the second page opened the Attempt. The in-memory mutation counts include creation, start, answer write, finish/continue transitions, and Math heartbeat events. Four Math heartbeat requests were observed across the original and takeover pages. This mixed-page trace is not used to estimate heartbeat cadence; the player fake-timer test observes the 45-second schedule directly.

The browser fixture's API-request counter also observed 212 API calls across workspace initialization, both journeys, and cross-device access. Its mock `rowsRead` field incremented once per API call and is not a D1 rows-read measurement.

## Worker fixture measurement

`npm --prefix hosted test -- test/attempts.test.ts` includes the measured Worker lifecycle case. It sent 10 Attempt API requests covering creation, start, active snapshot, answer write, heartbeat, Module 1 finish, continue, Module 2 finish, Results, and history. The fake D1 fixture observed seven changed `learner_attempts` rows: one creation and six state/deadline mutations. The active snapshot omitted accepted-answer fields. The test asserts these counts from before/after row state, rather than counting one write per browser request.

## Clock evidence

`HostedAttempt.test.tsx` advances the local fake clock to 44 seconds and asserts no heartbeat, then to 45 seconds and observes one heartbeat; a second interval produces exactly one more at 90 seconds. Countdown and five-minute warning updates leave the request count unchanged. Separate Worker tests cover deadline enforcement on reads and writes after elapsed time, pause/resume remainder, takeover without deadline reset, and Module expiry.

## Scope of this evidence

The Chrome journey verifies the rendered learner flow and client request cadence against the deterministic API fixture. Server-authoritative deadlines, grading, answer secrecy, authorization, and persisted-row writes are verified by the Worker tests. No deployment or production account was used.
