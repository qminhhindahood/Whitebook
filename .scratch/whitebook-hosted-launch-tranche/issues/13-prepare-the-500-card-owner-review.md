# 13 — Prepare the 500-card owner review

**What to build:** An owner-friendly review aid for the draft 500-card C1–C2 vocabulary deck, so the owner can approve or reject every learner-facing card before publication.

**Blocked by:** None — can start immediately.

**Status:** awaiting-owner-review

- [x] The aid lists all 500 stable card identities and learner-facing fields with source context and a place to record corrections or approval.
- [x] The aid distinguishes unreviewed, corrected, approved, and rejected rows and reports a complete tally.
- [x] The draft manifest remains unpublished; generating the aid never imports cards into learner storage.
- [x] The handoff states the exact owner decision needed before any later publication ticket can proceed.

## Comments

**Handoff status:** The review aid is generated and verified. The owner review is the only remaining step for this ticket.

The workbook is at [vocab/reports/c1c2_wic500-owner-review.xlsx](D:/Notion/worktrees/hosted-account-lifecycle/vocab/reports/c1c2_wic500-owner-review.xlsx) (worktree root: `D:\Notion\worktrees\hosted-account-lifecycle`). It has two sheets:

- **Owner decision** — instructions, a live tally (currently 500 Total / 500 Unreviewed / 0 Corrected / 0 Approved / 0 Rejected / "Reconciled"), a deck-level decision dropdown, and the source/publication boundary (manifest and source PDF SHA-256 hashes).
- **Card review** — all 500 rows, one per stable card identity, with printed number, source record ID, source reference/file/SHA-256, the learner-facing fields (front, part of speech, IPA, Vietnamese meaning, English definition, synonyms, English/Vietnamese examples, CEFR), a status dropdown (Unreviewed → Corrected → Approved/Rejected), yellow correction columns, and a correction note column.

Verification performed: the builder re-checked the manifest and card hashes before writing, confirmed 500 unique stable IDs reconciled to 500 unique source references, and the initial tally recalculated to 500 unreviewed / Reconciled. Rendered previews of both sheets passed visual inspection. The draft manifest is unchanged after generation: still `draft-pending-owner-review`, 0 approved, manifest SHA-256 `d4e6f46ac99c1e96…`. Nothing was imported into learner storage; the workbook generation only read the draft manifest, cards, and staging source rows.

**Exact owner decision needed before any later publication ticket can proceed:** For every one of the 500 cards, approve or reject the learner-facing content and record any accepted corrections; then choose whether to authorize `c1c2_wic500` v1 publication using Approved rows only (Rejected rows excluded) or defer publication. The publication ticket can start only after all 500 rows carry a final Approved/Rejected status, corrections are resolved, and the deck-level decision on the Owner decision sheet is set to "Publish approved cards only".
