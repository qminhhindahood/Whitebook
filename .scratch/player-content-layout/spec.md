# Whitebook question player: interface design and content handoff

Status: design consolidated from the user's decisions on 2026-09-05. No implementation changes made in this design review.

This document supersedes `.scratch/handoff-bluebook-two-region-render.md` wherever the earlier plan differs. The user's chat instructions are the requirements; screenshots are visual references, not instructions or a source of grading rules.

## Outcome and ownership

The learner sees the question above answer boxes containing the actual answer content. Clicking anywhere in a box selects its answer. Reading passages remain source images in a separate pane.

The UI work owns Player composition, reusable question and answer components, selection and elimination feedback, divider interaction, typed-answer presentation, and consistent Results presentation. The user will assign conversion of the three existing banks to another agent. Do not dispatch that agent or modify the banks as part of this UI task.

The bank work must supply separate stimulus, stem, and answer content and a supported publication path. The old two-crop proposal is insufficient. Two zones means two interface panes; it does not constrain the number of source crops.

## Confirmed layout rules

| Question kind | Composition |
| --- | --- |
| Reading and Writing | Passage image on the left; question banner, stem, and full-content answer boxes on the right; adjustable divider. |
| Math multiple choice | One centered reading column containing banner, problem content including equations/diagrams, and answer boxes. No empty left pane or divider. |
| Math student-produced response | Directions and entry examples on the left; banner, complete problem content, answer input, and Answer Preview on the right; adjustable divider. |

The Math references explicitly settle the previous question about content without a stimulus. Math figures remain with the problem in its question column. Reading and Writing items without a separate stimulus can use the centered composition as an implementation default; do not manufacture passage content.

No legacy player layout and no content zoom controls. Source files and historical attempts still require preservation; removing the old layout is not permission to mutate or delete their records. Existing calculator and reference-sheet behavior is outside the content-zoom change.

## Visual composition

Use the supplied references for hierarchy, whitespace, readable answer boxes, and placement. Keep the Whitebook name and authored icons. Use the established indigo action color and restrained player accent strip. Do not reproduce reference watermarks or branding.

- Header stays fixed: section and Directions at left, tabular timer and Hide control centered, existing relevant tools at right. Keep the actual attempt timing behavior.
- Footer stays fixed: Whitebook identity, Question N of M navigator, and existing Back/Next or completion actions. Reference screenshots do not authorize a new per-question grading or Check feature.
- Main surface is white. Question content begins near the top with generous spacing below the header. Avoid vertically centering short questions or stretching short answers into oversized cards.
- Split layouts start at approximately equal widths. Each pane has its own scroll container and a centered inner reading width. The divider spans the content area, with a visible grip and a wider invisible pointer target.
- Centered Math content has a maximum reading width around 720px. Text is comfortably sized at laptop resolution rather than scaled down to match the large reference screenshots.
- Question prose uses an approximately 19px readable serif stack with about 1.5 line height. Interface labels retain the existing sans-serif stack. Images fit available width without distortion. Equations and figures preserve their supplied appearance.
- The banner contains the question number and Mark for Review control. Keep nonessential metadata visually secondary. The stem follows directly; remove the oversized generic Select one answer heading when the actual stem is present.

Exact spacing and widths are implementation defaults to verify visually at 1024x768 and 1440x900; they are not additional questions for the user.

## Multiple-choice interaction

Each choice is a native radio control with a full-box clickable label. Display the A-D badge and its own content together. Multiline content determines the box height; use consistent padding and gaps. Plain text wraps naturally. Image content can coexist with text in an answer.

Unselected choices have a clear neutral border. Hover adds a subtle background. Selected choices have an indigo border, light indigo background, and filled letter badge. Keyboard focus has a distinct visible ring. Never change dimensions on selection.

Elimination is a separate button adjacent to the answer label, not nested inside it. It does not select an answer when activated. Eliminated choices remain readable with an explicit eliminated state and a Restore action. Preserve the application's current response/review persistence semantics; do not change grading behavior as part of this design.

Keep native keyboard radio navigation, meaningful accessible names, and programmatic checked states. Text answers provide their actual content in the label. Image answers use supplied descriptive text when available; never fabricate a transcription for accessibility.

## Divider and scrolling

Dragging changes the relative pane widths without shrinking either pane below a useful reading width. Implement a focusable separator with current/min/max values and Left/Right keyboard adjustment. Persist the chosen split for the current player session; do not require a settings screen.

Header, footer, and divider do not scroll with question content. Reset content scroll when moving to a different question so its beginning is visible; preserve normal scroll during selection, review changes, and typing.

## Student-produced responses

Use the first Math reference's two-pane composition. Left pane contains concise entry directions and examples. Right pane contains the complete problem, a visibly labeled text input, and Answer Preview below it. Mathematical figures belong with the problem on the right.

The input supports the formats accepted by the existing application. Preview represents the learner's current entry only; it must not show correctness or an accepted answer. Render a complete simple fraction as a fraction if supported; show incomplete or other input faithfully without destructive normalization. Preserve the raw entry for persistence.

