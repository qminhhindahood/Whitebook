# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React with Vite for the browser interface, FastAPI for the loopback-only local process, SQLite for durable metadata and Attempt state, and private local files for source documents and derived render caches. A root PowerShell launcher starts the application on Windows and opens the default browser.

## Users

The primary user is one learner working privately on a Windows laptop. They bring their own SAT-style Source PDFs, matching Answer CSV files, and shared Math reference image, then use the resulting Test Packages for realistic Simulation Attempts or configurable Practice Attempts.

## Product Purpose

Whitebook turns one user-selected Source PDF and its answers into a dependable, local SAT-style testing experience. Success means imported questions render faithfully, selected resources are completely ready before timing starts, work survives interruption, and results report exact Raw Accuracy without pretending to produce an official SAT score.

## Positioning

Whitebook combines a learner-authored PDF-region workflow with native answer controls and strict attempt-readiness gates. The PDF remains the visual source of truth while the validated Answer Manifest remains the grading source of truth.

## Operating Context

- Runs entirely on one laptop through current Chrome or Edge.
- Uses exactly one Test Package per Attempt; packages are never silently combined.
- Supports a full SAT-shaped Simulation Attempt and a configurable Practice Attempt.
- Math Attempts use the official Desmos embed when configured and a user-provided zoomable Reference Sheet PNG.
- The learner may pause and resume durable Attempts and review locally stored history.

## Capabilities and Constraints

- The application is single-user, local-only, loopback-bound, and protected by a per-launch capability token.
- The Answer CSV v1 columns are `section,module,question_number,type,correct_answer,category`.
- Reading and Writing and Math each preserve two ordered Modules; a Practice Attempt may select one Module or a custom subset.
- Timing modes are SAT-Paced Timing for complete Modules, Custom Countdown, and Elapsed Timing.
- Every selected resource must pass the Attempt Loading Gate before questions or timing become available. Math readiness includes Desmos.
- Results are Raw Accuracy and timing breakdowns only. There are no scaled scores, adaptive scoring, explanations, difficulty labels, skill labels, or unscored questions.
- The interface targets laptop viewports. Phone-specific layouts, dark theme, cloud hosting, accounts, telemetry, and desktop-shell packaging are outside the MVP.

## Brand Commitments

- The product name is Whitebook.
- The interaction model should feel familiar to users of polished digital exam software, with Bluebook and Bluebooky named by the user as functional references.
- Code, assets, wording, icons, and visual details must be independently created; Whitebook must not impersonate College Board or copy Bluebook or Bluebooky trade dress.
- The experience should be calm, focused, and operational rather than gamified.

## Evidence on Hand

- The approved product specification is at `.scratch/whitebook-mvp/spec.md`.
- Domain language and boundaries are recorded in `CONTEXT.md` and `docs/adr/`.
- Implementation tickets are at `.scratch/whitebook-mvp/issues/`.
- The user supplied the required Reading and Writing category list through an image during discovery; the confirmed text list is recorded in `CONTEXT.md` and the specification.
- The Desmos API documentation is the calculator-integration authority: `https://www.desmos.com/api/v1.12/docs/index.html#document-calculator`.
- The user will provide the global Math Reference Sheet PNG and the Desmos API key later. No testimonials, benchmarks, customer claims, or official College Board affiliation exist and none should be fabricated.

## Product Principles

1. Readiness before access: an Attempt starts only after every selected dependency is genuinely usable.
2. Source fidelity, grading clarity: preserve the PDF visually while keeping answer behavior native and deterministic.
3. Local durability: protect the learner's documents, answers, timing, and progress from accidental loss or exposure.
4. Honest outcomes: report only what the imported material and recorded responses can support.
5. Familiar behavior, independent identity: use established exam interaction conventions without copying another product's expression.

## Accessibility & Inclusion

Preserve ordinary browser Tab, Enter, Space, radio-arrow behavior, semantic native controls, and visible focus. Because question content may remain visual PDF regions without transcribed text, Whitebook does not claim full screen-reader conformance for that source content in the MVP.
