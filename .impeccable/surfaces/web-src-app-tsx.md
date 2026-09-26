---
version: 1
slug: "web-src-app-tsx"
primary_target: "web/src/App.tsx"
related_targets: ["web/src/styles.css"]
---

# Whitebook application shell

## Scope

- Surface: `web/src/App.tsx` and the shared shell styles in `web/src/styles.css`.
- Mode: Operate.
- Audience and job: one learner opening a private Windows-laptop workspace to find or import SAT-style Test Packages.
- Primary action: Import package.
- Proof: visible local readiness and plain confirmation that files stay on this device.
- Constraints: laptop-first; native browser behavior and visible focus; independent code and assets; no College Board affiliation; no copied Bluebook or Bluebooky trade dress.

## Chosen direction

User-pinned reference (2026-09-05): Bluebooky-style screenshots supplied in conversation; layout grammar and finish follow them, branding stays Whitebook.

The "Indigo Exam Desk": a white sticky navbar (brand left; Library / Import / History as solid indigo pills plus the readiness chip right) over a pale lavender canvas. Library content is a package card grid with Total/RW/Math chips. The Practice Builder is a centered two-column modal dialog ("Create Practice Drill") over a dimmed backdrop. The player is a full-bleed split-pane exam surface framed by multicolor dashed accent strips, with a black footer position pill and a question navigator modal. Decisions locked with the user: builder is a modal (not a page), no countdown banner (no dated data), authored section directions.

## System reading

- Component grammar: white 14px-radius cards with soft two-layer shadows and 1px `#dfe3f0` borders on canvas `#f5f6fb`; segmented tiles that fill indigo `#3f51c5` with a 3px light-blue halo when selected; pill buttons; toggle switches; chip badges.
- Type: Segoe UI workhorse sans; 34px page leads, 22px dialog titles, 19px card titles, 15px body, 14px labels, 13px metadata; tabular numerals for timers and counts.
- Palette: indigo `#3f51c5` (deep `#3343ab`, bright `#637aec`), ink `#1b2337`, slate `#4c5a70`, muted `#6b7890`, success `#168a52`, warning `#9a5b00`, danger `#b03a30`.
- States: indigo fill + halo for selection; amber 3px→indigo focus outline; green/amber/red status always with text; pill disabled = grey wash.
- Motion: 420ms workspace entrance, 240ms dialog rise, 140ms control transitions; reduced motion removes all.

## Fidelity inventory

| Ingredient | Commitment | Medium |
| --- | --- | --- |
| Navbar | White sticky bar: authored two-page mark + wordmark left; indigo nav pills + readiness chip right | Semantic HTML/CSS, authored SVG |
| Library | Page lead, tools row, package card grid with chips, Start Exam / Practice Drill actions, quiet archive/delete | Semantic HTML/CSS |
| Drill dialog | "Create Practice Drill" modal: section/module/skill tiles with Select All + paging, question-limit chips, timing tiles, toggles, plan summary, Start Drill CTA | Semantic HTML/CSS |
| Player | Section title + authored Directions disclosure, centered timer with Hide, icon-over-label tools, dashed accent strips, split panes, question banner with dark number square + bookmark mark control, 2px answer rows with letter circles, footer wordmark + black position pill + Back/Next/Submit pills | Semantic HTML/CSS, authored SVG, CSS-only accent strip |
| Navigator | Centered modal: title, four-state legend, numbered grid (dashed/tinted/indigo-filled/red flag), backdrop and Escape-less close via button/backdrop | Semantic HTML/CSS |
| Ready fallback | Loading gate, transitions, import, mapper, history, results share the token system | Semantic HTML/CSS |

## Literalization boundary

The user's reference screenshots are the style and composition reference, not a source of raster UI or copy. No "bluebooky.com" watermarks, logos, or text are reproduced; all controls, strips, and icons remain semantic code or authored SVG.

## Unresolved

None blocking. The `.impeccable/design.json` sidecar predates this direction and is stale; refresh with the `document` command if tooling needs it.
