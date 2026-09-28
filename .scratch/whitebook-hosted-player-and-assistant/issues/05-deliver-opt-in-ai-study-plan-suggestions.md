# 05 — Deliver opt-in AI Study Plan suggestions

**What to build:** A learner can request Gemini Study Plan suggestions from at least one result source they choose, inspect the exact evidence and constraints, and accept only server-validated plan changes. The deterministic Study Plan remains available throughout.

**Blocked by:** 01 — Deliver Gemini Tutor Chat core.

**Status:** complete

**Suggested model:** GPT-6 Sol — the result-selection and plan-validation seams are bounded by existing Study Plan behavior.

- [x] The learner independently selects the latest Official SAT Result, the latest completed Whitebook Section Exam Attempt summary, or both. A request with neither source is refused without a Gemini send.
- [x] The Official SAT preview includes total, Reading and Writing and Math Section scores, and all eight nullable Skills Insight bands. Latest means administration date, with the most recently saved record breaking a same-date tie. The Whitebook summary is latest completed Attempt and is labeled Raw Accuracy, never SAT points.
- [x] The exact preview includes the selected result source identities, score goal, Primary SAT Target, study/rest days, daily time, available activities, and applicable aggregate evidence. It excludes question text, accepted answers, Source PDFs, and unselected results.
- [x] Dated suggestions require a Primary SAT Target. Proposed tasks are checked against real dates, entitled Test Packages, capacity, and deterministic plan rules before the learner accepts them. Gemini cannot silently overwrite a saved version.
- [x] Declining AI, missing evidence, provider failure, or invalid suggestions preserve the deterministic plan and existing saved versions. AI failure never blocks manual plan work.
- [x] Signed-in browser and hosted API tests cover Official-only, Whitebook-only, both, and neither; nullable bands; latest-record selection; official-versus-Whitebook labels; payload exclusions; invalid task rejection; acceptance; and plan continuity.
- [x] AI suggestions remain disabled in the current hosted launch staging release.

## Comments

### Agent investigation notes — 2026-09-28 (data mapping only; no files edited, no provider calls made)

Criteria 2–5 and 6 map to `docs/design/assistant.md` §1.5 (flow F6), §4.1 (F6 envelope), §5.4 (`result_source_required`), and spec.md line 113 (Implementation Decision), line 124 (Testing Decision), line 135 (Out of Scope). Ticket 01's notes established that no assistant code exists yet in `hosted/src` — F6 must reuse the preview-snapshot/adapter boundary ticket 01 introduces. Everything below is what exists today that F6 reads from and validates against.

#### Boundary map 1 — Official SAT Result (latest by administration date)

- **Schema:** `hosted/migrations/0003_official_sat_results.sql` — `official_sat_results` has `administration_date`, `total_score` (400–1600, %10), `reading_writing_score`/`math_score` (200–800, %10, sum-checked), eight nullable band columns (`band_information_ideas` … `band_geometry_trigonometry`, integer 1–7 or NULL), plus `created_at`/`updated_at`.
- **The eight band keys:** `hosted/src/scores.ts:3-15` (`READING_WRITING_DOMAINS` + `MATH_DOMAINS` = `BAND_KEYS`), column mapping at `hosted/src/scores.ts:18-27`, JSON re-emission (`rowJson`, all eight keys always present, nulls included) at `hosted/src/scores.ts:117-132`. Band input validation (1–7 or null, unknown keys rejected) is `parseBands` at `hosted/src/scores.ts:72-83`.
- **Existing "latest" ordering — the divergence:** the scores list endpoint already orders `ORDER BY administration_date DESC, created_at DESC` (`hosted/src/scores.ts:148`), which is exactly this ticket's rule ("administration date, most recently saved breaking a same-date tie"). But the **deterministic plan** selects its latest score by edit time: `ORDER BY updated_at DESC` at `hosted/src/plan.ts:132`, selecting only `id, administration_date, reading_writing_score, math_score, updated_at` — no `total_score`, no bands. The F6 envelope needs a new query (all fields, test-date ordering); the design (`assistant.md` §4.1, spec line 113) says explicitly this must be implemented separately and the current plan runtime stays unchanged.
- **Save-side constraints worth pinning in tests:** future administration dates are rejected (`hosted/src/scores.ts:98-99`), so a selected result's date is always ≤ today; DB CHECKs enforce band range (`0003_official_sat_results.sql`).

