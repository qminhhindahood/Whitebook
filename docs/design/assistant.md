# Whitebook Assistant — interaction and data-boundary design

Status: design-only deliverable for ticket 14 (`.scratch/whitebook-account-learning-update/issues/14-assistant-design.md`).
Date: 2026-09-26.
Audience: owner review before any provider integration work in the later AI tranche.

**What this artifact is.** A complete, reviewable design for future Gemini-backed study
help: where each flow appears on desktop and narrow screens, what content the model
receives, what the learner consents to, how the answer key stays authoritative, and
which future backend boundaries protect learner data.

**What this artifact is not.** It ships no code path. This tranche implements no live
provider call, stores no provider secret, generates no AI content, and renders no
inactive Assistant button. Every UI element described here is marked *(future)* and is
listed in §9 as explicitly not built. When the AI tranche lands, it must re-verify the
gates in §10 before any learner-visible control appears.

---

## 0. Design principles (from the spec)

1. **Opt-in, per flow, per provider.** Nothing calls a provider without a content
   preview followed by consent scoped to that provider and flow (spec stories 68–69).
2. **The answer key is authoritative.** AI explains; it never regrades, never overrides
   an accepted answer, and its live output is labeled unverified until checked against
   the key (stories 61, 46; spec §Assistant design).
3. **Minimal envelope.** The request carries the canonical Question Presentation for one
   question plus the learner's response — never a Source PDF, source path, account
   email, API key, full Test Package, full Attempt, or diagnostic logs.
4. **No chat history.** Ordinary AI conversations live for the visit and disappear;
   only an explicitly saved Study Note persists (story 63).
5. **AI is optional everywhere.** Every flow has a non-AI path that keeps working when
   providers are blocked (stories 36, 91; spec quota circuit-breaker).
6. **Domain vocabulary.** Guided Reasoning, Reasoning Steps, Reading Help, Assisted
   Practice, Image Fallback, Reviewed Question Text, Study Note, and Shared AI Access
   are used exactly as defined in `CONTEXT.md`.

---

## 1. Entry points and flow map

Seven future flows. Each is reachable only from states where the spec permits AI:

| # | Flow | Entry point | Available when | Non-AI fallback |
| --- | --- | --- | --- | --- |
| F1 | Question explanation | Completed Attempt review (from History → Results → a wrong or unanswered question) | After the Attempt is completed | Try again / Show answer guided retry (ticket 11 behavior) |
| F2 | Reasoning Steps (staged Guided Reasoning) | Same review surface, Reading and Writing questions | After completion; or Assisted Practice while active | Reviewed non-AI hint where one exists |
| F3 | Reading Help (passage-first comprehension) | Inside F2 for Reading and Writing, before answer reveal | Same as F2 | Same as F2 |
| F4 | Math worked solution + optional Desmos approach | Same review surface, Math questions | Same as F1 | Standard written solution is human-authored; licensed calculator remains the tool |
| F5 | Flashcard drafting | Personal Card editor ("Draft with AI (future)") | Anywhere Personal Cards are editable | Manual entry; Flashcards never require AI (story 36) |
| F6 | Study Plan suggestions | Study Plan editor ("Suggest with AI (future)") | A saved plan exists or can be created deterministically first | Deterministic evidence-based plan (ticket 13) always available |
| F7 | Follow-up questions | Reply box inside any F1–F4 conversation, in English or Vietnamese | Same visit as the parent conversation | Re-reading the explanation; Study Note |

Availability rules (spec; restated because they are acceptance gates):

