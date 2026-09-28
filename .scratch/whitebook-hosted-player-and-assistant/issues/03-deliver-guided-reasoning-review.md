# 03 — Deliver Guided Reasoning in question review

**What to build:** An eligible learner can open full-screen Guided Reasoning from question review, inspect staged help beside the canonical Question Presentation, and choose when to reveal the answer. Unsafe generated steps are withheld before reaching the learner.

**Blocked by:** 01 — Deliver Gemini Tutor Chat core.

**Status:** complete

**Suggested model:** GPT-6 Astra — the disclosure gate and server-owned reveal state require adversarial verification.

- [ ] Completed Attempt review, and explicitly Assisted Practice where eligible, offer Guided Reasoning; active Section Exams do not. Opening History or Results alone never sends a provider request.
- [ ] The wide-screen workspace uses the approved full-screen two-column layout with independently scrolling Question Presentation and guidance. The narrow screen uses a keyboard-operable Question/Guidance switch that preserves focus and both reading positions.
- [ ] The learner chooses English or Vietnamese guidance. Reasoning Steps and Reading Help appear in deliberate stages before answer reveal; the accepted answer and answer-specific explanation appear only after the server records **Show answer**.
- [ ] The server buffers and checks pre-reveal output for direct and answer-equivalent disclosure. Unsafe or uncertain text is withheld and replaced by a reviewed non-AI hint where available, otherwise by a clear unavailable state. The model cannot supply reveal state, grading, or an accepted answer.
- [ ] Reading evidence highlights only a matching span of reviewed text. Math help gives a standard worked solution and a Desmos approach only when useful. Unverified generated explanations are labeled; a learner may edit and explicitly save a Study Note or submit a previewed report.
- [ ] Browser and authenticated API tests cover layout and keyboard behavior, direct and paraphrased leakage, withholding and fallback, server-owned reveal, unmatched quotes, follow-up preview/consent, saved-note selection, and provider failure. A prompt-only or fixture-only pass is insufficient for the AI enablement gate.
- [ ] Guided Reasoning stays disabled in the current hosted launch staging release.

## Comments

**Investigation notes — pre-reveal leakage tests, seams, risks** (2026-09-28, read-only sweep of the hosted review/attempt/library code; no edits, no provider calls).

### Existing seams to build against

- **Server-owned reveal state.** `hosted/src/review.ts:59-65` — `details()` is the single read seam; `acceptedAnswers`, `originalResponse`, `retryResponse`, `retryCorrect`, `explanation`, `notes` are spread into the response only when `revealed_at_ms !== null`. This is the payload pattern the assistant envelope must copy (design §4.1: `acceptedAnswer` omitted entirely while hidden). `hosted/src/review.ts:118-137` — `reveal`/`retry` set `revealed_at_ms` via conditional `UPDATE ... WHERE revealed_at_ms IS NULL` with 409 `review_changed` on conflict; note **`retry` is itself a reveal**. Schema: `hosted/migrations/0007_guided_review_notes.sql:3-19`. Cross-attempt exposure computed in `hosted/src/review.ts:88-96`. Results exposes all answers post-completion regardless of review state (`hosted/src/attempts.ts:829-841`; practice submit exposes immediately at `attempts.ts:817-821`) — the browser legitimately holds the answer for completed attempts, so secrecy here is about the provider payload and generated output only.
- **Reviewed non-AI hint fallback.** `publication_review_help (revision_id, question_id, reviewed_hint, reviewed_explanation)` with a CHECK that at least one is non-null — `hosted/migrations/0007_guided_review_notes.sql:33-41`. Read at `hosted/src/review.ts:42-45`; hint action at `review.ts:108-117` returns `{ hint }` only pre-reveal (409 `review_revealed` after; 404 `hint_unavailable` when missing) and sets `hint_used = 1` atomically. `hintAvailable` in `details()` (`review.ts:61`); reviewed explanation returned only post-reveal (`review.ts:63-65`).
- **Eligibility/lifecycle.** `hosted/src/review.ts:83-105` — `start()` requires a completed Attempt and a wrong/unanswered question. Active Section Exam blocks the whole `/api/review/` surface (`review.ts:198-201`, 409 `active_section_exam`); the assistant route must inherit the same rule.
- **Presentation and quote seams.** Canonical presentation fetch without answers: `hosted/src/library.ts:43-52`. Hosted presentation v3 block kinds `text` / `reviewed_text` (runs with `emphasis`/`blank`) / `latex` / `asset` / `image_asset` — `web/src/account/HostedPresentation.tsx:8-14`; `reviewed_text` runs are the anchor for evidence-quote matching; no highlight/matching code exists yet. Math choices render via KaTeX (`HostedPresentation.tsx:16-29`).
- **Answer representation (defines "Math equivalents").** `publication_answers.accepted_answers_json` (`hosted/migrations/0004_curated_library.sql:38-44`). MC answers are single letters A–D (`hosted/scripts/prepare-publication.py:260-261`); SPR answers are free strings graded by trim + case-insensitive exact equality (`attempts.ts:394-395`, `review.ts:56-58`). Grading has no numeric/expression equivalence — the gate needs more equivalence power than grading and must not inherit its exact-match assumption.
- **Test prior art.** Worker/API: `hosted/test/review.test.ts` (fixture D1 stub + direct `reviewRoute` invocation); `hosted/test/worker.test.ts` for route-level. Browser: `web/src/account/HistoryArea.test.tsx` (mock-fetch review journeys); current review UI to extend is `web/src/account/HistoryArea.tsx` (hint line 216, Show answer 204/213, reveal-gated section 218-246, notes 230-245).

