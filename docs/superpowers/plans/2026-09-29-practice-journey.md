# Practice, Exam, and Flashcards implementation ledger

Goal: the user-approved Plan B plus durable R&W highlights, Math tools, responsive player, and gesture-triggered Section Exam fullscreen.

Execution: inline, no subagents; preserve the Assistant mount and props. No deployment is authorized in this implementation turn.

- [x] Baseline tests: web 202 passed; hosted suite passed. Web typecheck/build failed on AccountApp lazy TutorChat typing. Another workspace actor has since changed that exact typing; preserve their change and recheck.
- [x] Live audit attempted: Chrome extension timed out; in-app browser reaches signed-out website. No test learner is available yet. Do not modify existing learner Attempts.
- [ ] Reproduce loading/retry defects in tests, preserve original request status, repair same-Attempt retry and server clock anchoring.
- [ ] Fit protected images to actual pane; add zoom; desktop footer and small-screen layout.
- [ ] Persist R&W text/image highlights through existing versioned Attempt write API, with input bounds and module/lease validation.
- [ ] Request fullscreen on Section Exam user gestures, allow denial/exit without state loss.
- [ ] Design Kit Flashcards and separately discoverable Starter/personal decks, existing ratings unchanged.
- [ ] Targeted and full verification, browser evidence, final self-review and limitations.

Review focus: portal CSS, slow resource loads consuming server time, expired leases, image-only R&W content, tiny viewports with tools open.

The source exposes Practice via navigation, package cards, Library preview, Study Plan actions, and saved Attempt resume. It does not establish five independent exam modes; package-level coverage requires the live library. Report this explicitly rather than inventing five modes.
