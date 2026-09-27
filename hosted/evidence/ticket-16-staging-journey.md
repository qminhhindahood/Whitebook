# Ticket 16 staging learner rehearsal

**Environment:** `https://whitebook-ticket-03-staging.anothermiralph.workers.dev`

**Worker:** `whitebook-ticket-03-staging`

**Date:** 2026-09-27 (UTC)
**Result:** **Incomplete; no-go**

## Visual checks supplied by the owner

The owner supplied screenshots from the signed-in staging browser. They show Google sign-in completed, the learner dashboard, the five protected library packages, empty Flashcards, an empty History, no official score yet, and a Study Plan that requires a primary SAT Weekend before it can build a plan. These screenshots were reviewed in chat, but were not copied into the repository: they expose the learner's email and rendered test questions/answer choices. The screenshots therefore serve as review input, not committed evidence artifacts.

The supplied Attempt screenshots show question artwork/text extending beyond the content panel and viewport. They also show publisher watermark text repeated inside the rendered question. This is a release blocker for a learner-facing rehearsal. The larger Attempt UI redesign is tracked separately at the owner's direction and is outside this ticket's implementation scope.

## Automated staging journey

`hosted/scripts/rehearsal-load.mjs` seeded 24 short-lived synthetic Google-subject sessions in staging, with random session and CSRF credentials held in memory. It used the protected Library, selected Math and Reading and Writing Section Exam packages, loaded question presentations and protected visuals, checked configured timer lengths, took over the editor from a second-device session, tested stale-editor rejection, saved responses, and checked History for completion. The script discarded the final grading response body and asserted learner/error responses contained no answer keys or credentials. It deleted all 24 synthetic accounts; a follow-up D1 check found zero remaining rehearsal accounts and sessions.

One single-learner Math diagnostic completed all 44 question loads, visuals, takeover, responses, and History completion with no 5xx or 1102 responses. The 24-learner exercise created 23 Attempts (11 Math, 12 Reading and Writing), but completed only 3. Of 1,132 question presentation requests, 268 failed; of 3,248 protected visual requests, 1,891 failed with generic `service_unavailable` errors. Overall, 2,160 of 4,618 requests returned HTTP 503. No HTTP 1102 CPU-limit response was observed. See [ticket-16-concurrent-load.json](ticket-16-concurrent-load.json) for the measurements and projection method.

The failed concurrent run does not establish that every learner journey step can complete under load. It also does not exercise SAT date selection, official score entry, cards due sessions, History guided review, study notes, or plan generation in the live signed-in browser. Those steps remain open for a later owner-assisted rehearsal after the service errors and Attempt layout are resolved.

## Evidence handling

The public evidence avoids account email, session/CSRF/editor tokens, answers, and raw grading results. Screenshot attachments were not committed because they include account identity and protected question content. Production was not deployed and public sign-up was not opened.