### Adversarial test list — pre-reveal leakage

All tests run at the authenticated boundary with a recording fake adapter (captures the exact payload, returns scripted completions). Core invariant: while `revealed_at_ms` is null, nothing the browser renders or the adapter receives contains the accepted letter, value, accepted choice text, or a unique identifier of the accepted choice. Use design §2.1 (R&W Transition, accepted C "Nevertheless,") and §2.2 (Math, accepted A `y = 3.5x + 15`) as fixtures.

**A. Direct disclosure (gate catches)**
1. Stage says "the answer is C" / "Đáp án là A" — withheld; fallback hint or `answer_withheld`; adapter payload never contained the key.
2. Stage echoes accepted choice text/LaTeX ("you should pick y = 3.5x + 15") — withheld.
3. Direct disclosure in Vietnamese output while `locale: "vi"` — same withholding.
4. Disclosure buried mid-stage after safe sentences — stage withheld entirely (all-or-nothing, no partial text).

**B. Paraphrase / answer-equivalent (R&W example)**
5. "Choose the word that signals contrast between the evidence and the skeptics" — uniquely identifies C given the choices; withheld as answer-equivalent (design §4.2 forbids conclusions that unambiguously identify the key).
6. Elimination narrowing to one survivor ("only one candidate remains") — withheld; pin the surviving-set-size rule (size 1 = leak, ≥ 2 = allowed).
7. Synonym/definition substitution ("the word meaning 'however'") — withheld.
8. Quote containing accepted choice text — gate must check model text against all presentation text including choices, not just the passage.
9. Safe control (design step 1: "Decide whether the two claims agree or contrast") — released unchanged, proving no over-withholding.

**C. Math equivalents**
10. Final-value derivation ("x = 16: 15 + 3.5 × 16 = 71, so check which choice matches") — withheld.
11. Parameter leak ("the slope is 3.5 and the fixed fee is 15") — reconstructs accepted A; withheld.
12. Algebraic variants of the accepted equation: `y = 15 + 3.5x`, `y = (7/2)x + 15`, `\frac{7}{2}x + 15`, `3.50x + 15` — all recognized; withheld.
13. SPR numeric-format variants: `71`, `$71`, `71.0`, `x = 16`, "16 hours", `7.1 × 10^1` — recognized as the accepted value; withheld. Pin equivalence tiers (normalized string → numeric evaluation → expression normalization); below-confidence = withhold.
14. Elimination-by-substitution ("B, C, and D all fail the (16, 71) check") — unique survivor; withheld.
15. Boundary case to pin as uncertain → withheld: "Type each equation and find which line passes through (16, 71)" — a method hint that doesn't name the answer, but hands over the Desmos approach held until post-reveal (design §1.3); assert gate defaults to withhold and the fallback fires.
16. Safe control (design step 1: "Identify what is fixed and what varies") — released.

