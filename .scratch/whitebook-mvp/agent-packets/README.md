# Whitebook backend micro-tasks

These packets extract small, non-frontend seams from Tickets 02–15 so independent agents can work without claiming an entire feature. They are support work only: completing one packet does not complete its parent ticket.

## Dispatch rules

Give one packet to one agent. Each agent should start from the latest `main`, make only the files listed under **Owned paths**, run the packet's verification command, and return one commit hash. Merge packets individually.

Every agent must first read `AGENTS.md`, `CONTEXT.md`, the named parent ticket, and the named specification section. Public behavior in `.scratch/whitebook-mvp/spec.md` overrides implementation suggestions in a packet.

## Packets

| Packet | Parent tickets | Character | Cross-packet dependency |
| --- | --- | --- | --- |
| [A — Answer CSV contract](A-answer-csv-contract.md) | 02, 14 | Pure parsing and validation | None |
| [B — PDF preflight](B-pdf-preflight.md) | 02, 14 | File validation and private copy | None |
| [C — Package eligibility](C-package-eligibility.md) | 04, 08 | Pure classification | None |
| [D — Grading kernel](D-grading-kernel.md) | 05, 11 | Pure normalization and scoring | None |
| [E — Practice selection rules](E-practice-selection-rules.md) | 07 | Pure planning rules | None |
| [F — Safe paths and redaction](F-safe-paths-and-redaction.md) | 12, 13, 14 | Security primitives | None |
| [G — Local Math configuration](G-local-math-configuration.md) | 10, 13, 14 | Environment/config handling | None |

All packets deliberately exclude React components, CSS, browser automation, FastAPI routes, migrations, and end-to-end wiring. The integration owner adds those after merging.