Derive instruction wording and validation from the application's supported response behavior. The screenshot's character limits, rounding examples, and grading statements are reference content and must not silently become new validation or grading rules.

## Content contract for the bank agent

The following is a proposed shared presentation payload to implement, not an existing API. Keep the current question identity, section, response type, and grading fields. Attach an explicit versioned presentation object, adapted at API boundaries to the application's current naming conventions:

```ts
type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "region"; region: Region; alt?: string };

type QuestionPresentation = {
  version: 1;
  stimulus: ContentBlock[];
  stem: ContentBlock[];
  choices?: { id: "A" | "B" | "C" | "D"; content: ContentBlock[] }[];
};
```

`Region` refers to the existing normalized crop coordinates in `web/src/types.ts`, using the question's package Source PDF. Blocks have explicit reading order. Text is plain text with preserved paragraph breaks; do not introduce raw HTML or executable content. Use region blocks for equations, diagrams, or other material that cannot be represented faithfully as ordinary text. A future structured equation format can be added deliberately; it is not required for this interface.

Requirements:

1. Passage blocks are source-image regions as requested. Ordinary stem and answer prose should be text; image blocks are supported where needed.
2. The stem must not also contain the answer list. Each answer contains only its own content, without duplicated printed A-D labels when a clean crop is available.
3. Multiple-choice items supply exactly one nonempty choice per A-D identifier. Student-produced responses supply a nonempty stem and no choice list.
4. Preserve question order, stable answer identifiers, accepted answers, and source associations. Presentation does not determine correctness.
5. Carry presentation through publication, Attempt plans, loading readiness, resumption, and Results. Load and validate all required image blocks before timing begins.
6. Missing presentation is an explicit content-readiness issue, not a reason to display blank answer boxes or silently revive the legacy layout. New attempts must wait for usable content. Preserve older attempt records and report unavailable converted content without changing responses.

The frontend can be developed and verified with representative fixtures before bank conversion completes. End-to-end readiness depends on the bank/backend agent supplying this contract. The full bank-conversion workflow and historical-attempt compatibility remain that agent's implementation responsibility.

## Corrections to the earlier implementation plan

- A stimulus/question role column alone cannot produce full-content clickable answers. Storage and authoring need separate stem and per-choice content, not just a two-way region filter.
- Scanned PDFs lack directly extractable text; text is not impossible. The conversion agent owns transcription/extraction and checking it against the source.
- `authoring.py` locks published drafts and deduplicates identical PDF/CSV pairs. `storage.py` also has a uniqueness constraint on those hashes. Re-importing the same files does not create an editable revision. The bank agent must implement a supported revision path without changing answers merely to bypass deduplication.
- Backup restore replaces the database without initialization. Any schema change must account for restoring older databases, not only ordinary startup.
- Player and Results render content separately today. Results requires explicit adaptation and shared presentation rendering; it will not inherit Player markup automatically.
- Existing package/attempt JSON must explicitly carry the new presentation. Do not assume a role added to draft rows updates immutable published content or previously created attempts.

## UI implementation boundaries

Primary integration points: `web/src/screens/Player.tsx`, `web/src/screens/Results.tsx`, `web/src/types.ts`, `web/src/pdf.tsx`, and scoped player styles in `web/src/styles.css`. Prefer a small shared content renderer and choice component over copying presentation logic between screens.

Keep timer behavior, saving, navigator, review flags, calculator, references, pause/resume, and submission working. Results renders the same stem and answer content read-only with the recorded learner response and accepted answer. Avoid changing Library, Import, or general application styling as a side effect. Mapper and conversion tooling changes belong to the separate content workflow.

## Verification and completion

UI verification must cover all three compositions with real representative fixture content, including a long passage, multiline answers, mathematical image content, and a typed fraction. Verify full-box selection, elimination/restore, review state, keyboard focus, divider mouse/keyboard control, independent scrolling, navigation, saving/resumption, and Results.

Inspect at 1024x768 and 1440x900. Capture selected and unselected answer states plus both Math layouts. Confirm fixed controls remain reachable and content is neither clipped nor distorted. Run the relevant frontend tests and production build. Run backend tests when backend integration changes are included; do not claim those changes are complete based only on UI fixtures.

The separate bank agent owns conversion and the complete 237 + 201 + 254 question sweep. UI completion alone does not establish that those banks are upgraded.

## Local operation notes

Repository: `D:/Notion/UI`. Commands: `npm --prefix web test`, `npm run build`, `uv run pytest -q`, and `uv run ruff check src tests` as applicable to the files changed. The workspace already contains substantial uncommitted work; preserve it.

Historical server PID, port, bootstrap token, and attempt status in the old handoff are not current authority. Discover the running instance before using or stopping it; read the current runtime descriptor only when needed and do not publish its token. Do not directly edit the live SQLite database or commit `.env` or `data/`.
