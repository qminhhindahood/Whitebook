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

Approved comp: `.impeccable/mocks/shell-option-2.png`.

A calm, familiar exam-workspace shell built around a fixed pale-ice left rail and one broad Library canvas. The memorable moment is the immediate operational read: Whitebook is ready, the library is empty, and the next action is unambiguous.

## System reading

- Component grammar: flat white and pale-ice regions, 1px cool-slate dividers, 4–6px corners, no decorative shadow stack.
- Type: Segoe UI workhorse sans; 32px page title, 24px section title, 18px item title, 16px body/control, 14px metadata.
- Palette: ink navy `#14233b`, cobalt `#2166d1`, pale ice `#edf3fa`, canvas `#f8fafc`, white, slate `#526176`, success `#168a52`.
- States: a 4px cobalt active rail marker; cobalt primary action; visible amber/cobalt focus outline; green check plus text for ready state.
- Motion: one short opacity/translate entrance for the workspace; controls use direct color/state changes; reduced motion removes the entrance.

## Fidelity inventory

| Ingredient | Commitment | Medium |
| --- | --- | --- |
| Left rail | 220px desktop rail with mark, three navigation items, bottom readiness block | Semantic HTML/CSS and authored SVG icons |
| Whitebook mark | Independent two-page line mark, no borrowed trademark geometry | Authored SVG |
| Workspace header | 64px white bar with Library title and Application ready status | Semantic HTML/CSS |
| Library lead | Practical title, two-line local-storage copy, one Import package action | Semantic HTML/CSS |
| Empty package table | Five-column header and one large empty row with document symbol | Semantic table plus authored SVG |
| Before you begin | One full-width bordered region split into PDF, CSV, and local-storage checks | Semantic list, CSS grid, authored SVG |
| Primary action | Solid cobalt rectangular control with compact upload icon | Native button and authored SVG |

## Literalization boundary

The generated comp is the composition and finish reference, not a source of raster UI. All text, controls, table structure, icons, states, and layout remain semantic code. Generated blur, accidental rounded outer-frame chrome, and any imprecise image text are not literalized.

## Unresolved

Import, History, and package-list interactions are placeholders until their parent tickets implement behavior. They remain visibly unavailable instead of pretending to work.
