# Whitebook Assistant — interaction and data-boundary design

Status: design-only deliverable for ticket 14 of the whitebook-account-learning-update
tranche. The ticket and its spec live in the owner-local `.scratch` tracker and are not
committed to this repository; the ticket's five acceptance criteria are restated in §8,
so this document is self-contained.
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

## 0. Design principles and assumptions

1. **Opt-in, per flow, per provider.** Nothing calls a provider without a content
   preview followed by consent scoped to that provider and flow (spec stories 68–69).
2. **The answer key is authoritative.** AI explains; it never regrades, never overrides
   an accepted answer, and its live output is labeled unverified until checked against
   the key (stories 61, 46; spec §Assistant design).
3. **Minimal envelope.** A question request carries one canonical Question Presentation,
   the learner's response, and only the capped prior messages shown in the send preview —
   never a Source PDF, source path, account email, API key, full Test Package, full
   Attempt, or diagnostic logs — the §4.3 redaction list.
4. **No chat history.** Ordinary AI conversations live for the visit and disappear;
   only an explicitly saved Study Note persists (story 63).
5. **AI is optional everywhere.** Every flow has a non-AI path that keeps working when
   providers are blocked (stories 36, 91; spec quota circuit-breaker).
6. **Domain vocabulary.** Guided Reasoning (with its two staged phases, Reasoning Steps
   and Reading Help), Assisted Practice, Image Fallback, Reviewed Question Text, Study
   Note, and Shared AI Access are used exactly as defined in the learning-update
   tranche's `CONTEXT.md` glossary; Reasoning Steps and Reading Help are the two staged
   Guided Reasoning phases the tranche spec defines, not separate glossary entries.
   That glossary update ships with the learning-update tranche and is not merged yet,
   so the committed `CONTEXT.md` in this checkout does not contain it — this document
   defers to those definitions rather than restating them.
7. **Answer disclosure follows server-owned review state.** The Answer Manifest remains
   authoritative on the server. While an answer is hidden, the key is not included in a
   provider payload, and generated stages pass an answer-disclosure gate before any
   stage reaches the learner. An uncertain result is withheld; the learner gets a
   reviewed non-AI hint where one exists, or a clear unavailable message (authoritative
   form: §4.1–§4.2).
8. **Question-source assumptions.** Reviewed Reading and Writing wording is sent as
   selectable text; unverifiable wording uses the whole question as an Image Fallback
   without text evidence highlights. Math stems and figures are confirmed source visuals;
   A–D choices use text or reviewed LaTeX, with a whole-choice Image Fallback if they
   cannot be represented faithfully. Every transmitted image uses a derived image at its
   displayed transmit size and requires the separate §3.3 image consent plus a
   vision-capable model. A
   future reviewed Math transcription may remove that image requirement.

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

- **(a) Answer reveal is learner-controlled.** The server resolves whether the answer is
  hidden or revealed from the review state; it does not trust a client-supplied flag.
  While hidden, the Assistant may show only stages that pass the answer-disclosure gate
  in §4.2. The answer-specific explanation and any step that gives away the choice stay
  unavailable until the learner chooses **Show answer** (story 38).
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

The diagram shows a post-reveal state. While the answer is hidden, only answer-safe
stages appear; the standard solution, answer-specific choice analysis, and Desmos result
stay behind **Show answer**.

