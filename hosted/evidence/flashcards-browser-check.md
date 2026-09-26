# Ticket 10 — Due Flashcards and Starter Decks browser check (local Worker + seeded session)

Date: 2026-09-26. Environment: `wrangler dev --local --port 8799` against the real Worker code
(with `APP_ORIGIN` overridden to the local origin so same-origin mutations work) and a local D1
database with migrations 0001–0005 applied plus the reviewed deck bundle imported through
`hosted/scripts/build-deck-import.mjs` (`anki_starter` v2, 839 cards; `b2c1_1000` v3, 1,000 cards;
`c1c2_wic500` draft refused). The Learner Account and `__Host-wb_session`/`__Host-wb_csrf`
cookies were seeded directly into local D1 and injected in the browser; no Google OAuth was
exercised — that journey's evidence lives in ticket 03.

## Journey performed in the real browser (screenshots in this directory)

1. **study-overview-desktop.png** — Dashboard → Flashcards opens the new Study tab: "Study day:
   Sunday, September 27" (device zone Asia/Bangkok, labeled "from this device"), "Start studying
   (1838)" (1,839 minus the one card rated earlier via the API journey), and the Starter decks
   list with version chips (`v2`, `v3`), due counts, and the note "Shared by Whitebook and the
   same for every learner. Only your ratings and due dates are private."
2. **study-session-revealed.png** — "Start studying" opens the reveal-and-rate session on card
   1 of 1838 ("novelty", Anki starter). Next/Previous navigated between cards with the back
   hidden and no rating controls present; after "Show answer" the back fields (Vietnamese
   meaning, part of speech, English + Vietnamese example, CEFR chip) appear together with the
   Not sure / Sure buttons.
3. **study-session-phone.png** — 390×844 viewport: the session collapses to one column; the
   rated card shows the "Rated Not sure · next due 2026-09-28" chip and keeps its back visible
   when navigated back to; progress reads "Reviewed 1 of 1838".

## Behaviors verified in the same session

- **Navigation never rates.** Next → Previous round-trip produced zero rating POSTs ("Reviewed
  0 of 1838" unchanged) and the rating controls only exist after "Show answer".
- **Not sure schedules +1 local day.** Rating "novelty" Not sure on the Sep 27 local study day
  recorded `next_due 2026-09-28` with `rating_zone` of the rating-time zone (Asia/Bangkok from
  the device; an earlier API rating in Asia/Ho_Chi_Minh recorded that zone). The card left the
  due queue and the reviewed count advanced to 1.
- **A failed save is honest.** Before the CSRF cookie was injected, the rating attempt showed
  "Your rating was not saved. Check your connection and try again — the card stays in place."
  and did not advance or count the card as reviewed.
- **Saved IANA zone.** Account → "Time zone" → `Asia/Ho_Chi_Minh` → "Save time zone" saved to
  the account; the Study overview immediately re-labeled the study day chip "Asia/Ho_Chi_Minh
  (saved to your account)". The stored rating rows above were untouched by the change.
- **English UI chrome** throughout; Vietnamese text appears only as card content.
- **No draft content.** D1 contains zero `starter_deck_versions` rows with status other than
  `published` — the draft deck was refused at import and cannot be served.

## Matching API journey on the same local Worker (curl)

- `GET /api/cards/study?zone=Asia/Ho_Chi_Minh` → 200, studyDate 2026-09-27, both decks with
  due counts, `zoneSource: "device"`.
- `POST /api/cards/study/rate` (starter card, not_sure, requestId) → `{applied: true, dueDate:
  "2026-09-28"}`; replaying the same requestId → `{applied: false, dueDate: "2026-09-28"}` with
  exactly one event row (one rating applied once).
- Zone change without rewrite: saving the account zone and re-reading the overview returns the
  new zone's study date while stored `next_due` values stay untouched (full coverage of the
  midnight / travel-day / overdue cases lives in `hosted/test/schedule.test.ts` and
  `hosted/test/study.test.ts` with controlled clocks).
