# 05 — Review completed Attempts with the same question content

**What to build:** Results displays passages, stems, full answer content, learner responses, and accepted answers consistently across all three layouts.

**Blocked by:** 2, 3.

**Status:** resolved

- [x] Results renders converted Reading questions with the passage beside the stem and read-only full-content choices; the learner's selection and the accepted answer are tagged on the choices themselves.
- [x] Converted Math multiple-choice and student-produced questions render stem plus recorded response and accepted answers; review state is shown for every question.
- [x] Historical questions without presentation keep the region-crop fallback with the existing response/accepted-answer list.
- [x] Rendering reuses the shared `QuestionContent`/`ReviewChoices` components rather than copying player markup.
- Tests: `results.test.tsx` (converted RW review with tags, SPR response/accepted answers, region fallback); verified visually at both resolutions (`shots/*-16`, `*-17`).
