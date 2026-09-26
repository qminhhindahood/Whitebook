---
name: Whitebook
description: An indigo exam desk — polished digital exam software for one learner on one laptop.
colors:
  ink: "#1b2337"
  slate: "#4c5a70"
  muted: "#6b7890"
  rule: "#e3e6f0"
  rule-strong: "#c9cfdf"
  canvas: "#f5f6fb"
  white: "#ffffff"
  indigo: "#3f51c5"
  indigo-deep: "#3343ab"
  indigo-bright: "#637aec"
  indigo-tint: "#eef1fc"
  halo: "rgb(99 122 236 / 32%)"
  success: "#168a52"
  warning: "#9a5b00"
  danger: "#b03a30"
typography:
  headline:
    fontFamily: "Segoe UI, Aptos, Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 750
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Segoe UI, Aptos, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 720
    letterSpacing: "-0.015em"
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
  control: "8px"
  tile: "10px"
  card: "14px"
  pill: "999px"
spacing:
  control-gap: "10px"
  group: "26px"
  region: "38px"
  page-x: "34px"
components:
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    height: "46px"
  nav-pill:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    height: "40px"
  card:
    backgroundColor: "{colors.white}"
    border: "1px solid #dfe3f0"
    rounded: "{rounded.card}"
    shadow: "0 1px 2px rgb(23 28 63 / 5%), 0 10px 28px rgb(23 28 63 / 7%)"
  selected-tile:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    halo: "0 0 0 3px {colors.halo}"
  toggle-track-on:
    backgroundColor: "{colors.indigo}"
---

# Design System: Whitebook

## Overview

**Creative North Star: "The Indigo Exam Desk"**

Whitebook reads as polished digital exam software: indigo actions, white rounded
cards with soft shadows on a pale lavender canvas, chip badges, pill buttons,
and segmented tiles that fill indigo under a light-blue halo when selected. The
exam player is a full-bleed split-pane surface framed by a multicolor dashed
accent strip, with a black position pill anchoring the footer.

The 2026-09-05 direction update supersedes the earlier pale-ice rail world: the
user pinned Bluebooky-style reference screenshots, and the shell, library,
drill builder, and player follow them. Standing limits: no copied logos, icons,
wording, or trade dress; the Whitebook mark stays authored; no impersonation of
College Board or any commercial product.

## Colors

- **Action Indigo** (`indigo`): primary buttons, nav pills, selected tiles,
  links, and the letter-circle fill on selected answers. Hover deepens to
  `indigo-deep`.
- **Selection Halo** (`halo`): a 3px light-blue ring on every selected tile or
  answer — the signature selected state.
- **Neutrals**: ink `#1b2337` headings, slate/muted secondary text, cool
  `rule` borders, canvas `#f5f6fb` behind white cards.
- **Semantics**: green ready/correct, amber warnings, red failure — always
  paired with text.

**The Indigo Rule.** Indigo marks interaction and selection; it is not a
decorative page background. The only large indigo surfaces are pill buttons.

## Typography

Segoe UI workhorse stack. Hierarchy from size and weight: 34px/750 page leads,
22px dialog titles, 19px card titles, 15px body, 14px labels, 13px metadata.
Timers and counts use tabular numerals. No display face.

## Layout

- **Shell**: white sticky navbar — brand left; Library / Import / History as
  solid indigo pills and the readiness chip right. No left rail.
- **Library**: page lead, then a responsive card grid (min 330px columns).
- **Drill builder**: a centered modal dialog (max 1280px) over a dimmed
  backdrop: left column of target tiles with paging; right sticky settings
  card with timing, toggles, plan summary, and the Start Drill CTA.
- **Player**: full-bleed, outside the shell. Header (section title +
  Directions disclosure / centered tabular timer with Hide pill /
  icon-over-label tools), dashed accent strip, split panes with draggable
  divider, footer (wordmark / black position pill / indigo pill actions),
  closing accent strip.
- Laptop-first, 1024px minimum; page content capped at 1320px.

## Elevation & Depth

Cards carry a soft two-layer shadow plus a 1px `#dfe3f0` border; modals and
popovers carry a deeper ambient shadow. Selected states add the halo ring.
No gradients elsewhere; the dashed multicolor accent strip is the one
decorative element, owned by the exam player.

## Shapes & Icons

Controls 8px, tiles and answer rows 10px, cards 14px, pills fully rounded.
Icons are authored SVG line work (1.7–2 stroke, rounded caps): nav, upload,
bookmark, calculator, x² reference, exit, chevron, close.

## Components

- **Pills**: primary (indigo fill), outline (white/indigo), soft (pale indigo,
  for secondary footer actions), nav (indigo fill in the navbar).
- **Segmented tiles**: hidden radio/checkbox, centered or left-aligned label;
  selected = indigo fill + white text + halo; disabled = grey wash.
- **Toggle switch**: 46×26 track, knob slides right; on-track indigo.
- **Chips**: small pill badges; `chip--total` is indigo-filled, others tinted.
- **Answer rows**: full-width bordered cards, letter badge at left, actual
  answer content in the card; selected = indigo border/wash + filled badge;
  elimination dims, strikes the letter, and offers Restore. Converted
  packages carry separate stem and per-choice content (text plus optional
  Source PDF crops); unconverted packages still render region images.
- **Question banner**: dark number square, bookmark Mark-for-Review control,
  category at right.
- **Navigator**: centered modal — title, Current/Unanswered/Answered/For
  Review legend, numbered grid (dashed unanswered, tinted answered, indigo
  current, red flag marked).
- **Position pill**: black footer pill "Question N of M" with chevron; opens
  the navigator.

## Motion

One 420ms workspace entrance (opacity/translate), 240ms dialog rise, 140ms
control color transitions, pulsing stage dot while loading. All removed under
`prefers-reduced-motion`.

## Do's and Don'ts

### Do:

- **Do** keep every selected state as indigo fill + halo — never outline-only.
- **Do** pair semantic colors with readable text.
- **Do** keep the player chrome quiet so the PDF region is the visual focus.

### Don't:

- **Don't** copy Bluebook/Bluebooky/College Board logos, wording, or trade
  dress; branding stays "Whitebook" with the authored mark.
- **Don't** add countdown banners in the player, difficulty labels, or
  per-question Check buttons — the product has no such data or behavior. The
  one exception is the Dashboard's SAT test-date section: a compact
  calendar-day countdown to the learner's chosen official SAT Weekend date,
  fed by the reviewed College Board catalog (date-only; never an 8 a.m. or
  other time claim). This supersedes the earlier blanket
  no-dated-administrations rule.
- **Don't** reintroduce the left rail or flat 5px-radius world.
- **Don't** use emoji or Unicode glyphs as interface icons.
