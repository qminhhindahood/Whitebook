---
name: Whitebook
description: A calm, private exam workspace built for focused laptop use.
colors:
  ink-navy: "#14233b"
  slate: "#526176"
  muted: "#718096"
  cool-rule: "#d6dfea"
  pale-ice: "#edf3fa"
  canvas: "#f8fafc"
  white: "#ffffff"
  cobalt: "#2166d1"
  cobalt-deep: "#174fa6"
  success: "#168a52"
  warning: "#9a5b00"
  danger: "#a33b32"
typography:
  headline:
    fontFamily: "Segoe UI, Aptos, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 720
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Segoe UI, Aptos, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Segoe UI, Aptos, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Segoe UI, Aptos, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 700
rounded:
  active-marker: "4px"
  control: "5px"
  region: "6px"
spacing:
  compact: "8px"
  control-gap: "14px"
  group: "24px"
  region: "28px"
  workspace: "42px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
  navigation-active:
    backgroundColor: "#dce9f9"
    textColor: "{colors.cobalt-deep}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "54px"
---

# Design System: Whitebook

## Overview

**Creative North Star: "The Local Exam Desk"**

Whitebook feels like a prepared desk at the start of a serious study session: quiet, orderly, and immediately operational. A pale navigation rail establishes place, while a broad white work surface gives source material and testing controls room to breathe.

The system favors clear state over decoration. Cobalt identifies the next deliberate action, green always arrives with readable readiness text, and authored line icons keep the application independent without making the learner decode a novel visual language.

**Key Characteristics:**

- Fixed pale-ice navigation rail beside a broad white work surface.
- Restrained cobalt actions and ink-navy hierarchy.
- Flat regions separated by cool rules instead of layered cards.
- Compact, consistent line icons paired with visible text.

## Colors

The palette is restrained: cool neutrals own most of the surface, cobalt is reserved for interaction, and semantic colors report real state.

### Primary

- **Action Cobalt** (`cobalt`): primary actions, active icon strokes, and selected navigation emphasis.
- **Deep Action Cobalt** (`cobalt-deep`): hover and strong active text.

### Neutral

- **Desk Ink** (`ink-navy`): headings, important labels, and the Whitebook mark.
- **Working Slate** (`slate`): explanatory copy and secondary state text.
- **Quiet Slate** (`muted`): inactive status and low-emphasis details.
- **Cool Rule** (`cool-rule`): dividers and container boundaries.
- **Pale Ice** (`pale-ice`): the navigation rail and scrollbar track.
- **Work Canvas** (`canvas`): browser background surrounding the application surface.
- **White Surface** (`white`): the primary operating field and content regions.

### Secondary

- **Ready Green** (`success`): confirmed readiness only, always paired with text.
- **Attention Amber** (`warning`): actionable, nonfatal status copy.
- **Failure Red** (`danger`): unavailable and failed states.

**The Quiet Accent Rule.** Cobalt identifies interactive priority; it does not become a decorative page background.

## Typography

**Display Font:** none; Whitebook is an operating surface rather than a promotional one.

**Body Font:** Segoe UI with Aptos and Arial fallbacks.

**Character:** A familiar Windows workhorse stack keeps instructions and state effortless to scan. Hierarchy comes from measured size and weight changes, not an ornamental display face.

### Hierarchy

- **Headline** (720, 32px, -0.025em): primary workspace section headings.
- **Title** (700, 20px, -0.01em): persistent workspace and panel titles.
- **Body** (400, 15px, 1.55): explanations, empty states, and task guidance, held near a 70-character measure.
- **Label** (700, 14px): table headers, compact controls, and metadata.
- **Brand wordmark** (700, 21px, 0.12em, uppercase): the sole wide-tracked type treatment.

**The Operational Type Rule.** Every text style must improve scanning, status recognition, or task order; decorative type changes do not belong in the application shell.

## Layout

Laptop layouts use a fixed 220px rail and a fluid workspace with a 1024px minimum application width. The workspace body is capped at 1320px and uses a 42px outer rhythm; below 1180px, outer padding tightens while the rail and task hierarchy remain stable.

Major task regions stack in reading order: page identity, introduction and action, durable content region, then preparation or supporting guidance. Groups use 8–24px internal spacing and 28–44px separation between major regions.

**The One Workspace Rule.** A screen gets one broad operating field; supporting regions join it rather than fragmenting the task into a dashboard of equal cards.

## Elevation & Depth

Whitebook is flat by design. Tonal changes and one-pixel cool rules establish region boundaries; the shell currently uses no shadows. Interactive depth comes from direct color changes and a one-pixel active press, never ambient card elevation.

**The Rule-Before-Shadow Rule.** Use a boundary line or surface change before introducing elevation. A shadow requires a future interaction that genuinely moves above the workspace.

## Shapes

Controls use compact 5px corners, operating regions use 6px corners, and the active navigation marker uses a 4px leading edge. Circles are reserved for status dots. Authored icons use rounded line caps and joins with a consistent 1.7–1.8 stroke weight.

## Components

### Buttons

- **Shape:** compact rectangular control with gently eased corners (`control`).
- **Primary:** Action Cobalt with white text, 48px tall, and 22px horizontal padding.
- **Hover / Focus:** Deep Action Cobalt on hover; a 3px amber focus outline with 3px separation; a one-pixel press movement.

### Cards / Containers

- **Corner Style:** restrained region corner (`region`).
- **Background:** White Surface or the light table-header tint already present in the shell.
- **Shadow Strategy:** none; see Elevation & Depth.
- **Border:** one-pixel Cool Rule.
- **Internal Padding:** 24–26px for supporting regions.

### Navigation

Navigation is a text-and-icon row at least 54px tall. Default items are transparent, hover uses a stronger pale-ice field, and the active item adds a cobalt leading marker, blue-tinted field, and deep-cobalt text. The fixed rail also owns the local-readiness block at its bottom edge.

### Readiness status

Readiness always combines a colored dot or shield state with plain text. “Ready,” “Checking,” and “Unavailable” remain readable without color, and status changes use `aria-live` or `role="status"` where appropriate.

## Do's and Don'ts

### Do:

- **Do** give source material and exam controls one dominant work surface.
- **Do** pair every semantic color with explicit status or action text.
- **Do** use authored SVG icons with the established rounded stroke character.
- **Do** preserve ordinary browser focus and selection behavior while styling them from the palette.

### Don't:

- **Don't** copy logos, icons, wording, or exact trade dress from Bluebook, Bluebooky, or College Board.
- **Don't** turn operational content into a grid of same-weight cards.
- **Don't** introduce gradients, glass effects, decorative shadows, or gamified reward color into the application shell.
- **Don't** use emoji or Unicode symbols as interface icons.
