# 04 — Deliver Flashcard Assistant for Personal Decks

**What to build:** A learner can ask Gemini to draft several Personal Cards from chosen words, review the batch, and save it to one chosen Personal Deck. The same assistant can give visit-only learning advice for one explicitly selected deck.

**Blocked by:** 01 — Deliver Gemini Tutor Chat core.

**Status:** complete

**Suggested model:** GPT-6 Astra or Sol — the batch save and private deck preview require a complete browser-to-API slice.

- [ ] Flashcard Assistant appears within Personal Decks, separate from Tutor Chat. The learner can paste a bounded word list or explicitly select Personal Cards as source words; exact words, optional context, chosen deck, Gemini route/model, payer, and terms appear in the request preview.
- [ ] Gemini proposes a bounded batch of ordinary Personal Card fields without saving or publishing anything. The learner can edit or remove individual drafts, see duplicate and validation findings, and choose one existing or newly named Personal Deck.
- [ ] One **Save all** confirmation stores exactly the visible reviewed batch atomically, after server validation of fields, duplicates, and account ownership. A failure leaves the entire draft intact; existing cards are never silently overwritten or moved.
- [ ] For deck advice, the learner selects one Personal Deck and previews its exact card text and compact due/rating summary before consent. No other deck or full rating history is sent. Advice disappears with the visit unless the learner separately saves reviewed card content.
- [ ] Starter Decks remain read-only. Manual Personal Card editing and the existing Not sure / Sure schedule continue when Gemini is unavailable.
- [ ] Signed-in browser and authenticated API tests cover input isolation, preview-to-send identity, draft editing/removal, duplicates, all-or-none Save all, failed-save recovery, selected-deck advice, visit expiry, and Starter Deck protection.
- [ ] Flashcard Assistant remains disabled in the current hosted launch staging release.

## Comments

### Investigation note — 2026-09-28 (Personal Deck/Card map; no code changed)

Scope of the read: ticket 04, the spec, ticket 01, and the deck/card code. No files edited, no provider calls. The Not sure / Sure schedule is untouched.

#### Behavior map — Personal Deck/Card creation and rating

**Creation and content (server) — `hosted/src/cards.ts`**

- Routes at `cards.ts:277-294`: `GET/POST /api/cards`, `GET /api/cards/duplicates`, `GET/PATCH /api/cards/:id`, `POST /api/cards/:id/(move|archive|restore)`. Wired in `worker.ts:173-175` after `studyRoute`.
- Auth: session cookie `__Host-wb_session` resolved by `currentSession` (`accounts.ts:71-76`); every mutation passes `requireMutation` (`accounts.ts:78-85`) = same-origin check against `APP_ORIGIN` + CSRF header (64-hex, sha256 matches `session.csrf_hash`).
- Field validation (`cards.ts:62-70`, limits at `31-34`): front required, ≤240 chars; at least one back field required; each back field ≤2,000 chars; deck ≤80 chars (default `"My words"`, `cards.ts:35,187`); body ≤16 KiB; unknown keys rejected (`cards.ts:171-172`). Errors return 400 with structured `fieldErrors`.
- Ownership: every read/write goes through `ownedCard` filtering `account_id` (`cards.ts:127-130`); another learner gets 404, not 403 (deliberate opacity, proven in `cards.test.ts:283-311`).
- Deck is a free-form string, not an entity: cards store `deck` + normalized `deck_key`; there is no deck table. "Moving" only happens via the move endpoint (`cards.ts:243-262`); PATCH rejects a `deck` key (`cards.ts:211-212`).

**Duplicates (server) — the part Save all must reuse**