#### Boundary map 2 — latest completed Whitebook Section Exam summary

- **Attempt table and lifecycle:** `learner_attempts` columns at `hosted/src/attempts.ts:38-55`; Section Exam config validates `section: "Math" | "Reading and Writing"` and fixes 44/54 questions (`hosted/src/attempts.ts:85-99`). Completion happens in `closeSectionExamModule` (`hosted/src/attempts.ts:402-441`): on module 2 close, `status='completed'`, `completed_at_ms` and `result_json` set.
- **What `result_json` holds:** `gradeSectionExam` (`hosted/src/attempts.ts:384-400`) stores `{ correctCount, questionCount, questions: [{ questionId, response, acceptedAnswers, correct }] }`. **The per-question array contains accepted answers and responses — the Whitebook summary must be computed server-side from `correctCount`/`questionCount` (raw accuracy = correctCount ÷ questionCount per CONTEXT.md "Raw Accuracy"), never shipped as rows.** Raw Accuracy includes unanswered questions in the denominator (they reduce it — `progress.ts:109`, `progress.ts:73`).
- **Section identity:** `config_json.section` (authoritative, set at creation) or the per-question links in `questions_json` (`{ questionId, section, questionNumber }` — the shape `plan.ts` already parses at `hosted/src/plan.ts:110`).
- **"Latest completed" query precedent:** `hosted/src/plan.ts:133` selects completed attempts with results, `ORDER BY completed_at_ms DESC` — but it includes `practice` kind. The F6 source must filter `kind = 'section_exam'` (and implicitly `result_json IS NOT NULL`; `status='expired'` rows never carry results). Progress evidence does the same kind filter at `hosted/src/progress.ts:91`.
- **Label:** spec story 60 / criterion 2 — the summary is "Whitebook Raw Accuracy", never SAT points. Existing label precedent: the deterministic plan's `officialEvidence` string at `hosted/src/plan.ts:72` ("This is Whitebook practice evidence, not an SAT score").

#### Boundary map 3 — plan-validation data and the acceptance seam

- **Aggregate evidence:** `summarizeProgress` (`hosted/src/progress.ts:86-137`) produces per-section/-category/-domain aggregates (`sampleSize`, `rawAccuracy`, `tentative`, `tentativeReasons`), excluding assisted questions (`progress.ts:96-99`). This is the F6 `aggregateEvidence` source.
- **Entitled activities:** `context()` package query at `hosted/src/plan.ts:135-138` — a revision is available via `active_publication` **or** `private_revision_entitlements`. This is the "entitled Test Packages" check for proposed practice tasks.
- **Plan constraints:** `PlanSettings` = primaryDate, studyDays, restDays (must partition 0–6, ≥1 study day), dailyMinutes 10–240, officialScoreGoal 400–1600 %10 or null — `validateSettings` at `hosted/src/plan.ts:22-33`. Primary SAT Target comes from `learner_sat_dates WHERE is_primary = 1` (`hosted/src/plan.ts:131`); the catalog-constrained dates are in `hosted/src/satDates.ts:13-38`. Due-card count comes from calling `studyRoute` internally (`hosted/src/plan.ts:142-145`).
- **Task rules:** `buildPlan` (`hosted/src/plan.ts:35-77`) — tasks only on study days between today (learner-zone aware, `plan.ts:140-141`) and before `primaryDate`, per-day capacity via a remaining-minutes map. Per-task change rules: `changeTask` (`hosted/src/plan.ts:242-291`) — `validDate` round-trip (`plan.ts:16-19`), study-day membership, `date < primaryDate`, minutes 5–dailyMinutes, title ≤120 chars, per-day sum check returning `409 day_full`.
- **Persistence and no-silent-overwrite:** versions are append-only — `study_plan_versions` (UNIQUE account+version) and `study_plan_tasks` (`hosted/migrations/0009_study_plans.sql`); `rebuild` (`hosted/src/plan.ts:202-240`) inserts version + tasks in one `env.DB.batch`, guarded by `expectedVersionId` → `409 plan_changed` (`plan.ts:215`). **DB triggers backstop inserts and updates:** `study_plan_task_insert_guard`/`study_plan_task_update_guard` (`0009_study_plans.sql`) abort on non-study-day/past-primary dates and day-full capacity. AI acceptance must go through a rebuild-equivalent atomic path so a saved version is never mutated in place.