```
┌─ Whitebook — Results — Question 6 of 22 ──────────────────────────────────────┐
│  September Math · Revision 4 · Algebra                                       │
├──────────────────────────────────┬────────────────────────────────────────────┤
│  QUESTION 6                      │  Assistant (future)                        │
│  ┌────────────────────────────┐  │  Why A: one-paragraph answer.              │
│  │ Source visual (region) —   │  │                                            │
│  │ Math stem is a source      │  │  ▸ Worked solution (standard, staged):     │
│  │ region image per §0;       │  │    1. Set up the equation from the         │
│  │ it is not transcribed text │  │       constraint.                          │
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

## 2. Worked examples

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

`accepted_answers: ["C"]`, `category: "Transition"`, learner response: **B**. The
answer-aware explanation below is shown after the learner chooses **Show answer**. Before
that action, the provider payload omits the key and only answer-safe hint stages may be
released (§4.1–§4.2).

**Provider context after answer reveal** (§4.1): this presentation verbatim, the now
visible accepted answer `C`, the learner response `B`, the category, and the capped prior
messages included in the per-send preview. Before reveal, `acceptedAnswer` is omitted
from the provider payload; the server still holds it for verification.

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
3. **Reasoning step 3 (decide):** "Choose a transition that signals contrast. Make your
   choice before asking to reveal the answer."
4. **Answer reveal (only after the learner chooses Show answer):** accepted answer **C**.
5. **Why the learner's choice fails (story 48):** "*Likewise* (B) signals similarity,
   but the clause that follows contradicts the evidence — it cannot introduce an
   opposing view." **Why the others fail:** "*Consequently* (A) claims cause and
   effect between experiment and skepticism, which is backwards; *In other words* (D)
   restates rather than contrasts."
6. **Follow-up (F7)** in English or Vietnamese; **Save as Study Note** or **Report**
   per §6–§7.

**Image Fallback variant.** If this whole question used the source-content assumption in
§0 (unverifiable R&W wording → entire question content as image), the provider payload
replaces the stimulus text blocks with the derived question image, the consent screen
adds the separate image consent (§3.3), and the model must be vision-capable. Guidance
becomes image-compatible: the panel may describe what the image shows and may reference
the learner's own reading, but cannot quote selectable text, and no evidence highlight
is attempted — the image stays the visual (story 55).

### 2.2 Math example (Algebra — linear modeling)

**Question Presentation.** Under the source-content assumption in §0, Math question
stems and figures are confirmed source visuals; choices are text/LaTeX. The provider
payload carries the derived image for the region (not the Source PDF):

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
the fixed fee. The worked solution and answer-specific choice analysis below appear only
after **Show answer**; pre-reveal hints omit the key and pass the
answer-disclosure gate (§4.2).

**Envelope note (vision):** because the stem is a region image, this question requires
a **vision-capable model** and the **separate image consent (§3.3)** even though the
choices are text — exactly the rule the R&W fallback follows. (If the owner later publishes
this revision with a reviewed text transcription, the vision requirement drops; the
capability check runs per request against the actual envelope, §5.2.)

**Evidence anchoring note (story 54):** the §1.1(c) match-and-highlight mechanism cannot
anchor to a region image — there is no selectable text to match, so the stem receives no
highlights by design. Where Math choices are reviewed text or reviewed LaTeX (§0), model
quotes may anchor to choice text under the same fail-safe: an unmatched quote renders
unhighlighted with a "span not located" marker, never an invented span.

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

### 3.1 Pre-send content preview (every flow)

Before the first request in a flow, the learner sees the exact provider-bound content
and provider/model, then grants provider-specific consent (story 69). Before each later
send, a compact **Included in this send** view shows the new message and the exact capped
prior messages that will accompany it; pressing **Send** confirms that request. The
preview is made from the same server-side payload snapshot the adapter will use, not a
summary reconstructed by the client.

- **F1–F4 question content** — render the canonical Question Presentation text and all
  choices verbatim, the learner response, category, question/revision references, and
  answer visibility. While hidden, the Answer Manifest key stays server-side and is
  omitted from the provider payload; the preview says so (§4.1). After **Show answer**,
  if the key is included for an explanation request, show its exact value in the preview.
- **Conversation content** — the first request has no prior messages. Each follow-up
  preview shows the exact current learner message and every capped prior learner and
  assistant message sent with it. No unseen portion of the visit conversation is added.
- **Images** — display the actual derived image at the exact transmit size, alongside
  its question identity. A region reference is resolved server-side; neither the Source
  PDF nor its path is sent.
- **F5 card draft** — show the exact front, target language, and optional context.
  **F6 plan suggestion** — show the exact aggregate fields, activity catalog, and plan
  constraints being sent, with an explicit statement that question text is excluded.
- **Provider and model** — chosen explicitly (§5.1), with payer and price: Shared AI
  Access, or the learner's personal key and any paid-model price disclosure.
- **What is never sent** — the standard redaction list (§4.3), including provider
  credentials and internal key references.
- **Retention** — "This conversation disappears when you close Whitebook unless you
  save a Study Note."

Consent is granted per **provider + flow** and remembered for the visit only; a new
provider or flow asks again (spec: "consent scoped to that provider and flow"). A change
to the selected model, payer, price, or provider terms returns to preview and consent.
Every preview receives a short-lived server-side snapshot id; the request after consent must
consume that snapshot so its content cannot drift between preview and send. A persistent
per-account consent record is a future tranche decision; this design assumes visit-scoped
consent initially and leaves any "remember for this account" option for the AI tranche
to decide explicitly.

### 3.2 Provider-specific consent and no silent switching

- Choosing **Shared Gemini** vs **Shared OpenRouter** vs **personal key** is always an
  explicit learner choice (story 68). OpenRouter additionally shows its own data-use
  terms line before first use (spec launch-gate item).
- If the selected provider fails or is exhausted, the panel offers **Retry**, **switch
  provider (goes back through that provider's own consent)**, or **close**. It never
  silently re-routes the request (spec: "the UI offers a choice rather than silently
  switching"). A visible chip in the panel always states the provider and model that
  served the current content (also required for AI-derived note metadata).
- A model, payer, price, or terms change is shown before the next request and invalidates
  the old preview snapshot. There is no silent model substitution within a provider route.

### 3.3 Separate Image Fallback consent (story 47)

Whenever the payload contains a derived question image (R&W whole-question fallback or
Math stem/figure region), the preview shows **the actual image at transmit size** plus
its scope ("this one question's image only"), and requires a separate, explicit
approval bound to that image and provider, distinct from the text consent. A different
question image requires a new image approval. The provider selector then lists only
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
free-text), and a timestamp. The learner can deselect optional excerpts or edit the
description; each change produces a new immutable, short-lived report preview. The
preview displays the exact fields and values that will reach the owner. On explicit
submit, the client sends only the preview reference, and the server submits that stored
snapshot byte-for-byte. Routine chats are never an owner-browsable record — only
explicitly submitted reports reach the owner, with the retention period defined before
launch (spec §Accounts).

---

## 4. Backend request/response boundaries (future tranche)

### 4.1 Minimal input envelope

One backend assistant interface, swappable provider adapters (spec). The browser sends
question/revision references, the learner's response, the chosen route/model, and any
learner-authored message. The server resolves the canonical presentation, Answer
Manifest key, consent, credential reference, and answer-reveal state; none of those
authoritative values is accepted from client input. It then creates the provider
payload from the previewed snapshot. The F1–F4 provider payload is:

```jsonc
{
  "flow": "question_explanation | reasoning_steps | reading_help | math_solution", // F1–F4
  "locale": "en | vi",                       // response language
  "conversation": { "priorMessages": [ /* exact, capped, visit-scoped messages */ ] },
  "question": {
    "revisionRef": "immutable published revision id",
    "questionRef": "stable question id + number",
    "category": "Transition",
    "presentation": { /* canonical Question Presentation v1; approved regions resolve to derived assets */ },
    "learnerResponse": "B",
    "revealedState": "hidden | revealed"     // resolved by server from review state
  }
}
```

The `acceptedAnswer` field is omitted entirely while `revealedState` is `hidden`. Only
after the learner reveals the key may the server add `acceptedAnswer`, sourced from the
Answer Manifest; the key also remains in a server-only verification context. Region blocks are
resolved to derived question images by an asset resolver; the adapter receives the
approved image at transmit size, never the Source PDF or a source path. Provider route,
model, personal-key id, and consent records are backend routing metadata and are not
forwarded to the external model. The conversation id is also backend-only; only the exact
prior messages shown in the current send preview are forwarded. The personal-key id is
used only by the backend to resolve its encrypted credential.

F5 sends only the exact card front, target language, and optional learner-provided
context. F6 sends the exact aggregate evidence fields (counts, per-category accuracy,
due totals), activity catalog, and plan constraints — no question text or passage
content.

### 4.2 Answer-key authority and verification

- `acceptedAnswer` is injected server-side from the Answer Manifest at request time and
  is **never accepted from client input** for grading purposes. AI output cannot alter
  grading, Raw Accuracy, or any Attempt record (spec: AI never regrades).
- The server, not the client, resolves whether the answer is hidden. While hidden, it
  keeps `acceptedAnswer` out of the provider payload and permits only staged hint output.
  Before any stage is released, a server-side disclosure gate checks for the accepted
  choice/value and conclusions that directly or unambiguously identify it; ordinary
  next-step prompts remain allowed. It buffers each stage before streaming and never
  forwards raw model tokens to the browser. If the gate finds a leak or cannot decide, it
  discards that stage and uses a reviewed non-AI hint where available; otherwise it
  returns `answer_withheld`. A later **Show answer** action updates server-owned reveal
  state; only then may answer-aware explanation content be released.
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
are the following design-level payloads (field shapes, not an API implementation; the
`POST /assistant/…` paths below are illustrative names — the commitment is the fields
and the server-owned snapshot behavior, and the AI tranche names the real endpoints):

**Preview payload** — returned by `POST /assistant/preview` before the first request and
before each follow-up send. The backend creates a short-lived immutable snapshot with
the same serializer used for the provider call; after consent or explicit follow-up Send,
the request consumes that `previewId`. It cannot accept edited content from the client.
The learner sees exact values, not a category-only summary:

```jsonc
{
  "previewId": "short-lived opaque snapshot reference",
  "flow": "reasoning_steps",
  "provider": {
    "route": "shared_gemini", "model": "…", "payer": "Shared AI Access",
    "priceDisplay": "<current price, currency, billing unit>"  // null for zero-cost routes
  },
  "content": {
    "question": {
      "revisionRef": "…", "questionRef": "…", "category": "Transition",
      "presentation": { /* canonical Question Presentation v1, exact text and choices */ },
      "learnerResponse": "B",
      "answer": { "state": "hidden", "providerValue": "omitted" }
      // Once revealed, the preview includes the exact accepted answer if the call will send it.
    },
    "conversation": {
      "currentMessage": null,
      "priorMessages": []  // exact capped messages; populated in follow-up previews
    },
    "locale": "en"
  },
  "images": [
    { "imageRef": "opaque derived-asset ref", "transmitSizePx": [640, 130] }
  ],
  "neverSent": [ // the §4.3 redaction list, restated as a contract field
    "Source PDF", "source paths", "account email", "API keys",
    "personal-key id", "full Test Package", "full Attempt", "diagnostic logs"],
  "retention": "visit-scoped unless a Study Note is saved"
}
```

For F5, `content` shows the exact card front, target language, and selected context. For
F6, it shows the exact aggregate values, activity catalog, and plan constraints, with no
question content. The image entry is accompanied in the UI by the actual derived image
at that transmit size. Backend-only route credentials, consent references, conversation
ids, and source paths never appear in the provider payload. A follow-up preview shows the
new learner message and exact prior messages before the learner sends it.

The provider preview's `priceDisplay` is populated from current provider pricing for a
paid personal-key model, including currency and billing unit; it is null only when no
provider charge applies to the learner.

**Consent record** — created by `POST /assistant/consents`; one current grant per
(provider, flow, scope, visit), keyed to the preview snapshot; image grants also bind to
the exact `imageRef` (§3.1):

```jsonc
{
  "provider": "shared_gemini | shared_openrouter | personal",
  "flow": "question_explanation",
  "scope": "text | image",
  "model": "…",                       // the model the consent was shown for
  "previewId": "the exact preview snapshot approved",
  "imageRef": "exact derived image ref when scope is image; otherwise null",
  "termsShown": "provider data-use terms version id",
  "grantedAt": "timestamp"
}
```

For a later follow-up, the existing visit grant is valid only for the same provider,
model, payer, terms, and image scope. The new preview snapshot still requires the
learner's explicit **Send** action; changed provider or model details require renewed
consent.

**Report preview and submission** — `POST /assistant/report-preview` returns the exact
payload and a short-lived `reportPreviewId`. Any learner edit or excerpt deselection
requests a new preview. `POST /assistant/reports` accepts only that preview reference;
the server verifies that it belongs to the signed-in learner and visit, then submits the
stored payload unchanged (§3.6):

```jsonc
{
  "reportPreviewId": "short-lived opaque reference",
  "payload": {
    "question": { "revisionRef": "…", "questionRef": "…", "category": "…" },
    "provider": { "route": "…", "model": "…" },
    "excerpts": [                       // learner-selected; each optional field can be deselected
      { "role": "assistant", "text": "…" },
      { "role": "learner", "text": "…" }
    ],
    "learnerDescription": "required free text",
    "createdAt": "timestamp"
  }
}
```

---

## 5. Provider routes, capability checks, and failure handling

### 5.1 Provider routes

- **Shared Gemini** (Shared AI Access, owner-held key, server secret). The
  owner's stated access path changes 30 September 2026 (Vertex AI Model Garden) →
  1 October 2026 (Gemini API key). Because this tranche is design-only, **no Vertex
  adapter is built now**; the AI tranche must confirm the actual billing/credit
  allowance and API tier/quota at enable time — a subscription or key alone does not
  establish free API usage (spec launch gate).
- **Shared OpenRouter** — an owner-held server secret, explicit learner choice, its own
  consent screen, **confirmed zero-cost models only, no paid fallback**.
- **Personal key** — application-layer-encrypted at rest. The backend resolves it through
  an opaque internal id that is never sent to a provider, returned in plaintext after
  save, or logged. A paid model is offered only with its current price and payer disclosed
  at selection.
- **Model selection (spec: how the learner chooses a supported model and response
  language).** The language control is §3.4; model choice is designed as follows. The
  first request of every flow shows a model selector on the preview/consent screen
  (§3.1), listing exactly the route's models that pass the §5.2 at-use check for that
  request's envelope — vision-capable when any image is present, Vietnamese-capable when
  `locale: "vi"`, zero-cost-only for Shared OpenRouter. The choice is remembered for the
  visit per flow; the §3.2 chip names the model that served each response, and a change
  action re-enters preview and, when provider or terms change, that provider's consent.
  When no model of a route passes the check, the route is not offered (§5.4).

### 5.2 At-use capability check

Before each request the backend resolves, for the candidate model: provider health and
quota headroom; **vision support** if the envelope carries any region image (sent only
with the §3.3 image consent); Vietnamese capability if `locale: "vi"`; zero-cost
confirmation for owner-held OpenRouter routes.
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
| `answer_withheld` | "This step could reveal the answer." Use a reviewed hint or choose Show answer | Current work and previously approved steps |
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
  learner's yellow/pink/cyan Student Highlights — AI-suggested evidence is never drawn
  to look like the learner's own marking.

---

## 8. Traceability

| Ticket-14 criterion | Where satisfied |
| --- | --- |
| Annotated desktop + narrow-screen flows covering History explanation, Reasoning Steps, Reading Help, Math + optional Desmos, Flashcard drafting, Study Plan suggestions | §1.1–§1.6 (desktop and narrow screens; F1–F7 map 1:1 to the listed flows) and §1.7 (narrow-screen treatment for Math help, Flashcard drafting, and Study Plan suggestions) |
| One R&W + one Math example with complete Question Presentation context, progressive hints, evidence anchoring, answer reveal, why wrong choices fail | §2.1 (text anchoring) and §2.2 (both include fallback/vision variants and post-reveal context; §2.2's note states why an image stem cannot anchor and where choice-text anchoring applies); §4.2 gates hidden-answer stages |
| Content preview, provider-specific consent, separate Image Fallback consent, Vietnamese response choice, Study Note saving, report-payload preview, no full-chat persistence | §3.1–§3.6, §4.5 exact preview snapshots, §6 |
| Backend request/response boundaries, answer-key authority, redaction, model/vision capability checks, quota and error states, consented OpenRouter fallback | §4.1–§4.5, §5.1–§5.4 |
| No live provider call, secret storage, AI-generated content, or inactive Assistant button in this ticket | §0, §9 (explicit non-goals); nothing in this branch touches `web/src` or backend code |

Spec stories covered: 32–33, 36–37, 46–70, 91, 98–99 (design sections above); stories
owned by implementation tickets (e.g., 43, 56–57 storage behavior) are restated as
constraints the AI tranche must honor, not built here.

---

## 9. Explicitly not built by this ticket

1. Any live call to Gemini, Vertex AI, OpenRouter, or any model provider.
2. Any storage of provider secrets — owner-held keys remain backend secrets and personal
   keys use the application-layer encryption boundary in §5.1; implementation is for the
   future AI tranche.
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
6. Answer-hidden flows tested against direct and answer-equivalent leakage; the server
   must withhold unsafe stages and use a reviewed hint or a clear withheld state.
