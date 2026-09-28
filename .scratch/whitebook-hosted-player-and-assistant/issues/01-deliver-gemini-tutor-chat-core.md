# 01 — Deliver Gemini Tutor Chat core

**What to build:** A signed-in learner can open a separate Tutor Chat workspace tab, preview and consent to the exact text sent to Gemini, and hold a one-to-one conversation during the current browser visit. This is the first end-to-end use of the shared assistant request boundary for the later AI release.

**Blocked by:** None — can start immediately.

**Status:** complete

**Suggested model:** GPT-6 Astra — provider, privacy, consent, and session boundaries cross the browser and hosted API.

- [ ] Tutor Chat is a separate workspace tab. It starts with only the learner's typed prompt: no account, score, plan, deck, current question, or other Whitebook context is attached automatically.
- [ ] Shared and learner-provided Gemini routes are the only Tutor Chat routes. A personal credential is encrypted server-side, never returned in plaintext after save, and never appears in a model payload or log. Current model capability, quota, payer, price, and terms are shown before use; there is no silent provider switch.
- [ ] Before every send, the learner sees the exact capped prior turns and new prompt, route/model, payer, and any applicable price and terms. The authenticated send consumes the same short-lived server-owned payload snapshot; changed content, route, model, payer, terms, or expired consent requires a new preview and consent. No client-supplied account evidence or credential reference can override the server snapshot.
- [ ] The conversation persists across workspace-tab navigation in the same visit, ends on sign-out or browser-tab/window close, and does not become account chat history or sync across devices. Follow-up sends preview their included turns. English and Vietnamese response choices work where the selected model supports them.
- [ ] Account throttles, bounded turns and tokens, shared quota protection, offline/provider/quota/model/consent/timeout states, visible retry timing, and draft-preserving recovery work. Gemini failure does not block Attempt saves or ordinary study.
- [ ] Signed-in browser and authenticated API tests verify preview-to-send identity, redaction of system-added private fields, visit lifecycle, Gemini-only routing, credential secrecy, throttles, and failures. A controlled real-adapter failure check and current provider eligibility review gate enablement.
- [ ] No Tutor Chat control or Gemini runtime is enabled in the current hosted launch staging release; learner visibility requires the later AI release decision.

## Comments

### Agent investigation notes — 2026-09-28 (boundary mapping only; no files edited, no provider calls made)

#### Boundary map (what exists today)

**Auth/session.** Learner identity is Google OIDC with hashed, DB-backed sessions. `hosted/src/accounts.ts` owns everything: `currentSession()` (`hosted/src/accounts.ts:71`) resolves `__Host-wb_session` against `learner_sessions` (7-day TTL, `hosted/migrations/0002_learner_accounts.sql`), `requireMutation()` (`hosted/src/accounts.ts:78`) enforces same-origin + double-submit CSRF (`__Host-wb_csrf`, header `X-CSRF-Token`), `signout` (`hosted/src/accounts.ts:200`) deletes the session row server-side, and `renew` (`hosted/src/accounts.ts:210`) rotates both hashes. There is **no server-side "visit" concept** — the only per-browser scoping is the session row itself.

**API dispatch.** `hosted/src/worker.ts:145-198` is a flat route-table: each module exports a `*Route(request, env, now?)` returning `Response | null`, tried in order. Two worker-level details matter for any new `/api/assistant/*` namespace:

- `accountRoute` (`hosted/src/accounts.ts:272`) claims **all** `/api/auth/*` and `/api/account/*` paths (404 fallback), so assistant routes need their own prefix.
- The `catch` block (`hosted/src/worker.ts:192`) returns a JSON 503 only for a hard-coded prefix list (`/api/account/`, `/api/attempts`, …) — the new prefix must be added or failures return a bare empty 503.

**Attempt/review state the ticket depends on.** Active-attempt gating precedent: `hosted/src/review.ts:198-201` already denies guided review/notes while a Section Exam is `status='active'` (`409 active_section_exam`) — Tutor Chat availability should reuse exactly this query. Server-owned reveal state lives in `guided_reviews.revealed_at_ms` (`hosted/src/review.ts:10`; details at `hosted/src/review.ts:61-64` only emit `acceptedAnswers` when revealed); the attachment picker's "completed, answer-revealed review" can be resolved with the same query `hosted/src/review.ts:88-91` uses (any revealed review for that revision+question). Canonical presentations and accepted answers come from `publication_questions` / `publication_answers` (`hosted/src/library.ts:43`, `hosted/src/attempts.ts:386`).

