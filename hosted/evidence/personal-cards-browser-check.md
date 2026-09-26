# Ticket 09 — Personal Cards browser check (local Worker + seeded session)

Date: 2026-09-26. Environment: `wrangler dev --local` against the real Worker code and a
local D1 database with migrations 0001–0003 applied. The Learner Account and session were
seeded directly into local D1 (`__Host-wb_session` cookie injected in the browser); no
Google OAuth was exercised — that journey and its evidence already exist for ticket 03
(`oauth-browser-journey.md`), and a live staging deployment with the owner's OAuth
configuration remains an owner-side step for this tranche.

## Journey performed in the real browser (screenshots in this directory)

1. **cards-desktop.png** — Desktop Flashcards view reached from the Dashboard nav
   ("Flashcards" pill). Shows deck filter, Studying/Archived selector, and cards whose
   optional back fields (Part of speech, Pronunciation, Synonyms, Example) appear only
   when present.
2. **cards-duplicate-warning.png** — Adding "serene" to the "Hard words" deck while a
   card with the same normalized front already exists there shows the amber duplicate
   warning with the existing card's sense preview and "Save anyway" / "Go back".
   Creating the same front in a *different* deck ("My words") saved without a warning,
   proving the duplicate check is scoped to the chosen deck.
3. **cards-phone.png** — 390×844 viewport: the form collapses to a single column and the
   toolbar wraps; all controls remain reachable.

## Also exercised through the UI in the same session

- Creating a card with English + Vietnamese back fields via the form ("Êm đềm, thanh
  bình" round-trips as UTF-8).
- "Save anyway" on the duplicate warning creates a second card with the same front in
  the same deck (senses stay separate; nothing is merged).
- Archive: the card left the Studying list, appeared under Archived with an
  "· archived" chip, and Restore returned it. Status messages confirmed both actions.

## Matching API journey on the same local Worker (curl)

create → 201 (empty optional fields omitted) · duplicate create → 409
`duplicate_possible` with `duplicateOf` · front-only create → 400 `validation` with
`fieldErrors.back` · PATCH → 200, `id`/`createdAt` unchanged · move → 200 with new deck ·
`GET /api/cards/duplicates` → matches · archive → excluded from `GET /api/cards`, present
in `GET /api/cards?archived=1` · restore → 200 · no session → 401 · wrong Origin → 403.