**D. Gate mechanics and server authority**
17. Adapter-captured payload (not the UI) omits `acceptedAnswer` and the answer row pre-reveal; present post-reveal (design §4.1/§4.2).
18. Client-supplied `revealedState`/answer fields ignored; server resolves from `guided_reviews.revealed_at_ms` (design §4.1).
19. Snapshot immutability across reveal: preview opened while hidden, Show answer, then send — send consumes the hidden-state snapshot (no key) or is rejected; never silently upgrades to answer-aware content.
20. Reveal mid-generation: stages generated against hidden state stay gated; only post-reveal requests release answer-aware content.
21. Buffered release / no raw tokens: a rejected stage's browser response contains no fragment of the generated text (design §4.2). No streaming infra exists yet — this pins the contract for the transport.
22. Every follow-up turn re-gated: safe step 1, learner asks "so which is it?", leaking step 2 withheld; prior approved steps remain visible.
23. Conversation poisoning: learner pastes "I know it's C" — the gate still checks model output; learner text in prior turns never licenses the model to confirm.
24. Fallback correctness: unsafe stage + `reviewed_hint` present → reviewed hint via the existing seam (`review.ts:108-117`); row absent → clear `answer_withheld`, no fabricated content.
25. Grading authority: a failed stage never writes a response, `retry_response`, or `mistake_label`; retry grading goes through `POST /api/review/{id}/retry` only (`review.ts:118-137`).
26. Pre-reveal persistence blocks: Study Note save with leaked model content pre-reveal → 409 `review_hidden` (`review.ts:155`); report preview excludes withheld stages.
27. Eligibility/lifecycle: assistant route 409s during an active Section Exam like `review.ts:198-201`; 404 for another account's review id; 409 for a non-completed Attempt.
28. Provider failure pre-reveal: named failure state, previously approved steps kept, no fabricated answer-shaped content (design §5.4).
29. Post-reveal verification labels: worked solution contradicting the key is suppressed and replaced with the key-based explanation; unverified live help carries the "Not verified against the answer key" label (design §4.2, story 45).

**E. Quote anchoring (adjacent gate surface)**
30. Unmatched quote (different wording, whitespace, punctuation) → ordinary quoted text with "span not located", no highlight, passage unaltered (design §1.1(c)); matching runs against `reviewed_text` runs.
31. Region-image questions (Math stems, R&W image-fallback) → no highlight attempted at all (design §2.2 note).

### Proposed test placement

- New `hosted/test/assistantGate.test.ts` (or extend `review.test.ts`'s fixture style) for groups A–D at the authenticated boundary with the recording adapter, including active-exam denial and ownership; `worker.test.ts` style where the full worker matters.
- Extend `web/src/account/HistoryArea.test.tsx` (or a new GuidedReasoning-area test) for the browser-observable contract: withheld state copy, fallback hint display, `aria-live` announcements, narrow-screen switch sends no request (design §1.2).
- Real-adapter failure checks remain the AI enablement gate (spec Testing Decisions); a fixture-only pass is explicitly insufficient.

### Unresolved risks

1. **Ticket 01 blocker is real.** No request boundary, preview/snapshot, consent, throttle, or adapter code exists anywhere yet; every gate test depends on scaffolding that does not exist. Sequencing must respect that.
2. **Assisted Practice eligibility has no server seam.** `hosted/src/progress.ts:96-98` reads `state.assistedQuestionIds` / `grade.assisted` but nothing writes them; the "explicitly Assisted Practice where eligible" path cannot be tested end-to-end until ticket 02 builds the classification.
3. **The gate is heuristic by nature.** "Answer-equivalent" is not fully decidable without a CAS for SPR answers and a semantic model for paraphrases; the design itself calls it "a safeguard, not a proven guarantee" (§10.6). The tests pin the contract (withhold on uncertainty, never fabricate) but cannot prove absence of leaks.
4. **Equivalence tiers are undefined.** Expression/numeric normalization strength (units, fractions, LaTeX variants) is unspecified: over-narrow leaks, over-broad withholds legitimate hints. The elimination surviving-set-size rule (test 6) needs an explicit implementation decision.
5. **`prior_answer_exposure: "seen"` vs gate behavior.** A learner who saw the answer in Results still gets a hidden-state review; the gate presumably behaves identically for seen/possible. Pin deliberately with a test — and note the UI already surfaces the nuance (`HistoryArea.tsx:193-195`).
6. **Reviewed hints are assumed safe.** Nothing validates that `reviewed_hint` is itself answer-free; a cheap hygiene test (hint must not contain the accepted letter/value/choice text) would close that hole.
7. **No streaming infrastructure exists**; buffer-before-release (design §4.2) has an open transport decision (per-stage response vs SSE), which affects how "no partial text" is assertable.
8. **Gate language coverage.** Withholding must work on Vietnamese output (test 3); if the gate ever uses model-based classification, its own language coverage becomes a dependency — deterministic checks are safer.