**Client.** The hosted SPA is `web/src/account/AccountApp.tsx`: the workspace "tab" is the `view` state switch (`web/src/account/AccountApp.tsx:27`, nav buttons at 181-189). Any per-area component unmounts on tab switch, so visit-scoped chat state must be **lifted above `view`** (AccountApp state or a module-level store) to survive navigation. Mutations go through `mutate()` (`web/src/account/AccountApp.tsx:64-70`, CSRF header from `web/src/account/accountClient.ts:2`). Precedent for tab-close-scoped state: `web/src/account/HostedAttempt.tsx:104-110` uses `sessionStorage` for editor tokens/drafts.

**Test conventions.** Hosted API tests are vitest with hand-rolled SQL-prefix-matching DB fixtures (`hosted/test/accounts.test.ts:9`, `hosted/test/worker.test.ts:9`); routes take injectable `now: () => number` (`hosted/src/attempts.ts:843`, `hosted/src/review.ts:188`) for expiry tests, and `accountRoute` takes an injectable provider (`hosted/src/accounts.ts:262`) — the same seam pattern an injectable Gemini adapter should follow. Browser tests are jsdom + testing-library with `vi.stubGlobal("fetch", …)` (`hosted/../web/src/account/HistoryArea.test.tsx`).

#### Likely integration points, per requirement

- **Exact preview → send identity.** Add `hosted/src/assistant.ts` exporting `assistantRoute(request, env, adapter, now?)`, wired into `hosted/src/worker.ts` before the catch block. Preview (`POST /api/assistant/preview`) builds an immutable snapshot row (new migration; content JSON + `expires_at` + `account_id` + session-bound) using one serializer that both the preview response and the adapter call consume; send (`POST /api/assistant/send`) accepts only `{previewId}` and consumes the row (UPDATE…RETURNING or DELETE…RETURNING so a snapshot is single-use). The client holds the conversation in memory and posts capped prior turns + new prompt to preview; the server caps and re-serializes. Payer/route/model/credential are resolved server-side only — nothing about them is accepted from the body.
- **Consent expiry.** Snapshot TTL (short, e.g. 5–10 min, mirroring `FLOW_SECONDS` in `hosted/src/accounts.ts:28`) plus a visit-consent record keyed to (account, provider, flow, model, terms version) — server-side, TTL-scoped, single-consumable. The `now` injection pattern gives deterministic expiry tests. Changed model/payer/terms ⇒ the send path re-checks the consent row's model/terms against the snapshot's and rejects with `consent_required`.
- **Credential secrecy.** New migration (e.g. `0010_learner_gemini_keys.sql`): `id`, `account_id`, `ciphertext` (AES-GCM under a Workers secret KEK, new `Env` field like `ASSISTANT_KEY_KEK` alongside `STAGING_ACCESS_CODE` at `hosted/src/worker.ts:24`), `label_last4`, timestamps. Plaintext is returned once on save, never on read; the adapter receives the resolved key as an argument, never in payload JSON. `hosted/src/accountData.ts` is the critical touchpoint: the export allowlist comment (`hosted/src/accountData.ts:3-5`) says "Never SELECT * … future secret columns must stay server-side" — the key table must be **absent from `owned`** and **present in the delete order** (`hosted/src/accountData.ts:72-77`).
- **Throttling.** Nothing exists (no 429 anywhere in `hosted/src`). Add per-account counters (D1 rows: account, window start, requests/tokens) checked in `assistantRoute` before preview/send, returning `failure(429, "rate_limited", …)` with a `Retry-After` header and a retry-at timestamp in the body. A shared-quota circuit breaker is a second global counter row. Ordering is already safe: Attempt saves (`/api/attempts/write`) never touch assistant code, so Gemini exhaustion cannot block them by construction — the test just has to prove it.
- **Visit cleanup.** Conversation: in-memory above the `view` switch, cleared on `signOut()` (`web/src/account/AccountApp.tsx:119-129`), on `handleSessionEnded` (401s, `web/src/account/AccountApp.tsx:168-171`), and on tab death (automatic for in-memory state; `Clear-Site-Data: "cache"` at `hosted/src/accounts.ts:201` does **not** clear web storage — another reason not to use sessionStorage). Server-side artifacts: bind snapshot/consent rows to `session.token_hash` (or account+TTL) so sign-out orphans them, and add them to the `deleteAccount` batch. The worker has no cron trigger — expiry is read-time (`expires_at > now`) plus optional best-effort delete, same style as `oauth_flows` cleanup at `hosted/src/accounts.ts:151`.