- Match rule: exact-normalized `(account_id, deck_key, front_key)` where normalize = collapse whitespace, trim, lowercase (`cards.ts:37`, `findDuplicate` at `118-125`). Not fuzzy; same front in a *different* deck is intentionally allowed (`cards.test.ts:172-183`). Archived cards still match (ordered non-archived first).
- Gate: 409 `duplicate_possible` with a `duplicateOf` payload (`cards.ts:79-90`), overridable per request by `confirm: true` (`cards.ts:188-189`) — confirmed duplicates are a *product feature* ("different senses stay separate"). The UI pre-checks via `/api/cards/duplicates` then always sends `confirm: true` (`PersonalCards.tsx:129-136,151`).
- Known asymmetry: PATCH/edit does **no** server-side duplicate check (only the client checks, `PersonalCards.tsx:156-159`); move does (`cards.ts:256-257`).
- Schema has **no UNIQUE constraint** on `(account_id, deck_key, front_key)` (`migrations/0003_personal_cards.sql:1-20`) — it can't have one, because confirmed duplicates must remain insertable. Duplicate prevention is purely application-layer, so a duplicate SELECT-then-INSERT has an inherent race window.

**Rating (server) — must not change**

- Routes at `study.ts:294-305`: study overview, due queue, `POST /api/cards/study/rate`.
- The schedule lives only in `schedule.ts:10,45-47`: `not_sure` → next local calendar day, `sure` → +4 calendar days, pure date-only math; stored `YYYY-MM-DD` due dates are never rewritten by zone changes or edits. Due = never rated or due ≤ today (`schedule.ts:50-52`).
- Idempotency: `eventId = sha256(accountId:requestId)`, `INSERT ... ON CONFLICT DO NOTHING` (`study.ts:256-267`); a retried requestId returns `applied: false` with the stored due date. requestId must be 8–100 chars (`study.ts:245-247`).
- Current due state is *derived*, never stored on the card: latest `card_rating_events` row per card wins (`study.ts:61-63`, same-second tie → last inserted wins, `study.test.ts:191-201`). Content edits never touch rating events (`cards.test.ts:185-218`). Rating an archived or unowned card → 404 `not_in_study` (`study.ts:260-263`).
- Zone precedence: saved account zone → device zone → UTC (`study.ts:29-41`).

**UI and surrounding facts**

- `web/src/account/FlashcardStudy.tsx` hosts a Study/"My cards" tab pair (`:93-101`); `PersonalCards.tsx` is the card manager (create/edit/move/archive with the duplicate warning dialog at `:282-290`). The rating UI sends `{ref, rating, requestId: crypto.randomUUID(), zone}` (`FlashcardStudy.tsx:239-250`); navigation between cards never creates a rating.
- `personal_cards` and `card_rating_events` already participate in export/deletion (`accountData.ts:9-11,70-71`).
- Starter Deck content has no learner write path anywhere in `hosted/src` (owner import only).
- **No batch endpoint and no `env.DB.batch()` usage exist yet** — every write today is a single prepared statement.
- Ticket 01 (Gemini boundary) is not implemented in this worktree, but Save all does not depend on it.

#### Proposed test cases (schedule unchanged)

Prior art and seam: `hosted/test/cards.test.ts` and `hosted/test/study.test.ts` run the real route modules against `node:sqlite` built from migrations, with two pre-seeded accounts/sessions (A/B) and a `request()` helper. Web tests are jsdom + fetch stubs (`web/src/account/PersonalCards.test.tsx:14-24`). All new cases fit those seams.

**Duplicate**

