# 02 — Attach reviewed questions and classify Assisted Practice

**What to build:** A learner can explicitly bring one completed, revealed Whitebook question into Tutor Chat for an explanation, and can use Chat during active Practice only after the whole Attempt is marked assisted. Active Section Exams remain free of AI controls.

**Blocked by:** 01 — Deliver Gemini Tutor Chat core.

**Status:** complete

**Suggested model:** GPT-6 Astra — answer secrecy, Attempt lifecycle, and Progress evidence must agree across server and browser.

- [ ] The **Attach reviewed question** picker lives inside Tutor Chat, separate from question review. It lists only the learner's eligible completed, answer-revealed reviews and attaches at most one canonical Question Presentation to a send.
- [ ] The exact preview includes the chosen question, learner response, accepted answer, and each selected derived visual at its transmitted size. Visuals require separate explicit image consent and a vision-capable Gemini model; Source PDFs and unrelated Attempt data are excluded.
- [ ] The server rechecks account ownership, completion, reveal state, and attachment availability at send time. A stale or unrevealed selection fails without transmission while preserving the typed prompt and visit conversation.
- [ ] Tutor Chat and all other AI surfaces are unavailable during an active Section Exam Attempt. During active Practice, Chat becomes available only after the learner explicitly chooses Assisted Practice and sees that the whole Attempt will be excluded from unassisted Progress evidence.
- [ ] Assisted classification is server-owned and cannot be reversed for that Attempt. The ordinary graded result remains visible, while every question in the Attempt is excluded from unassisted Progress aggregates. Gemini output cannot write a response, regrade, or change accepted answers.
- [ ] Signed-in two-state browser journeys and hosted API tests cover revealed and hidden attachments, wrong-account and stale selections, active Section Exam denial, Assisted Practice entry, whole-Attempt Progress exclusion, and unchanged Results authority.
- [ ] These controls remain outside the current hosted launch staging release and require the later AI release decision.

## Comments

### Investigation notes — Results reveal and Progress evidence (2026-09-28)

Investigation only (no edits, no provider calls). All paths are relative to the repo root, line numbers as of this note.