- Guided Reasoning (F2–F3) appears **after a completed Section Exam Attempt** and in
  **explicitly marked Assisted Practice**. It never appears during an active Section
  Exam Attempt. A future Simulation Attempt follows the same restriction — as the spec
  itself requires ("The design should describe how a future Simulation Attempt follows
  the same restriction"): its modules close permanently, and only the completed review
  may offer AI help.
- Help used during Practice marks that question **assisted**, stored separately from the
  Attempt score; Raw Accuracy never changes (stories 43, 56–57).
- Opening History or Results never triggers a provider call. The Assistant exists only
  where the learner explicitly invokes it.
- Study Notes are hidden during active Section Exam Attempts, and so is every AI surface.

### 1.1 Desktop flow — Reading and Writing explanation with Reasoning Steps (F1 → F2 → F3)

Wide screen keeps the passage and the guidance side by side (story 50). The reviewed
passage stays the visual anchor; the Assistant panel is a white card on the canvas per
the indigo design system, never an overlay over the text.

```
┌─ Whitebook — Results — Question 14 of 27 ─────────────────────────────────────┐
│  August R&W · Revision 5 · Word in Context        [history position preserved]│
├───────────────────────────────┬───────────────────────────────────────────────┤
│  PASSAGE (Reviewed Text)      │  QUESTION 14 · You chose B · Accepted: C      │
│                               │  ┌─────────────────────────────────────────┐  │
│  As reproduced in the player: │  │ stem + choices A–D, your response and   │  │
│  selectable reviewed text,    │  │ the accepted answer marked (revealed    │  │
│  with your highlights         │  │ state shown as the learner revealed it) │  │
│  restored from the Attempt.   │  └─────────────────────────────────────────┘  │
│                               │  ┌─ Assistant (future) ────────────────────┐  │
│  [quotable span] A word the   │  │ Explain this question   [Ask why (F1)]  │  │
│  learner can highlight in the │  │ ── after F1 ───────────────────────────  │  │
│  original Attempt is          │  │ One-paragraph why-C answer.             │  │
│  selectable here too.         │  │                                         │  │
│                               │  │ ▸ Reasoning Steps (F2)  Step 1 of 3     │  │
│  (F2 can quote evidence: the  │  │   [Reveal step 2]  [Reveal all]         │  │
│  quoted span highlights the   │  │ ▸ Reading Help (F3)                     │  │
│  matching reviewed text and   │  │ ▸ Ask a follow-up (F7)…                 │  │
│  fails safely when it cannot) │  │ ▸ Save as Study Note   ▸ Report         │  │
└───────────────────────────────┴─┴──────────────────────────────────────────┘
```

Annotations:

- **(a) Answer reveal is learner-controlled.** The review surface the learner came from
  decides whether the accepted answer is visible; the Assistant inherits that state and
  never reveals the answer on its own. If the learner entered from the answer-hidden
  guided retry, the Assistant panel shows Reading Help and Reasoning Steps but the
  accepted answer area stays masked until Show answer (story 38).
- **(b) Reasoning Steps are staged** (story 52): step 1 states the task ("decide what
  *resigned* conveys here"); each later step is revealed by an explicit action so the
  learner can predict the evidence or next move first. Steps are numbered, and "Reveal
  all" is available for quick review.
- **(c) Evidence anchoring (story 54).** When a step or explanation quotes the passage,
  the quote is attached to a span of the Reviewed Question Text. The design: the model
  returns quotes, the client attempts an exact/normalized match against the reviewed
  text blocks, and matched spans highlight (indigo tint, the selection-halo family).
  **Fail-safe:** an unmatched quote renders as ordinary quoted text with a "span not
  located" marker and no highlight — the passage is never altered and no span is
  invented (story 55's principle applied to text).
- **(d) Reading Help (F3)** answers "what does the passage say / what does this word
  mean here" without stating the accepted answer; the panel notes the answer remains
  hidden (story 53).

### 1.2 Narrow-screen flow — the same flows with an explicit switch

Story 51: on a narrow screen the passage and the guidance share one column with a
segmented switch (the DESIGN.md segmented-tile pattern), defaulting to **Passage**.

```
┌─ Results · Q14 ────────────────────────────┐
│  ┌─────────────┬───────────────┐           │
│  │ ● Passage   │   Guidance    │  ← switch │
│  └─────────────┴───────────────┘           │
│  ┌─────────────────────────────────────┐   │
│  │ PASSAGE: reviewed text, scrollable, │   │
│  │ evidence highlights visible here    │   │
│  └─────────────────────────────────────┘   │
│  [Switch to Guidance to see steps]         │
│  … Guidance tab shows the full Assistant   │
│  panel: explanation, Reasoning Steps,      │
│  follow-up, Save as Study Note, Report.    │
│                                            │
│  Question + choices remain their own       │
│  section above the switch (always reach-   │
│  able by scrolling; never hidden by it).   │
└────────────────────────────────────────────┘
```

- Switching tabs never re-renders the question state, never triggers a provider call by
  itself, and preserves scroll position in each tab.
- An evidence quote produced while the learner reads the Guidance tab shows an inline
  "Show in passage" link that flips the switch and scrolls to the highlighted span.
- The switch is keyboard-operable (radio semantics, arrow keys, per the score-band
  accessibility pattern the spec requires for bands).

### 1.3 Desktop flow — Math explanation with standard solution and Desmos approach (F4)

```
┌─ Whitebook — Results — Question 6 of 22 ──────────────────────────────────────┐
│  September Math · Revision 4 · Algebra                                       │
├──────────────────────────────────┬────────────────────────────────────────────┤
│  QUESTION 6                      │  Assistant (future)                        │
│  ┌────────────────────────────┐  │  Why A: one-paragraph answer.              │
│  │ Source visual (region) —   │  │                                            │
│  │ per ADR-0006 Math question │  │  ▸ Worked solution (standard, staged):     │
│  │ content is a confirmed     │  │    1. Set up the equation from the         │
│  │ region image, not text.    │  │       constraint.                          │
│  └────────────────────────────┘  │    2. Solve for x. [Show step]             │
│  Choices A–D: reviewed text /    │    3. Check against the accepted answer.   │
│  reviewed LaTeX, your choice C   │  ▸ Desmos approach (only when it helps):   │
│  marked wrong, accepted A.       │    y = 3.5x + 15  and  y = 71               │
│                                  │    → inspect the intersection; x = 16.     │
│                                  │  ▸ Why C fails, why B and D fail.          │
│                                  │  ▸ Follow-up · Save note · Report          │
└──────────────────────────────────┴────────────────────────────────────────────┘
```

- **Standard worked solution first** (story 58): algebraic reasoning a learner can
  follow with pencil and paper. It remains fully usable if the calculator embed is
  unavailable (spec §Assistant design).
- **Desmos approach is conditional** (story 59): the design requires the model to
  answer an explicit "does graphing genuinely help here?" check (e.g., intersection of
  two functions → yes; pure symbolic simplification → the panel says so and omits the
  section). When present it gives **exact expressions to type and what to inspect**
  (story 60), never vague advice. The licensed calculator remains the interactive tool;
  these are written instructions, not an embedded graph.
- **Answer-key verification:** the worked solution's final value and every Desmos
  observation used as an answer claim are checked against the accepted answer before
  being presented as correct (§4.2). Unverified live help is labeled as such (story 61).

### 1.4 Flow — Flashcard drafting (F5)

Entry: the Personal Card editor gains one future control, "Draft with AI". The learner
supplies the front (word or phrase) and, optionally, context; the flow is exactly the
preview → consent → proposal pattern of §3:

```
  Front: "tenuous"          [Draft with AI (future)]
        ↓ (preview of what will be sent: the word, chosen deck language,
          optional selected context; provider; model)  → consent
        ↓
┌─ AI proposal (future) ───────────────────────────────────────┐
│  Vietnamese meaning: (draft)   [editable]                    │
│  Example sentence:  (draft)    [editable]                    │
│  Drafted by gemini-…flash · today   ← AI-derived marker      │
│              [Save card]   [Discard]   [Edit manually]       │
└──────────────────────────────────────────────────────────────┘
```

- Nothing from the proposal becomes a card without the learner inspecting and saving it
  (story 33). The saved card records nothing about the conversation itself; it is an
  ordinary Personal Card, optionally tagged with the drafting provider/model/date as
  AI-derived metadata (mirroring story 66 for notes).
- AI unavailable → the editor is exactly today's manual editor (story 36). The control
  is hidden, not disabled, while no provider is configured — the same rule that keeps
  any dead Assistant button out of this tranche.

### 1.5 Flow — Study Plan suggestions (F6)

Entry: the Study Plan editor's future "Suggest with AI" action. The prompt uses
**aggregate evidence and the activity catalog only — no question content by default**
(spec §Assistant design): counts by Question Category and Content Domain mapping, due-card
totals, recent attempt summaries (scores/counts, not question text), selected SAT dates,
study days/minutes/rest days, optional goal. Any task the model proposes is validated by
the backend against real dates, real Test Packages, supported categories, evidence links,
available minutes, and rest days before it can be saved; invented packages, unsupported
score promises, and overfull days are rejected (ticket 13's deterministic rules apply
unchanged). The learner sees each proposed task with its evidence explanation before
accepting; the deterministic plan remains the always-available baseline (story 91).
Proposals may be in the learner's chosen response language; stored plan data stays
language-independent with UI chrome in English (spec i18n rule).

### 1.6 Flow — follow-up questions (F7)

A reply box at the bottom of the explanation panel, accepting English or Vietnamese
(story 49). Follow-ups stay within the visit-scoped conversation of the parent flow
(§6). Language choice is per conversation, remembered for the visit, never persisted as
an account default without a future explicit setting.

### 1.7 Narrow-screen behavior for the remaining flows

The website's phone layout rule (spec: "Support a phone layout for Dashboard,
Flashcards, Study Plan, Notes, and completed review") applies to every Assistant flow.
Math, Flashcard drafting, and Study Plan suggestions are single-column surfaces, so
their narrow-screen treatment is a stacking and overlay discipline, not a switch:

- **Math help (F4) on a narrow screen.** The question region image, choices, and
  Assistant panel stack vertically in review order. The worked solution's expressions
  render in a horizontally scrollable block so LaTeX never wraps into nonsense; a
  "Back to question" affordance anchors between solution steps and the region image,
  since the visual is the question. The Desmos approach lists expressions as copyable
  rows for pasting into the calculator (the calculator itself opens as today's overlay).
- **Flashcard drafting (F5).** The proposal card is already a modal on desktop; on a
  narrow screen it becomes a full-height sheet with the editable fields stacked, the
  AI-derived marker pinned at top, and Save/Discard actions in a sticky footer — same
  inspect-before-save rule, no content hidden below the fold without scrolling past it.
- **Study Plan suggestions (F6).** The suggestion drawer opens as a bottom sheet over
  the plan editor. Each proposed task card shows evidence, duration, and accept/edit
  controls; the deterministic plan remains visible and editable beneath the sheet, so
  rejecting AI help never blocks the manual or deterministic path.
- **Consent and report previews (§3.1, §3.6) on a narrow screen** use the same
  full-height sheet pattern: the content preview (or actual image, at transmit size)
  and the consent actions are both reachable without scrolling the actions off-screen.

### 2. Worked examples

Both examples are original instructional content written for this design (no College
Board material). Each shows the **complete Question Presentation context** the model
would receive, the progressive hints, evidence anchoring, the answer reveal, and the
why-wrong-choices explanation.

### 2.1 Reading and Writing example (Word in Context)

**Reviewed Question Presentation (contract v1, `web/src/types.ts`):**

```jsonc
{
  "version": 1,
  "stimulus": [
    { "kind": "text", "text": "Biologists once assumed that the fungal networks binding many forest soils were incidental to tree survival. Ecologist Suzanne Simard's isotope-tracing experiments, however, showed that carbon compounds moved between pine seedlings through those networks, and that seedlings with access to a mature tree's network grew at markedly higher rates. ______ some researchers still describe the networks as curiosities, the experimental evidence supports a more central role." }
  ],
  "stem": [
    { "kind": "text", "text": "Which choice completes the text with the most logical transition?" }
  ],
  "choices": [
    { "id": "A", "content": [{ "kind": "text", "text": "Consequently," }] },
    { "id": "B", "content": [{ "kind": "text", "text": "Likewise," }] },
    { "id": "C", "content": [{ "kind": "text", "text": "Nevertheless," }] },
    { "id": "D", "content": [{ "kind": "text", "text": "In other words," }] }
  ]
}
```

`accepted_answers: ["C"]`, `category: "Transition"`, learner response: **B**.

**Minimal envelope sent to the provider** (§4.1): this presentation verbatim, the
accepted answer `C`, the learner response `B`, the category, the revision identity, and
prior messages of this visit-scoped conversation. Nothing else.

**Progressive interaction:**

1. **Reasoning step 1 (task):** "Decide how the second clause relates to the first:
   same direction, or contrast?" The learner is invited to answer before revealing more.
2. **Reasoning step 2 (evidence, anchored):** "The experiment shows networks help
   seedlings, so the evidence points one way — but some researchers still call them
   curiosities, the opposite direction. Quote check: 'some researchers still describe
   the networks as curiosities'." The client matches that quote against the reviewed
   stimulus text and highlights the span. If matching failed (say the reviewed text
   used a different wording), the quote would render unhighlighted with a "span not
   located" marker — no invented evidence (story 55's fail-safe).
3. **Reasoning step 3 (decide):** "A contrast transition is needed: *Nevertheless*."
4. **Answer reveal (only on learner action or already-revealed state):** accepted
   answer **C**.
5. **Why the learner's choice fails (story 48):** "*Likewise* (B) signals similarity,
   but the clause that follows contradicts the evidence — it cannot introduce an
   opposing view." **Why the others fail:** "*Consequently* (A) claims cause and
   effect between experiment and skepticism, which is backwards; *In other words* (D)
   restates rather than contrasts."
6. **Follow-up (F7)** in English or Vietnamese; **Save as Study Note** or **Report**
   per §6–§7.

**Image Fallback variant.** If this whole question were a reviewed Image Fallback
(ADR-0006: unverifiable R&W wording → entire question content as image), the envelope
replaces the stimulus text blocks with the derived question image, the consent screen
adds the separate image consent (§3.3), and the model must be vision-capable. Guidance
becomes image-compatible: the panel may describe what the image shows and may reference
the learner's own reading, but cannot quote selectable text, and no evidence highlight
is attempted — the image stays the visual (story 55).

### 2.2 Math example (Algebra — linear modeling)

**Question Presentation.** Per ADR-0006, Math question content is a confirmed source
visual; choices are text/LaTeX. The envelope carries:

```jsonc
{
  "version": 1,
  "stimulus": [],
  "stem": [
    { "kind": "region", "region": { "pageNumber": 3, "x": 0.08, "y": 0.21, "width": 0.84, "height": 0.17, "confirmed": true } }
  ],
  "choices": [
    { "id": "A", "content": [{ "kind": "text", "text": "$y = 3.5x + 15$" }] },
    { "id": "B", "content": [{ "kind": "text", "text": "$y = 15x + 3.5$" }] },
    { "id": "C", "content": [{ "kind": "text", "text": "$y = 3.5x + 71$" }] },
    { "id": "D", "content": [{ "kind": "text", "text": "$y = 71x + 3.5$" }] }
  ]
}
```

*Instructional paraphrase of the region's content (for the reader of this design, not
part of the payload): a rental costs a $15 initial fee plus $3.50 per hour; which
equation gives the total cost y for x hours; the stem states a 16-hour rental costs
$71.* `accepted_answers: ["A"]` — the $3.50-per-hour slope with the $15 fixed fee
satisfies 15 + 3.50 × 16 = 71. The learner answered **C**, mistaking the $71 total for
the fixed fee.

**Envelope note (vision):** because the stem is a region image, this question requires
a **vision-capable model** and the **separate image consent** even though the choices
are text — exactly the rule the R&W fallback follows. (If the owner later publishes
this revision with a reviewed text transcription, the vision requirement drops; the
capability check runs per request against the actual envelope, §5.2.)

**Progressive interaction:**

1. **Step 1 (constraint):** "What is fixed and what varies? Identify the fee charged
   once and the rate charged per hour."
2. **Step 2 (next step):** "Write cost = fixed + (rate × hours) and substitute
   x = 16, y = 71 to test each choice."
3. **Worked solution (standard, story 58):** "y = 15 + 3.50x. Check: 15 + 3.50 × 16 =
   15 + 56 = 71. Accepted answer: A."
4. **Desmos approach (conditional):** "Genuinely useful here (test four lines against
   one point). Type `y = 3.5x + 15`, `y = 3.5x + 71`, `y = 15x + 3.5`, `y = 71x + 3.5`
   and the point `(16, 71)`; only the first line passes through the point." For a pure
   symbolic-simplification question, this section would be omitted with a one-line
   reason ("graphing adds nothing here").
5. **Why C fails (story 48):** "Choice C uses y = 3.5x + 71, which treats the $71
   total — already including 16 hours of hourly charges — as a fixed fee; at x = 16 it
   gives y = 3.5 × 16 + 71 = 127, not 71." B (y = 15x + 3.5 → 243.50) and D
   (y = 71x + 3.5 → 1,139.50) fail by the same substitution check: none passes
   (16, 71) except A.
6. **Key verification:** both the solution's final equation and each Desmos "which line
   passes" claim are checked server-side against `accepted_answers` before being
   presented as verified (§4.2); otherwise the unverified label shows.

---

## 3. Consent and content preview

### 3.1 First-request preview (every flow)

Before a flow's **first** external AI request in a visit, the learner sees a preview
modal (DESIGN.md dialog pattern) showing (story 69):

- **Content category and shape** — e.g., "This question's text and answer choices +
  your response (about 250 words)" for F1–F4; "the word/phrase you entered" for F5;
  "your aggregate progress numbers, no question content" for F6. For region-image
  content: "one question image".
- **Provider and model** — chosen explicitly (§5.1), with the payer: Shared AI Access
  (owner-funded, zero-cost models only for OpenRouter) or the learner's personal key
  (with current price and payer disclosure for paid models, per ADR-0008).
- **What is never sent** — the standard redaction list (§4.3), abbreviated.
- **Retention** — "This conversation disappears when you close Whitebook unless you
  save a Study Note."

Consent is granted per **provider + flow** and remembered for the visit only; a new
provider or a new flow class asks again (spec: "consent scoped to that provider and
flow"). A persistent per-account consent record is a future tranche decision; this
design assumes visit-scoped consent initially, surfaced with a "remember for this
account" option for the AI tranche to decide explicitly.

### 3.2 Provider-specific consent and no silent switching

- Choosing **Shared Gemini** vs **Shared OpenRouter** vs **personal key** is always an
  explicit learner choice (story 68). OpenRouter additionally shows its own data-use
  terms line before first use (spec launch-gate item; ADR-0011).
- If the selected provider fails or is exhausted, the panel offers **Retry**, **switch
  provider (goes back through that provider's own consent)**, or **close**. It never
  silently re-routes the request (spec: "the UI offers a choice rather than silently
  switching"). A visible chip in the panel always states the provider and model that
  served the current content (also required for AI-derived note metadata).

### 3.3 Separate Image Fallback consent (story 47)

Whenever the envelope contains a derived question image (R&W whole-question fallback or
Math stem/figure region), the preview shows **the actual image at transmit size** plus
its scope ("this one question's image only"), and requires a separate, explicit
approval distinct from the text consent. The provider selector then lists only
**vision-capable** models for that request (§5.2). Declining image consent keeps text
where text exists (Math choices remain sendable) and disables the explanation with an
honest message where the whole question is an image.

### 3.4 Vietnamese response choice (story 49)

Every explanation-family flow (F1–F4, F7) offers a response-language control: English
(default) or Vietnamese. It sits in the panel header, applies to generated responses,
and is included in the envelope. Content the learner saves (Study Notes, cards) keeps
its own language; UI chrome stays English (spec i18n). Provider/model Vietnamese
capability is part of the at-use capability check (§5.2) — a model that cannot honor
the choice is not offered while Vietnamese is selected.

### 3.5 Study Note saving (stories 64–66)

"Save as Study Note" opens the note editor pre-filled with the learner-selected excerpt
of the AI response (learner edits before saving; nothing saves automatically). The note
is stored against the question and the **immutable Test Package revision** it came
from, supports multiple notes per question, and is editable/deletable. An AI-derived
note records `source: "ai"`, provider, model, and date, so it is distinguishable from
the learner's own wording. Notes follow ticket 11's rules (hidden during active
Section Exam Attempts; visible in review and Assisted Practice contexts).

### 3.6 Report payload preview (stories 62, 98)

"Report" under any AI response opens a preview of the exact payload: question identity
(package revision, question number, category), provider/model, the **learner-selected**
messages and response excerpt, the learner's own description of the problem (required
free-text), and a timestamp. The learner can deselect any optional field before
submitting. Submission is one explicit action; the payload submitted is byte-for-byte
what the preview showed. Routine chats are never an owner-browsable record — only
explicitly submitted reports reach the owner, with the retention period defined before
launch (spec §Accounts).

---

## 4. Backend request/response boundaries (future tranche)

### 4.1 Minimal input envelope

One backend assistant interface, swappable provider adapters (spec). The explanation
envelope for F1–F4:

```jsonc
{
  "flow": "question_explanation",            // F1–F4 discriminators: reasoning_steps, reading_help, math_solution, card_draft, plan_suggest
  "locale": "en | vi",                       // response language
  "conversation": { "id": "visit-scoped", "priorMessages": [ /* capped, visit-scoped */ ] },
  "question": {
    "revisionRef": "immutable published revision id",
    "questionRef": "stable question id + number",
    "category": "Transition",
    "presentation": { /* canonical Question Presentation v1, verbatim from the contract */ },
    "acceptedAnswer": ["C"],                 // server-injected from the Answer Manifest
                                             // at request assembly; never read from,
                                             // or trusted from, any client input
    "learnerResponse": "B",
    "revealedState": "hidden | revealed"     // the review surface's current answer state
  },
  "provider": { "route": "shared_gemini | shared_openrouter | personal", "model": "…", "personalKeyId": "opaque ref, never a key" },
  "consents": { "providerFlow": "granted-at", "image": "granted-at | declined | not-needed" }
}
```

F5 sends only the card front plus optional learner-provided context. F6 sends aggregate
evidence (counts, per-category accuracy, due totals, catalog of activities, plan
constraints) — no question text, no passage content.

### 4.2 Answer-key authority and verification

- `acceptedAnswer` is injected server-side from the Answer Manifest at request time and
  is **never accepted from client input** for grading purposes. AI output cannot alter
  grading, Raw Accuracy, or any Attempt record (spec: AI never regrades).
- Before the client may display generated content **as verified**, the backend checks:
  (a) for Math, the final value/equation in the worked solution against the accepted
  answer; (b) any "verified against the key" claim, including Desmos-derived
  observations; (c) for saved trusted explanations, the same check at save time. Steps
  that contradict the key are suppressed and replaced with the key-based standard
  explanation. Live help that has not passed checks carries a persistent **"Not
  verified against the answer key"** label (story 61).
- The learner's attempt records touched by AI flows are limited to: guided-review
  assistance flags, hint-usage events, and Study Notes — all fields ticket 11 already
  keeps outside the Attempt score.

### 4.3 Redaction — never transmitted

The envelope excludes, and a server-side validator rejects requests containing:
Source PDF (bytes or URL), source filesystem paths or import metadata, account email or
provider subject, API keys (owner or personal), the full Test Package (any other
question), the full Attempt (other questions' content or timing), diagnostic logs, and
other learners' data. The validator runs on the assembled envelope before any adapter
call; a violation is a hard error surfaced as `blocked_content` (§5.4), never a silent
strip-and-send.

### 4.4 Persistence boundary

The conversation store is visit-scoped and in-memory: keyed to the session, never
written to the hosted database, never synced across devices, and dropped at sign-out or
visit end. The only durable artifacts AI flows can create are: Study Notes (with AI
metadata), Personal Cards (drafted content becomes an ordinary card), plan proposals
(only after backend validation and learner acceptance, as ticket 13 plan versions),
guided-review assistance fields, and explicitly submitted reports. Export and account
deletion cover these exactly as they cover other account data (spec §Accounts).

### 4.5 Preview, consent, and report contracts

Spec line 179 asks the design to "Document future AI preview/consent/request/report
contracts in the Assistant design only." The request envelope is §4.1; the other three
are the following design-level payloads (field shapes, not an API implementation):

**Preview payload** — rendered by `POST /assistant/preview` before a flow's first
request; every field is display-oriented so the learner sees exactly what sharing means:

```jsonc
{
  "flow": "question_explanation",
  "content": [
    { "kind": "question_text", "summary": "This question's text and answer choices", "approxWords": 250 },
    { "kind": "response",      "summary": "Your response: B" },
    { "kind": "question_image", "imageRef": "derived asset ref", "transmitSizePx": [640, 130] }  // only when a region is present
  ],
  "neverSent": ["Source PDF", "source paths", "account email", "API keys",
                 "full Test Package", "full Attempt", "diagnostic logs"],
  "retention": "visit-scoped unless a Study Note is saved"
}
```

**Consent record** — created by `POST /assistant/consents`; one row per
(provider, flow, scope), visit-scoped by default (§3.1):

```jsonc
{
  "provider": "shared_gemini | shared_openrouter | personal",
  "flow": "question_explanation",
  "scope": "text | image",
  "model": "…",                       // the model the consent was shown for
  "termsShown": "provider data-use terms version id",
  "grantedAt": "timestamp"
}
```

**Report payload** — assembled by `GET /assistant/report-preview`, submitted by
`POST /assistant/reports`; the submitted body is byte-for-byte the previewed one (§3.6):

```jsonc
{
  "question": { "revisionRef": "…", "questionRef": "…", "category": "…" },
  "provider": { "route": "…", "model": "…" },
  "excerpts": [                       // learner-selected; each optional field can be deselected
    { "role": "assistant", "text": "…" },
    { "role": "learner", "text": "…" }
  ],
  "learnerDescription": "required free text",
  "createdAt": "timestamp"
}
```

---

### 5.1 Provider routes

- **Shared Gemini** (Shared AI Access, owner-held key, server secret; ADR-0011). The
  owner's stated access path changes 30 September 2026 (Vertex AI Model Garden) →
  1 October 2026 (Gemini API key). Because this tranche is design-only, **no Vertex
  adapter is built now**; the AI tranche must confirm the actual billing/credit
  allowance and API tier/quota at enable time — a subscription or key alone does not
  establish free API usage (spec launch gate).
- **Shared OpenRouter** — explicit choice, its own consent screen, **confirmed
  zero-cost models only, no paid fallback** (ADR-0011).
- **Personal key** (ADR-0008) — application-layer-encrypted at rest, referenced by an
  opaque id in every envelope, never returned in plaintext after save, never logged.
  May surface paid models only with current price and payer disclosed at selection.

### 5.2 At-use capability check

Before each request the backend resolves, for the candidate model: provider health and
quota headroom; **vision support** if the envelope carries any region image; Vietnamese
capability if `locale: "vi"`; zero-cost confirmation for owner-held OpenRouter routes.
A model failing the check is excluded from the offered set (or the request is refused
with `capability_missing` if already selected). Availability is **always at-use**;
nothing is assumed from last week's state (spec).

### 5.3 Throttle and circuit breaker

Modest per-account throttles (design target: a small number of explanation requests per
learner per hour, exact numbers set in the AI tranche against real quotas) and one
shared quota circuit breaker across Shared AI Access. When the shared allowance is near
exhaustion: first pause **owner-funded AI requests** before any learner Attempt saves
(spec §capacity ordering), show remaining availability honestly, and keep every
learning flow fully functional — AI degrades, studying never does.

### 5.4 Error and loading states (story 70)

Every AI panel implements one state set; the learner's current work is never lost:

| State | Display | Learner keeps |
| --- | --- | --- |
| Loading | Streaming indicator; staged steps already revealed stay visible | Revealed steps, editable follow-up draft |
| `quota_exhausted` | "Shared AI help is used up for now — try again later or choose another provider." Retry / switch / close | Everything already shown |
| `provider_error` | Named provider failure; Retry / switch / close | Same |
| `model_unavailable` / `capability_missing` | Offered models list minus failing ones | Same |
| `rate_limited` (per-account) | Wait time in plain language | Same |
| `consent_required` / `image_consent_required` | The relevant consent screen, re-shown | Same |
| `blocked_content` (validator) | "Something in this request isn't allowed to leave Whitebook." Report-this-bug path | Same |
| Offline | Panel inert with the offline banner; no queued sends | Same |

All retry paths re-enter through consent if the provider changes. No error state
fabricates content, and no fallback silently downgrades to another provider (§3.2).

---

## 6. Conversation lifecycle (no full-chat persistence, story 63)

- One visit-scoped conversation per (flow, question); follow-ups extend it (F7).
- The conversation list is not browsable, exportable, or synced; it exists only to give
  the model relevant prior messages (capped length) within the same question's session.
- Ending the visit (or starting the same review fresh later) starts a new empty
  conversation; the durable record is only what the learner explicitly saved (§4.4).
- Reopening a question later re-runs preview/consent as a first request of the new
  visit — by design, so the learner re-confirms sharing rather than the system having
  retained a transcript.

---

## 7. Accessibility and visual identity

- The Assistant panel is a white card with indigo actions per `DESIGN.md`; no emoji
  icons; authored SVG line work only; semantic colors always paired with text.
- Keyboard: every control (reveal steps, switch provider, language, save note, report)
  is focusable and operable; staged reveals are buttons, not hover; the narrow-screen
  passage/guidance switch uses radio semantics with visible focus.
- Screen readers: step reveals and streaming output use `aria-live="polite"` regions;
  the provider/model chip is announced with each response so the learner always knows
  who served the content; the "Not verified" label is text, not color alone.
- `prefers-reduced-motion` disables the streaming/entrance animations (DESIGN.md rule).
- Evidence highlighting uses the indigo-tint family so it is distinguishable from the
  learner's yellow/pink/cyan Student Highlights (ADR-0006) — AI-suggested evidence is
  never drawn to look like the learner's own marking.

---

## 8. Traceability

| Ticket-14 criterion | Where satisfied |
| --- | --- |
| Annotated desktop + narrow-screen flows covering History explanation, Reasoning Steps, Reading Help, Math + optional Desmos, Flashcard drafting, Study Plan suggestions | §1.1–§1.6 (desktop and narrow screens; F1–F7 map 1:1 to the listed flows) and §1.7 (narrow-screen treatment for Math help, Flashcard drafting, and Study Plan suggestions) |
| One R&W + one Math example with complete Question Presentation context, progressive hints, evidence anchoring, answer reveal, why wrong choices fail | §2.1, §2.2 (both include the fallback/vision variants and the minimal envelope) |
| Content preview, provider-specific consent, separate Image Fallback consent, Vietnamese response choice, Study Note saving, report-payload preview, no full-chat persistence | §3.1–§3.6, §6 |
| Backend request/response boundaries, answer-key authority, redaction, model/vision capability checks, quota and error states, consented OpenRouter fallback | §4.1–§4.5, §5.1–§5.4 |
| No live provider call, secret storage, AI-generated content, or inactive Assistant button in this ticket | §0, §9 (explicit non-goals); nothing in this branch touches `web/src` or backend code |

Spec stories covered: 32–33, 36–37, 46–70, 91, 98–99 (design sections above); stories
owned by implementation tickets (e.g., 43, 56–57 storage behavior) are restated as
constraints the AI tranche must honor, not built here.

---

## 9. Explicitly not built by this ticket

1. Any live call to Gemini, Vertex AI, OpenRouter, or any model provider.
2. Any storage of provider secrets — owner-held or personal (ADR-0008/0011 define the
   storage decisions; the AI tranche implements them).
3. Any AI-generated content in the product, fixtures, or tests.
4. Any learner-visible Assistant control — including disabled ones. No "Ask AI"
   button, panel, or menu may render from this tranche, in any surface.
5. No changes to grading, Raw Accuracy, guided-review scoring, or Attempt records.
6. No provider-stub tests; per spec, provider-stub tests belong to the later AI
   implementation tranche.

## 10. Gates the AI tranche must re-verify before shipping any control

1. Eligibility of Vertex AI, direct Gemini, and OpenRouter (and the chosen models) for
   the actual public SAT-prep audience and content, with the applicable provider
   data-use terms shown in consent (spec launch gate).
2. Gemini API project tier/quota confirmed independently of the Google AI Pro
   subscription; Vertex billing/credit allowance confirmed.
3. OpenRouter model list restricted to confirmed zero-cost models at enable time.
4. Vision and Vietnamese capability metadata sourced from a checked, current list —
   not hardcoded assumptions.
5. Every §5.4 state exercised against a real adapter failure; every §4.3 exclusion
   enforced by the envelope validator in tests.