1. Save all containing a draft whose normalized front matches an existing card in the target deck → 409 (or batch findings response) naming `duplicateOf`; assert `personal_cards` count unchanged.
2. Same front in a different destination deck saves without warning (mirror `cards.test.ts:172-183`).
3. **Batch-internal duplicates**: two drafts in the same request whose fronts differ only by case/whitespace → flagged (new case; single-card flow can't produce this).
4. Draft matching an *archived* card → flagged with archived status surfaced (match rule includes archived, `cards.ts:118-125`).
5. Confirmed-duplicate semantics for a batch (see risk 1): whatever the resolution, assert existing cards are never overwritten or moved — deck of the pre-existing "bank" card unchanged after Save all.
6. Mixed validity: one draft missing front / over-length field / unknown key → whole request rejected with per-draft `fieldErrors`, zero rows inserted.

**Ownership**

7. Learner B's Save all is unaffected by learner A's identical fronts; B's duplicate scan only sees B's cards (account-scoped `deck_key` match).
8. Save all without session → 401; wrong Origin → 403 `invalid_origin`; missing/bad CSRF → 403 `invalid_csrf` (mirror `cards.test.ts:313-333`).
9. Destination deck >80 chars → validation error; omitted deck → "My words"; deck name normalization agrees with the study filter `personal:Deck name` (`study.ts:45-59`) so a saved batch is immediately filterable.
10. Starter Deck protection: after Save all, `starter_deck_cards`/`starter_deck_versions`/`starter_card_rating_events` row counts are unchanged, and no request body variant can name a starter deck as destination.
11. Batch-saved cards appear in account export (`accountData.ts:9`) and are covered by deletion.

**Atomic Save all**

12. Success path: N reviewed drafts → exactly N rows in one response, echoed cards identical to the request (preview-to-send identity at the data layer), `archived=false`, **no** `card_rating_events` rows created; the study overview then shows N due in that deck (never-rated cards are due immediately, `schedule.ts:50-52`).
13. All-or-none on validation failure (overlaps case 6) and on mid-batch failure: force a failure after the first insert (FK violation via a planted bad reference, or a `batch()` that throws in the fake) → assert zero rows written.
14. Double-submit: two identical Save all requests in quick succession → defined behavior (likely second request all-409 as duplicates); pin it in a test.
15. Schedule regression guard: rate a batch-saved card `not_sure` then `sure` → due dates still +1/+4 days with the existing event semantics (reuse the assertion style of `study.test.ts:160-189`); assert `schedule.ts` constants untouched.
16. Deck-advice payload (second half of the ticket): for one selected deck, response contains only that deck's card text plus compact due counts — assert no other deck's cards and no raw `card_rating_events` history leak, and nothing persists server-side.

**Web tests** (jsdom, fetch-stub pattern): draft edit/removal before save, duplicate findings rendered per draft, failed Save all (fetch rejects/500) leaves the full draft in state with a retry path, one Save all confirmation only, and Starter Deck surfaces untouched.

#### Unresolved risks

1. **Duplicate policy for Save all is undefined** — the biggest decision before implementing. Single-card create allows `confirm: true` to keep both senses. For a batch: fail the whole batch on any duplicate, return per-draft findings for the learner to resolve, or accept per-draft confirm flags? This shapes the response contract and tests 1/5/14.
2. **Atomicity primitive vs. test harness**: real D1 `env.DB.batch([...])` is transactional, but the test fakes (`cards.test.ts:13-37`, duplicated in `study.test.ts:28-54`) implement only `prepare` — no `batch`. The harness must be extended (and ideally de-duplicated into a shared fake) before case 13 is writable. Do not implement Save all as N sequential create/PATCH calls — that forfeits atomicity and, via PATCH, would skip the server duplicate gate entirely.
3. **Race window is structural**: no UNIQUE index can be added without breaking confirmed duplicates, so two concurrent Save alls can both pass the pre-check. Accept and document, or add post-insert verification inside the transaction.
4. **Batch bounds unspecified**: the spec requires "bounded bulk batches" (`spec.md:108`) but no number exists. A max-drafts constant and total body cap need an owner decision (single card today: 16 KiB, `cards.ts:34`).
5. **Staging gating has no mechanism**: no feature-flag infrastructure exists in `AccountApp.tsx`; "remains disabled in the current hosted launch staging release" currently just means "don't ship the UI". Confirm that is sufficient.
6. **"Signed-in browser tests" seam**: there is no Playwright/browser-driver suite — the closest seams are jsdom component tests plus the staged rehearsal evidence process (`hosted/evidence/`). Confirm what counts as the "signed-in browser" evidence for this ticket's checkbox.
7. Ticket 01 is unimplemented in this worktree, so the draft-generation half of ticket 04 (Gemini proposals, preview/consent) has no shared boundary to build on yet; only the Save all endpoint, duplicate/ownership validation, and deck-advice read path are buildable now.
