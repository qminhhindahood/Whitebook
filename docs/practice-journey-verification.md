# Practice, Exam, and Flashcards verification — September 30, 2026

Worktree: `D:/Notion/worktrees/whitebook-hosted-redesign`. Inline execution; no subagents. Owner-authorized deployment is complete. Other work in this shared checkout has committed earlier implementation changes; remaining source changes are preserved in the working tree.

## Implemented

- Pane-relative protected images, including the portal player, with a fit/zoom dialog and focus return. Desktop footer remains one row; narrow widths deliberately wrap its actions.
- Explicit Practice / Section Exam context. Section Exam uses two server-timed Modules and an untimed transition; opening/resuming an Exam requests fullscreen from the learner's click. Denial and leaving fullscreen remain recoverable.
- Resume preserves the original Attempt. Retry includes the failing HTTP status, reuses the existing id, and anchors the clock before protected resources load. Expired editor leases offer reacquisition/takeover.
- R&W text and image highlights persist through the versioned, lease-protected write API. Highlighting does not accidentally select an answer.
- AI Tutor can open during Practice and Section Exam. Opening it marks the active Attempt as assisted; the timer continues. Existing provider eligibility/consent controls remain.
- Attempt deletion is authenticated, owner-scoped and CSRF-protected. UI confirmation explains that responses/results/guided reviews are removed from History/Progress while question notes remain. UI removes the row only after success.
- Flashcards use the Design Kit. Starter Decks appear before Personal Cards with 839 and 1,000 cards; the personal empty state specifically describes personal cards. Reveal-before-rating and the 1-day / 4-day schedule remain.

## Evidence

- Full web suite: 36 files, **212 passed**.
- Full hosted suite: 20 files, **200 passed, 1 skipped**; standalone Node checks: **7 passed**.
- Web and hosted typechecks: passed.
- Isolated staging build: passed. Private visual staging verifies **2,272 files / 260,980,875 bytes**, release `reviewed-five-20260927`.
- Real Worker + real SQLite migrations + real publication data, isolated learner: **10 API journeys** across all five packages in both Practice and Section Exam. Covered 491 selected protected visuals, responses, marks, eliminations, current question, persisted R&W highlights, unchanged clock across resume, deliberately expired lease/reacquisition, pause/resume, both Exam Modules, assisted classification, submit/results, single-record identity and deletion. No Attempts remained in that audit database.
- Packages: August Math (201), August R&W (254), Hardest SAT Math Questions (237), September Math (242), September R&W (218). All three Math packages contain typed responses.
- Browser: R&W answer/mark/elimination/image highlight and question 2 restored after save/reload/resume. Math typed response restored after save/reload/resume, then the same Attempt submitted. Section Exam paused, reloaded, resumed and finished both Modules with one completed record. Actual CDP runtime reported `fullscreen: true` after the Exam start gesture.
- Browser: 1440×900, 1366×768, 1280×800, 390×844 and 320×640. Desktop footer actions fit. A mobile calculator/body zero-height bug and typed-input horizontal overflow were found and fixed; final 320px inspection found no overflowing descendants inside the question workspace.
- Browser: calculator fallback computed `2+3=5`; protected Reference Sheet opened; image fit checked against actual pane width. Flashcards search selected the B2-C1 deck; Space revealed the back, Enter rated Sure, navigation and Enter rated Not sure. Ratings advanced the queue and reviewed counts correctly.
- Regression evidence: synthetic resume GET 503 retains HTTP status and retries the same id without a duplicate POST; slow protected loading does not give back countdown time; annotation mode does not select a radio answer. Transition test failed with `00:00` before the final fix and passed with `Between Modules`, with no misleading other-device warning.

## Live check and remaining prerequisite

Read-only live Math resume returned HTTP 200 for the existing Attempt, protected images, calculator config and Reference Sheet. It restored question 4 and displayed the expired-lease reacquisition control. No live answers, leases, ratings, or Attempt records were changed by this check. The originally reported failing live resume status was not reproduced; the 503 regression is an injected failure, not a claimed production incident.

