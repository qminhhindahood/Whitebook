# Completed Attempt review — September 30, 2026

Confirmed specification: History deletion for every status; completed dashboard with score/date/recorded active time/module results and All/Incorrect/Unanswered/Marked filters; ten questions per page; proportion-preserving image thumbnails; read-only question review with original and accepted responses; no videos or invented confidence values. AI Tutor attaches each selected question, automatically explains once per question, retains separate conversations while navigating within this review session, and uses configured models without a test prerequisite. Provider failures preserve the message and offer the existing model test/sync controls. Guided Reasoning is available for every completed question. Practice again creates a separate exact-question Attempt after answer exposure.

## Implementation

- `HistoryArea.tsx` lists, resumes and confirms deletion using the existing owner-scoped, CSRF-protected endpoint. Failed deletion retains the row. Completed Attempts open `CompletedAttemptReview.tsx`.
- Completed review loads official results and the completed snapshot, uses server correctness, preserves accepted typed-response alternatives, and never writes original responses or scores. Protected presentations load on demand; the preview does not OCR, crop or infer question text. Full images use the existing zoom component. Image-only questions use a single full-width pane; a separate passage uses two panes. The background app is inert while the review player is open.
- Review records are created/revealed only when opening an AI tool, then cached per question. Existing server validation owns the question attachment and answer key. Guided Reasoning now accepts correct as well as incorrect/unanswered completed questions. Its existing provider preview/consent and Study Note flows remain.
- A direct Study Notes dialog preserves creation, editing and confirmed deletion without requiring an AI model. Opening it also creates/reveals the question review record when necessary. Its CRUD regression passes.
- Each visited Tutor stays mounted in its own parked portal container when hidden, preserving its conversation across question navigation and returning to the completed dashboard. These conversations end when leaving this review session, reloading or signing out; they are not persisted account chat history. Unique accessibility IDs prevent collisions between mounted Tutors.
- Retry creation validates ownership, completion, revision, and original membership, then selects that exact published question. The new state labels prior answer exposure and records `assistedQuestionIds`, keeping its answer out of existing unassisted Raw Accuracy calculations. The completed record stays unchanged. No database migration is required.

## Verification

- Full web suite: 38 files, **218 passed**. Subsequent focused checks after review repairs: History/general Tutor/contextual Tutor **14 passed**, and contextual explanation plus unavailable-model test/sync/retry **2 passed**. Web typecheck and final isolated staging build passed.
- Full hosted suite: 21 files, **223 passed, 1 skipped**. Standalone Node checks **7 passed**; hosted typecheck passed. This shared checkout also contains another task's provider changes; the full suite includes those tests, while this feature's commit is restricted to its files.
- Regression: allowing Guided Reasoning for correct questions initially failed with HTTP 409; after the repair it returns 200 without changing result JSON. Exact-question retry checks reject another owner and unknown question IDs, create one separate Attempt, preserve original results, and record answer exposure.
- Isolated real SQLite/Worker/private-publication browser checks: completed Math and R&W Attempts, dashboard, original answer/key, full protected images, automatic fixture explanations, follow-up, separate question conversation, restoration after returning through results, Guided Reasoning mobile Question/Guidance tabs. AI replies are local fixtures; no live provider generation or account mutation was used.
- Viewports inspected: 1440×900, 1366×768, 390×844 and 320×640. At 320px review player and footer client/scroll widths both equal 320; dashboard client/scroll widths both equal 279; Guided Reasoning dialog client/scroll widths both equal 299. At 390px all six protected source visuals fit their pane. A blank passage-pane issue was found visually and fixed.
- Proof: `.scratch/practice-journey/completed-dashboard.png`, `.scratch/practice-journey/completed-review-mobile.png`. Local harness: `.scratch/practice-journey/review-server.mjs` uses a disposable in-memory learner and fixture AI only.

## Inline code review

Baseline: `bb3b8f23059169e65f71ff061a11c1c368bcec95`, scoped to this feature's paths. The implementation skill requests code review; the user's no-subagent instruction overrides the review skill's parallel-agent workflow, so both axes were reviewed inline.

Standards: ownership/entitlement/CSRF remain server enforced, no trusted answer is derived from AI, lazy assistants preserve existing release gating, unrelated staged changes are excluded. Fixed duplicate Tutor IDs and prevented navigation during pending review creation. No remaining blocking findings.

Spec: all confirmed branches are implemented. Fixed correct-question eligibility, image-only blank panes, cooldown retry, and model-test sync. Preserve protected images for provider capability checks rather than silently dropping them for a non-vision model. Live AI provider quality is not claimed from fixture replies. No remaining blocking findings.

Prepared locally and committed; this feature has not been deployed by this task.