#### Proposed tests

Authenticated API (vitest, fixture DB per existing conventions, injected fake adapter + injectable `now`):

1. **Preview-to-send identity** — preview a 3-turn conversation; capture the exact payload the adapter receives; assert byte-equality with the previewed content, including capped prior turns and no extra fields; send twice with the same `previewId` → second send fails single-use.
2. **No automatic account context** — adapter payload for a bare prompt contains only `{flow, locale, currentMessage, priorMessages}`; fixture account has nickname/scores/attempts present and none appear (also assert the preview's `neverSent` contract fields).
3. **Changed content invalidates** — preview, then send with different client content → rejected; snapshot content wins, client body ignored.
4. **Consent expiry** — freeze `now`, preview, advance past TTL, send → `consent_required`/`preview_expired`; same-TTL send succeeds; changed model/payer/terms row → consent re-required; consent from a different session/account rejected.
5. **Credential secrecy** — save personal key: response contains no ciphertext/plaintext; subsequent GET returns only label/last4; adapter receives key only as a non-serialized argument; fixture DB never stores plaintext; a client-supplied `credentialId`/`key` field in preview/send bodies is ignored or rejected; export contains no key rows; delete order removes key rows.
6. **Throttling** — N+1th send in a window → 429 with `Retry-After` and body wait time; counter is per-account (second learner unaffected); token cap exceeded → same; shared breaker open → `quota_exhausted` for shared route only; **and** `/api/attempts/write` still succeeds while the breaker is open.
7. **Gemini-only routing** — a request naming any non-Gemini route → rejected; no fallback when the Gemini adapter throws (error is `provider_error`, no second adapter call).
8. **Visit lifecycle** — sign-out then send with the old session → 401; snapshot rows of that session never reusable; account delete removes snapshot/consent/key rows; `GET /api/account/export` unchanged.
9. **Section Exam / reveal gating** — with an active section_exam row (fixture pattern from `hosted/test/review.test.ts`), preview → `409 active_section_exam`; attachment of an unrevealed review → `answer_not_revealed`; attachment resolves accepted answers only from `publication_answers` for owned, completed, revealed reviews (cross-account review id → 404).
10. **Worker seam** — unknown `/api/assistant/*` throw returns the JSON 503 shape (catch-block prefix list).

Signed-in browser (jsdom, `web/src/account/AccountApp.test.tsx` pattern):

11. Tab navigation round-trip preserves the conversation (rendered messages survive `view` switch away and back).
12. Sign-out clears the transcript and returns the tab to unavailable; simulated 401 (`onSessionEnded`) does the same.
13. Preview screen shows exact prompt/prior turns/route/payer before send; changing the draft after preview forces a new preview call (fetch spy sees a second preview before send).
14. Provider failure keeps the draft text in the input and renders the retry state; no queued auto-send.
15. No Tutor Chat tab renders when the AI release gate (env/flag) is off — this is the criterion-7 staging check.

#### Unresolved risks

- **"Visit" is undefined server-side.** In-memory client state means a page reload silently ends the conversation — probably correct (matches "tab/window close"), but the spec never says what F5/refresh does; decide explicitly, because sessionStorage would survive reload and blur the lifecycle story.
- **Client-supplied prior turns.** The design keeps the conversation out of the DB (`docs/design/assistant.md` §4.4), so prior turns must arrive from the client at preview time. That is acceptable only because the preview shows them verbatim — but the server must enforce role names, message count/size caps, and treat the whole conversation as learner-authored (no promise of redaction, §4.3). Fabricated "assistant" turns are possible by design; confirm the owner accepts that.
- **Where visit-consent lives** (D1 row with TTL vs. signed client token) is unsettled; a signed token is tamper-resistant but can't be revoked on sign-out, so DB rows keyed to the session are the safer default.
- **Model capability metadata** (vision, Vietnamese, price, terms version) must come from "a checked, current list" (`docs/design/assistant.md` §10.4) — no such catalog or refresh mechanism exists; this is an enablement-gate item, not just code.
- **No KEK/secret plumbing yet** — `hosted/wrangler.jsonc` has only `APP_ORIGIN` as a var; `ASSISTANT_KEY_KEK` / shared Gemini key must be added as secrets, and there is no local-dev story for them yet.
- **Worker CPU/subrequest limits** apply to adapter calls from the same Worker; the real-adapter failure rehearsal (criterion 6) should confirm timeouts stay within Workers limits before the gate.