Live `/api/math/calculator-config` returned `configured: false` with no script URL. The scientific fallback works, but actual Desmos graphing remains pending the owner's registered key. The user confirmed they have a key and requested secure setup instructions. See `docs/desmos-secure-setup.md`. After key activation, repeat live Desmos readiness and resizing before declaring the Desmos acceptance criterion complete.

Screenshots: `.scratch/practice-journey/flashcards-desktop.png`, `.scratch/practice-journey/flashcards-mobile.png`. Local harness and audit scripts are in the same scratch folder and require the private publication bundle; they are verification helpers, not production runtime.

## Desmos key activation follow-up

The owner uploaded `DESMOS_API_KEY`. A fresh live request now returns HTTP 200, `configured: true`, and a script URL. The key value was not printed or saved. This exposed a pre-existing generated-frame JavaScript syntax error: the outer template string consumed slash escapes in the script URL validation regex. The browser logged `SyntaxError: Invalid or unexpected token` and the calculator fell back.

The bridge now validates an exact Desmos script prefix and a restricted key suffix without slash escaping. A regression compiles the actual emitted inline script; three runtime cases cover valid initialization and rejection of unwanted host/query variants. The syntax regression failed before the repair and passed afterward. Fresh hosted suite: **203 passed, 1 skipped**, plus **7 Node checks**; typecheck passed. Live graphing remains pending deployment of this code fix and the subsequent browser check. The deployment package uses the isolated complete asset directory rather than the shared, incomplete `hosted/dist`.

The isolated asset package was reverified at 2,272 protected visual files. The subsequent Wrangler deployment dry run passed against that complete directory. No deployment was executed; the frame-script repair awaits live code publication.

## Deployed follow-up

Owner authorized live deployment. The first deployed bridge repair reached Desmos and exposed its dynamic-evaluation requirement. Added `unsafe-eval` only to the sandboxed calculator frame's CSP; dashboard CSP still disallows both unsafe evaluation and inline scripts, verified by a new regression. Full hosted suite: **204 passed, 1 skipped**, plus **7 Node checks**, and typecheck passed. Deployment version: `690ed92b-f152-491b-9bc6-438821f0e8d6` on `whitebook.docai.dpdns.org`, using the complete isolated asset package. Live graphing verification follows below.

## Final live verification and release

Final deployed version: **`f5e665d3-4006-4877-9fbb-32625de1556a`**, Worker `whitebook-hosted-staging`, custom domain `https://whitebook.docai.dpdns.org`. Wrangler deployment exited successfully using `../.scratch/practice-journey/dist`, the complete isolated asset package.

- Actual Desmos engine passes all five readiness checks: script loaded, constructor available, instance created, state readable, usable size. A temporary `y=x^2` expression set through the calculator API displayed a parabola and one audio-traceable curve. No console errors were recorded in the final verification tab. Direct keyboard entry into the embedded Desmos editor was not verified because the automation input timed out.
- Graph state remained intact while resizing through 1440×900, 1366×768, 1280×800, 390×844 and 320×640. At 320px the calculator frame measured 288×341 and retained all five readiness checks.
- The 320px inspection exposed cramped long Math options. Moving Eliminate controls below each option at narrow widths gives the final labels 278px and content 216px; client and scroll widths match for all four options. The final web build, including TypeScript, passed after this CSS repair.
- Reference Sheet loaded successfully with natural dimensions 728×421. The desktop footer remained on one row with calculator open.
- Live resume retained question 4 of the existing Math Attempt and showed the expired-lease reacquisition action. Network observations were complete, untruncated, and contained **zero non-GET `/api/attempts` requests**, including exit. Existing answers, leases, marks, ratings and records were untouched. The temporary graph was discarded by closing Calculator; verification tabs were closed and the viewport override reset.
- Saving and restoring actual Desmos graph state to the live learner account was deliberately not exercised in this read-only check. Same-Attempt save/resume/submit and lease writes were exercised in the isolated local journeys above; emitted-bridge runtime tests cover calculator state restoration.

Proof screenshot: `.scratch/practice-journey/desmos-live-desktop.png`. Historical pending statements above describe earlier checkpoints; the key and deployed graphing integration are now active.
