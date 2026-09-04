# 10 — Gate Math on Desmos and Reference readiness

**What to build:** A dependable Math tool experience that fully prepares the configured Desmos calculator before Math access, reports failure precisely, preserves work, and provides explicit scientific-calculator and Reference Sheet alternatives.

**Blocked by:** 06 — Pause, recover, and resume Attempts.

**Status:** ready-for-agent

- [ ] One project-wide Desmos key is read from local environment configuration and excluded from source control, logs, and backups.
- [ ] The Attempt Loading Gate verifies script loading, constructor availability, calculator construction, readable state, and usable rendered size whenever Math is selected.
- [ ] Math questions and timing remain inaccessible until calculator readiness succeeds or the learner explicitly selects the local scientific fallback.
- [ ] Desmos failure identifies the failed stage and offers Retry, Return to Setup, and Use Local Scientific Calculator.
- [ ] The Desmos adapter disables image uploads, folders, notes, external links, graph-link pasting, and author tools through documented options.
- [ ] Desmos opens in a resizable overlay, retains state when closed, and never navigates away from the current question.
- [ ] Calculator state persists through Math navigation, both Math Modules, pause, resume, and restart, then resets for a new Attempt.
- [ ] One configured PNG Reference Sheet appears as a zoomable resizable overlay for every Math Section.
- [ ] Automated tests use controlled CalculatorProvider adapters for ready, delayed, and failed states; an optional local integration check uses the real licensed key.
