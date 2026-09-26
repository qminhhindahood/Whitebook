# 03 — Enter Math responses with directions and answer preview

**What to build:** Directions left; problem, labeled input, and live preview right. Typed entries survive navigation and resumption without changing grading rules.

**Blocked by:** 1.

**Status:** resolved

- [x] Student-produced responses render entry directions and examples in the left pane, derived from the application's actual grading behavior (exact match after trimming and glyph normalization; no invented rounding rules).
- [x] The right pane shows the banner, complete problem stem, a visibly labeled Answer input, and an Answer Preview below it.
- [x] The preview renders a complete simple fraction (`3/4`) as a stacked fraction and any other input faithfully as typed; it never shows correctness or an accepted answer.
- [x] Raw entries are persisted and survive navigation, save/exit, and resume; grading rules are untouched (`grading.py` unchanged).
- [x] Presentation validation accepts SPR content with no choice list and an empty stimulus; missing SPR content is an actionable readiness message.
- Tests: `player.test.tsx` (directions, preview fraction/decimal, ordered saves, resume typing race); verified visually at both resolutions (`shots/*-11`, `*-12`, `*-15`).
