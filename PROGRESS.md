# Whitebook task progress

Last updated: 2026-09-05. This is the working tracker for tickets 01–15.

**Implemented** means the feature exists, not that every acceptance check is complete.
**Verified** means the stated automated or browser check actually passed.
The MVP is not yet marked complete.

| Ticket | Feature | Current state | Remaining work |
| --- | --- | --- | --- |
| 01 | Isolated local launcher | Implemented; isolation tests previously passed | Final integrated launcher check |
| 02 | PDF + Answer CSV import | Implemented; API tests passed | Browser upload/diagnostics walkthrough |
| 03 | Question Region mapper | Manual mapping, conservative boundary suggestions and saved-draft reopening implemented | Full drawing/reordering/resume browser checks |
| 04 | Immutable publication | Implemented; API tests passed | Final provenance/validation review |
| 05 | Practice and Raw Accuracy | Implemented; API and loading-component tests passed | Real-PDF browser walkthrough |
| 06 | Pause, recovery, resume | Implemented; checkpoint/break recovery tests passed | Browser-close recovery check |
| 07 | Practice Builder | Filters, mixed Sections, exact module allocation, counts and timing implemented | Final browser checks |
| 08 | Full SAT Simulation | Four Modules, break, expiration and locking implemented | Integrated browser transition checks |
| 09 | Review tools | Marking, elimination, navigation, zoom, resizable divider and warning dismissal implemented | Browser checks; warning dismissal is browser-local |
| 10 | Math tools | Sandboxed Desmos readiness passed with configured key; scientific fallback implemented | Full player overlay/state persistence browser checks |
| 11 | Results and mistake practice | Raw Accuracy, timing breakdowns, filters, retake and mistakes through Practice Builder implemented | Final browser checks |
| 12 | Library and History | Archive/restore/delete and resume implemented | Final browser lifecycle checks |
| 13 | Backups | Hash validation, reference assets and rollback implemented; focused tests passed | Additional hostile-archive validation and browser feedback |
| 14 | Diagnostics and security | Local authorization, Windows path checks, strict CSV parsing and loading logs implemented | Final adversarial upload/backup checks |
| 15 | Integrated laptop MVP | Production build and 21 frontend tests passed; setup and CSV documentation added | Complete browser acceptance walkthrough |

## Verification log

- Earlier baseline: 62 backend tests passed.
- Latest focused backend checks passed for calculator readiness, resume, countdowns, secret exclusion, mixed selection, backup rollback, draft correction and region bounds.
- 2026-09-05: **21 frontend tests passed**; production build passed.
- Expanded backend suite: **85 passed in 97.34 seconds** before the calculator-frame addition. Final rerun pending.
- Calculator-frame HTTP policy test passed; the main app disallows dynamic evaluation while the opaque-origin calculator sandbox permits Desmos's required evaluation and embedded fonts.
- Live configured-key browser probe: script, constructor, instance, readable state and usable dimensions all passed.
- The 1440 × 900 Import layout was visually inspected. The static design detector returned no findings.

## Verification blockers and caveats

- Chrome's upload tool rejects `D:\Notion\UI` as outside its configured workspace roots. No bypass was attempted. This blocks the visible file-upload/mapping/player walkthrough; API upload tests still pass.
- Current Chrome and Edge end-to-end acceptance has not been signed off.
- Backup rollback is tested for injected filesystem errors, not abrupt power loss.
- The Reference Sheet and real question-bank rendering still require the complete player walkthrough.
- A key found in `.env.example` was moved into ignored `.env`; the template's other edits were preserved. Do not commit local credentials.

## User configuration

- Desmos key: `.env`, using `WHITEBOOK_DESMOS_API_KEY=...`. Do not commit this file.
- Reference Sheet: `data/assets/reference-sheet.png` (present locally); PNG only.
- Source PDFs and matching CSVs: choose them through Import. Files placed in a source folder are not automatically imported.
- Runtime data is ignored by Git. The user-provided `ref/` folder is preserved separately.

## Implementation order

1. Restore browser file-upload access for this workspace, or perform the documented upload walkthrough manually.
2. Walk through PDF import → mapping → Practice → pause/resume → Results in Chrome and Edge.
3. Verify player Math failure/fallback, state persistence, resizable overlays and Simulation transitions.
4. Finish adversarial backup acceptance and check off the original ticket criteria only where supported by evidence.

Detailed acceptance criteria: `.scratch/whitebook-mvp/issues/`.
Small non-frontend handoff tasks: `.scratch/whitebook-mvp/agent-packets/README.md`.
