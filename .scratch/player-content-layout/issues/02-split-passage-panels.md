# 02 — Read and answer passages in adjustable split panels

**What to build:** Passage images left; stem and answers right. Mouse and keyboard divider adjustment, independent scrolling, fixed header/footer, and no content zoom.

**Blocked by:** 1.

**Status:** resolved

- [x] Reading and Writing questions with a stimulus presentation render the passage blocks in a left pane and the banner, stem, and full-content answer boxes on the right (`playerLayout` kind `split`).
- [x] The divider is a focusable `role="separator"` with `aria-valuemin/max/now`; ArrowLeft/ArrowRight adjust the split, clamped so neither pane drops below a useful reading width.
- [x] Each pane has its own scroll container; content scroll resets per question (`key={question.id}`); header and footer stay fixed.
- [x] Content zoom controls are removed from the question surface (the Reference tool keeps its own zoom).
- [x] A Reading question whose presentation has no stimulus uses the centered composition instead of manufacturing a passage.
- [x] Missing Reading content is an actionable readiness message at the gate and in the player (`presentationIssue`).
- Tests: `player.test.tsx` (split layout, keyboard divider, centered fallback, missing content); verified visually at 1024×768 and 1440×900 (`shots/small-04`–`07`, `large-04`, `small-08`).
