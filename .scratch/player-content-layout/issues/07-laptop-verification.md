# 07 — Verify the complete player experience on laptop screens

**What to build:** Verified flows at 1024×768 and 1440×900, including long content, image answers, keyboard operation, resizing, saving, calculator/reference tools, and submission. Screenshots and relevant tests document completion.

**Blocked by:** 5, 6.

**Status:** resolved

- [x] Representative published fixtures (long passage, multiline answers, equation/image answer crops, plain Math MC, typed fraction) were imported and published into an isolated scratch instance via `.scratch/player-content-layout/make_fixtures.py`, then upgraded to revisions 2 and 3 through the ticket 04 revision workflow.
- [x] Full flow driven headlessly at 1024×768 and 1440×900 by `.scratch/shotenv/capture-layout.cjs`: Library → drill modal → Loading Gate → RW split (select, eliminate, keyboard divider) → centered Reading → Math figure with image answers → Math selection → SPR fraction and decimal previews → Reference overlay → Save & Exit → History → Resume (script asserts the typed response survived) → Submit → Results. Screenshots in `.scratch/player-content-layout/shots/`.
- [x] Calculator and Reference tools remain reachable over split content; fixed header/footer never scroll away; content is neither clipped nor distorted at either resolution.
- [x] `npm run typecheck`, `npm test` (42 tests), `npm run build`, `uv run pytest -q` (113 tests), and `uv run ruff check src tests` all pass on the final state.