#### Proposed tests

**API tests — source combinations and refusal** (Miniflare + migrations fixture, per `hosted/test/plan.integration.test.ts:13-46`; injectable adapter + `now`, per `planRoute`'s signature `hosted/src/plan.ts:293`):

1. **Official-only:** preview and adapter payload contain `officialSatResult` with `resultId`, `administrationDate`, total, both Section scores, and all eight band keys; `whitebookSectionExam` is `null`; no attempt data appears (seed both source types; assert the attempt id is absent).
2. **Whitebook-only:** payload contains `{attemptId, section, completedAt, questionCount, rawAccuracy}` labeled Whitebook Raw Accuracy; **no official score or band value appears anywhere** (seed official rows; assert their scores/bands absent from preview JSON and adapter payload).
3. **Both:** both objects present; assert the two labels distinguish "Official SAT" from "Whitebook Raw Accuracy" and no conversion between them.
4. **Neither selected:** request refused with the `result_source_required` state; **adapter call count is 0**; `GET/POST /api/account/plan` still works immediately after (deterministic path untouched).
5. **Selected-but-missing source:** learner selects Official with zero `official_sat_results` rows (or Whitebook with no completed section_exam) → refused without a send, not an empty-source payload.

**API tests — latest-record selection** (seed multiple rows directly, as `plan.integration.test.ts:51-54` seeds attempts):

6. Two results with different `administration_date`s → the later **test date** wins even when it has the older `created_at` and `updated_at` (pins the deliberate divergence from `plan.ts:132`'s `updated_at` ordering).
7. Same `administration_date`, different `created_at` → the more recently **saved** row wins; assert the previewed `resultId` identifies it.
8. Latest completed Section Exam → latest `completed_at_ms` among `kind='section_exam' AND status='completed' AND result_json IS NOT NULL` wins; an active/expired section exam, a `result_json`-null row, and a **newer practice attempt** are never selected.
9. Section label correctness: a Math section exam and a Reading and Writing one selected in turn each report their own section.

**API tests — nullable bands:**

10. All eight bands NULL → all eight keys present with `null` values (not omitted) in preview and payload.
11. Mixed (fixture pattern `hosted/test/scores.test.ts:17-26`: some set, some null) → exact key set, values passed through uncoerced.
12. Boundary values 1 and 7 survive; anything outside 1–7 cannot exist (DB CHECK) — assert no coercion error on pass-through.

**API tests — payload exclusions:**

13. Seed a sentinel accepted answer + response in the attempt's `result_json` (pattern: `privateAnswer` at `plan.integration.test.ts:50-59`) and a question stem in `presentation_json`; assert neither appears in preview or adapter payload.
14. Seed three official results; when one is selected, the other two rows' ids/scores/bands are absent.
15. When Official is **unselected**, the deterministic plan's `officialEvidence` string (which embeds a score, `plan.ts:157-163`) is also absent — see risk 3.
16. Activity catalog contains only entitled revisions (seed one active-release revision + one private-entitled revision + one neither); payload includes goal, primary date, study/rest days, daily minutes, due-card count.

**API tests — invalid task rejection** (fake adapter returns proposals; assert 4xx **and zero new version/task rows** after each):

17. Task on a rest day; task at/after `primaryDate`; task before today (zone-aware `today`, `plan.ts:140-141`); **invalid calendar date `"2026-02-30"`** — the DB trigger normalizes it via `strftime` and will *not* catch it; only JS `validDate` does (risk 6); minutes < 5 or > dailyMinutes; day-full → `409 day_full` semantics matching `changeTask`.
18. Practice task with an invented/unentitled `revisionId`; review task with another account's `attemptId`; unknown `kind`; title > 120 chars → each rejected.
19. No Primary SAT Target (no `is_primary=1` row) → dated suggestions refused before send; adapter count 0.
20. Provider failure after preview (adapter throws) → `provider_error`; **existing versions intact and a manual `POST /api/account/plan` rebuild succeeds immediately afterwards** (AI failure never blocks manual plan work).

**API tests — acceptance and continuity:**

21. Accepting valid proposals creates version N+1 atomically; every prior version's tasks and `status` unchanged (query old version after acceptance, per `plan.integration.test.ts:84-89`); `completedHistory` preserved (`:83`).
22. Acceptance with stale `expectedVersionId` → `409 plan_changed`, no rows written.
23. An AI-suggested task is an ordinary row: PATCH done/skip through `changeTask` works with normal revision/409 semantics; `study_plan_task_events` recorded.
24. Declining AI leaves DB byte-identical; subsequent evidence change still flips `stale` (`plan.ts:188`).

**Browser tests** (jsdom + `vi.stubGlobal("fetch", …)`, per `web/src/account/PlanArea.test.tsx` and `AccountApp.test.tsx`):

25. Each source choice renders the exact previewed fields; the neither case renders the unavailable state and the fetch spy shows **no send call**; the Whitebook summary renders "Raw Accuracy" labeled, never as SAT points (footnote text, `PlanArea.tsx:134` precedent).
26. Accept sends only the preview reference (assert request body), the new version renders, and provider failure keeps the deterministic plan fully visible/editable below.
27. Staging gate (criterion 7): in the current staging build the Plan area renders **no** AI control — mirrors ticket 01's criterion-7 test.

#### Unresolved risks

1. **"Most recently saved" tie-break is ambiguous between `created_at` and `updated_at`.** The scores list endpoint uses `created_at DESC` (`scores.ts:148`); the plan runtime uses `updated_at`. The design's "latest by test date, not last edited" implies `created_at`, but a same-date tie after an *edit* is genuinely undecided — and same-second `created_at` ties still need a final deterministic order (rowid/id). Pin with test 7 once decided.
2. **Ordering divergence is load-bearing.** `plan.ts:132` (`updated_at DESC`) feeds both `latestScore` evidence and `source.latestOfficialResult` (stale detection, `plan.ts:167`). The spec says the AI selection is separate and the plan runtime unchanged — the lead must not "fix" plan.ts's ordering while implementing F6, or stale detection and evidence text change behavior silently.
3. **Unselected-result leakage via `officialEvidence`.** `context()` unconditionally folds the latest official Section scores into every practice activity's `officialEvidence` string (`plan.ts:157-163`). If the learner selects Whitebook-only, that string carries unselected official scores into any payload built from `context()`'s practice list. The F6 envelope builder must strip or recompute it — test 15 covers this.
4. **Preview "plan constraints" have no server source before the first version.** Study/rest days, daily minutes, and score goal exist only inside a saved version's `settings_json` (or as client draft state in `PlanArea.tsx:16`). Decide whether the F6 preview uses last-saved settings, or accepts learner-authored draft settings (validated by `validateSettings` — settings are learner-authored inputs, unlike server-owned evidence). Test 16's fixture depends on this decision.
5. **DB triggers are not a complete validator.** The insert guard (`0009_study_plans.sql`) normalizes invalid dates via `strftime` (so `'2026-02-30'` passes as a real March date), and it cannot check entitlements or attempt ownership. All criterion-4 checks must be JS-side, reusing `validDate`/`validateSettings`/entitlement query — triggers are backstop only.
6. **Dependency on ticket 01's boundary.** The snapshot (`previewId`), consent, adapter injection, and `worker.ts` catch-prefix list (`worker.ts:192`) don't exist yet; F6's tests must be written against whatever shape 01 lands (error-state names, route prefix). `result_source_required` (design §5.4) has no code/status convention yet.
7. **Acceptance endpoint shape is an implementation decision.** `rebuild` computes tasks itself and cannot ingest external proposals; the lead must either add a dedicated acceptance route that validates each proposal with the same rules then batch-inserts a new version, or extend `rebuild`. Recommendation: extract the shared per-task validator from `buildPlan`/`changeTask` rather than duplicating it (risk of drift between deterministic and AI paths).
8. **Raw Accuracy semantics for the Whitebook source.** Use the attempt-level `correctCount/questionCount` (all graded questions; unanswered included in denominator per CONTEXT.md). Do not reuse `progress.ts` section aggregates for this field — those exclude assisted questions and can span multiple attempts; a Section Exam can't be assisted, but pinning this in test 8/9 avoids conflation.