**Summary.** The two server truths this ticket builds on already exist. Results reveal is gated by attempt completion plus two distinct reveal states: attempt-level `learner_attempts.answers_exposed_at_ms` and review-level `guided_reviews.revealed_at_ms` (the picker's eligibility state). Progress counting lives in `summarizeProgress` (`hosted/src/progress.ts:86`), which already skips questions flagged `assisted` — but that flag is **inert**: nothing writes it, and exclusion is per-question, not whole-Attempt. Top risks: (1) where to store the whole-Attempt assisted classification (a dedicated one-way column — `state_json` is client-influenced and must not carry it); (2) `completedAttempts` currently counts assisted attempts and a test pins that; (3) the Section Exam denial guard can be stale in the blocking direction because exam auto-close is lazy.

#### Trace 1 — how Results reveal answers

- Grading happens once at completion and embeds accepted answers into `result_json`:
  - Practice: `hosted/src/attempts.ts:802-815` (`submitAttempt`) reads `publication_answers.accepted_answers_json`, grades, and writes `result_json` with per-question `{questionId, response, acceptedAnswers, correct}` in the same UPDATE that sets `status='completed'` (`hosted/src/attempts.ts:817-821`).
  - Section Exam: `gradeSectionExam` (`hosted/src/attempts.ts:384-400`), written by `closeSectionExamModule` (`hosted/src/attempts.ts:433-438`). No runtime route ever rewrites `result_json` — immutable after completion, so an attached "learner response + accepted answer" pair is stable forever.
  - Active-attempt snapshots (`hosted/src/attempts.ts:164-191`) contain only presentations, question links, and state — no answers. Secrecy is structural, not conventional.
- **Two distinct reveal states (do not conflate):**
  1. Attempt-level `learner_attempts.answers_exposed_at_ms` (migration `hosted/migrations/0007_guided_review_notes.sql:1`). Set at practice submit (`attempts.ts:818,821`), at explicit Section Exam module-2 finish (`attempts.ts:602` passes `exposeAnswers=true` → `attempts.ts:437`), and lazily on first `GET /api/attempts/:id/results` (`getResults`, `attempts.ts:836-838`). NOT set when a Section Exam times out — `enforceSectionDeadline` → `closeSectionExamModule` defaults `exposeAnswers=false` (`attempts.ts:443-449`).
  2. Review-level `guided_reviews.revealed_at_ms` — one-way via `reveal`/`retry`, guarded `WHERE ... AND revealed_at_ms IS NULL` (`hosted/src/review.ts:133-135`). `details` returns `acceptedAnswers`, `originalResponse`, notes only when revealed (`review.ts:52,63-65`). `prior_answer_exposure` ("seen"/"possible", `review.ts:88-96`) is informational only.
- **The picker's eligibility state is (2), not (1).** Results-viewed-but-never-revealed-in-review ⇒ not attachable.
- Browser: `web/src/account/HostedAttempt.tsx:198-203` and submit response `HostedAttempt.tsx:421-429`, "Accepted answer:" at `HostedAttempt.tsx:553,774`; History `web/src/account/HistoryArea.tsx:101-109` (`openResults`), reveal flow `HistoryArea.tsx:129-141,218-226`. Shared type `AttemptResult` at `web/src/account/PracticeArea.tsx:30-32`.
- Prior art for exam denial: `reviewRoute` blocks ALL review routes whenever any active Section Exam exists — `hosted/src/review.ts:198-201`, error `active_section_exam`, tested in `hosted/test/review.test.ts:174,197`. Chat gating should replicate this query and error code.

#### Trace 2 — how Progress counts Practice Attempts

- `GET /api/account/progress` → `progressRoute` (`hosted/src/progress.ts:139-156`); loads completed attempts with `result_json` plus category metadata, then `summarizeProgress` (`hosted/src/progress.ts:86-137`).
- An attempt counts only if `kind ∈ {practice, section_exam}` (`progress.ts:91`) and `status='completed'`. `completedAttempts` (`progress.ts:133`) counts all such attempts — **including assisted ones today**.
- Evidence is per graded question from `result_json` (`progress.ts:97`), tagged section/category/domain, `correct`, `unanswered`, `timeMs` (from `state_json.questionElapsedMs`), `completedAt`, `attemptId`.
- **Assisted exclusion scaffolding exists but is dead code**: `progress.ts:96-98` skips a question when `grade.assisted` (type at `progress.ts:15`) or when listed in `state_json.assistedQuestionIds` (`progress.ts:94`), incrementing `excludedAssisted`. No live code writes either flag — only the unit test fabricates it (`hosted/test/progress.test.ts:101-108`, which pins `completedAttempts: 3` WITH the assisted attempt counted).
- Aggregates: `groupEvidence` (`progress.ts:46-84`) — Raw Accuracy = correct/all (unanswered lowers it); recent trend compares the latest two *surviving* attempts by `completedAt` (`progress.ts:47-58`).
- Consumers: `web/src/account/ProgressArea.tsx:25-32` (shape), copy `ProgressArea.tsx:103,108-110` ("N assisted responses excluded"), caption "from completed, unassisted Whitebook Attempts" (`ProgressArea.tsx:53`). **`hosted/src/plan.ts:3,151-159` also calls `summarizeProgress`** for Study Plan evidence counts and least-accurate-section selection, with assisted-only fallback copy at `plan.ts:73` — whole-Attempt exclusion propagates there for free.

#### Edge cases — attachment ownership

1. Cross-account review id: existing scoping is `WHERE id = ? AND account_id = ?` (`review.ts:36-40`; attempts `attempts.ts:148-154`). Picker list and send-time recheck must both use it; a foreign reviewId must 404 with zero provider calls.
2. Cross-account source attempt: load the attempt through the same account-scoped query (`review.ts:26-29` prior art) so a hostile client cannot mix ids.
3. Ownership ≠ availability: a review row survives revocation of its package's release (`guided_reviews` FKs to `publication_questions`, not entitlements). Availability = presentation row exists AND `hasPackageEntitlement` passes (`hosted/src/library.ts:13-21`, enforced on the `/api/library/...` question route at `library.ts:96-102`). Picker listing should apply the same entitlement filter; the send recheck must re-apply it.
4. Account deletion mid-visit: account delete removes `guided_reviews`/`learner_attempts` (`hosted/src/accountData.ts:70-71`); send after deletion must fail without transmission, preserving the typed prompt.
5. Same question, multiple reviews: eligibility is per-review. Q revealed in attempt A's review is attachable; the same Q's unrevealed review from attempt B is not. The payload must bind the review's attempt response, not "latest response for the question".

#### Edge cases — stale reveal state

1. Reveal cannot be revoked (`review.ts:133-135` is one-way; no un-reveal route), and payload sources (`result_json`, `presentation_json`, `publication_assets`) have no runtime mutation path (grep-verified). Attachment *content* cannot change between preview and send — the genuine staleness vectors are the state *around* the attachment:
2. Client-supplied unrevealed/foreign/deleted reviewId — send must re-derive everything server-side ("the browser cannot supply … reveal state", spec line 106) and fail without transmission.
3. Section Exam starts between preview/consent and send — even with a still-valid attachment, send must fail `active_section_exam`. Most realistic stale-gating case.
4. Unassisted active Practice between preview and send — chat unavailable until Assisted entry; a consent captured before the attempt started must not authorize a send.
5. Two-state divergence trap: `answers_exposed_at_ms` is NOT eligibility. Pin tests in both directions: Results-viewed-but-never-revealed-in-review ⇒ not attachable; `prior_answer_exposure: "possible"` but revealed in-review ⇒ attachable.
6. Lazy exam auto-close cuts the other way: the guard query (`kind='section_exam' AND status='active'`, `review.ts:198-201`) can be stale-blocking — a timed-out exam keeps `status='active'` (past `deadline_at_ms`) until someone GETs the attempt and `enforceSectionDeadline` runs (`attempts.ts:443-449`). Existing behavior for review; replicate or consciously improve, and note it.

#### Edge cases — whole-Attempt assisted exclusion

1. Storage: current flags are per-question and unwritten. Classification must be server-owned and irreversible — recommended: new migration adding `assisted_at_ms INTEGER` to `learner_attempts`, set by a dedicated endpoint with a one-way guarded UPDATE (`WHERE kind='practice' AND status='active' AND assisted_at_ms IS NULL`), mirroring the reveal guard. Do NOT store it in `state_json` (reachable via the client-driven `writeAttempt` change channel) or `config_json` (create-time only).
2. `completedAttempts` semantics is a live conflict: `hosted/test/progress.test.ts:107` pins `completedAttempts: 3` including the assisted attempt. The graded result stays visible (History/Results) while questions leave unassisted aggregates — decide whether `completedAttempts` stays all-completed (recommended, plus a separate `excludedAttempts` count) or becomes unassisted-only, and update the pinned test deliberately. `web/src/account/ProgressArea.tsx:108-110` copy ("assisted responses excluded") needs rewording for whole-Attempt exclusion.
3. Trend window shifts: `groupEvidence` computes recent/previous from surviving evidence (`progress.ts:47-58`). Excluding the newest assisted attempt must make the previous unassisted attempt "recent" — correct per intent, but it silently changes displayed trends; pin it.
4. `excludedAssisted` units: currently excluded *questions*; with whole-Attempt exclusion it becomes the sum of excluded attempts' question counts. Decide and document.
5. All-attempts-assisted account: `summarizeProgress` returns empty `sections` with `completedAttempts > 0`; `ProgressArea.tsx:112` shows the "No unassisted graded questions yet" branch — works today, needs a journey pin since the numbers above it will look odd.
6. Study Plan propagation: `plan.ts:151-159` inherits the exclusion; an assisted-only history must fall back to the "no unassisted Section evidence yet" baseline (`plan.ts:71-73`), not show fabricated section evidence.
7. Lifecycle guards: assisted entry rejected for `section_exam` kind and for `preparing`/`completed`/`expired` practice attempts (ticket scopes it to *active* Practice). Double-POST must classify once. An assisted attempt that later expires without submit never completes, so it never reaches Progress — History keeps showing it active; no crash path but worth a test.
8. Grading authority: reviews remain startable on assisted attempts (`review.ts:87` only requires wrong/unanswered) — no coupling. The chat send path must perform zero writes to `learner_attempts` (test via DB mock write counting).

#### Proposed tests

Worker (`hosted/test/`, injected Gemini adapter from ticket 01's boundary; extend `review.test.ts`, `attempts.test.ts`, or new `chatAttach.test.ts`):
1. Picker list returns only account-owned, revealed reviews; foreign and unrevealed reviews absent.
2. Send with a foreign-account reviewId → 404, adapter never invoked.
3. Send with an existing-but-unrevealed reviewId → 409, adapter never invoked, typed prompt preserved in the response.
4. Send with a revealed review whose revision lost entitlement → 409/404, adapter never invoked.
5. Send denied with `active_section_exam` — including the stale case where preview/consent predated the exam start.
6. Send during active Practice → 409 before Assisted entry; 200 after; Section Exam kind rejected from assisted entry; double-entry classifies once.
7. (`review.test.ts`) Reviews of assisted attempts remain startable/revealable.

Progress (`hosted/test/progress.test.ts`):
8. Whole-Attempt exclusion: all questions of a flagged attempt vanish from sections/categories/domains; `excludedAssisted` equals its question count; remaining `rawAccuracy` identical to a fixture without that attempt.
9. Excluded newest attempt leaves `recentTrend`/`attemptCount`/`recentAccuracy` computed only over unassisted attempts.
10. `completedAttempts` semantics pinned per decision (2 above).
11. Assisted-only history → empty sections, no numeric errors, tentative/empty state.
12. (`hosted/test/plan.test.ts`) Plan evidence counts exclude assisted attempts; assisted-only history → baseline fallback copy.

Browser (`web/src/account/`):
13. `HistoryArea.test.tsx`: Results for an assisted attempt still render accepted answers and the review flow is unchanged (authority unchanged).
14. `ProgressArea.test.tsx`: whole-Attempt exclusion copy and counts.
15. New picker journey: revealed review attachable; stale/unrevealed/foreign selection shows failure while the typed prompt remains; Chat hidden during active Section Exam.

#### Unresolved risks / decisions for the lead

1. Classification storage + migration (column recommended; keep it out of client-influenced channels). Any new column should also be added to the row types in `attempts.ts:38-55` — note `AttemptRow` there already omits `answers_exposed_at_ms` even though UPDATEs write it; don't copy that omission.
2. `completedAttempts` + `excludedAssisted` semantics and copy — conflicts with a pinned test (`progress.test.ts:107`) and ProgressArea wording.
3. Error taxonomy for stale attachments must reuse ticket 01's failure states (draft-preserving, provider-not-invoked), not invent new ones.
4. Lazy Section Exam close can make the `active_section_exam` guard over-block (or, if "fixed" by checking deadline, under-block on other paths) — replicate review.ts exactly unless the lead decides otherwise.
5. Derived visuals at send time: if an image was consented but its asset check fails (`library.ts:67-85` validates sha256), sending without it would break preview-to-send identity — the send must fail, not degrade. Needs an explicit test.
6. Ticket 02 is blocked by 01: the request boundary, consent snapshot model, and adapter test seam come from there; the findings above are the server-side truth sources 02 builds on.
