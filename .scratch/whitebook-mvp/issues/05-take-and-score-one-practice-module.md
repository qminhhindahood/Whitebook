# 05 — Take and score one Practice Module

**What to build:** The first complete learning path: choose one published Module, prepare it, answer its PDF-based questions through native controls, submit it, and receive correct Raw Accuracy.

**Blocked by:** 04 — Publish an immutable Test Package.

**Status:** ready-for-agent

- [ ] Library can start a Practice Attempt containing one complete available Module from one Test Package.
- [ ] Start enters an Attempt Loading Gate that validates the source, prepares all base-resolution Question Regions, and checks writable autosave storage.
- [ ] Ready requires an explicit Begin action; failed preparation preserves setup without creating an Attempt.
- [ ] The player displays ordered PDF Question Regions with native A–D or student-produced-response controls.
- [ ] The learner can move backward and forward within the active Module without losing responses.
- [ ] Only the selected response is graded; SPR answers use the approved safe normalization and explicit accepted representations.
- [ ] Practice permits confirmed early submission and automatically submits when its configured countdown expires.
- [ ] Submission produces Raw Accuracy as correct answers divided by every question, with unanswered questions lowering the percentage.
- [ ] The end-to-end flow is verified through the localhost interface and a browser smoke test using real PDF and CSV fixtures.
