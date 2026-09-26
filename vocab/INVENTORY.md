# Vocabulary source inventory — Starter Deck preparation

Consolidated 2026-09-26. All four vocabulary source containers are gathered here;
originals remain untouched in `D:\Notion`. Nothing here is published to the website —
this folder is owner-controlled local staging for extraction, review, and manifest build.

## Folder layout

- `sources/` — byte-identical copies of the source containers (do not edit).
- `extracted/` — unpacked container contents (e.g. the Anki `.apkg`).
- `staging/` — normalized draft rows with per-row provenance.
- `reports/` — inventory, audit, duplicate and publication reports, sample renders.

## Source 1 — C1–C2 WIC 500 (VietAccepted)

| Field | Value |
|---|---|
| Original path | `D:\Notion\SAT_C1C2_WIC_500_VietAccepted (1) (1).pdf` |
| Local copy | `sources/SAT_C1C2_WIC_500_VietAccepted (1) (1).pdf` |
| Type | PDF 1.7, produced by ReportLab, AES-256 encrypted (opens without user password) |
| Size | 218,075 bytes |
| SHA-256 | `a907d7a08c1f79ff39bf0fcf1a29bcc75fbfb82760e07c19210e309c90a57690` |
| Pages | 28 (page 1 is a cover; `500 TỪ VỰNG C1-C2`, `1.012 câu WIC · 4.048 options`) |
| Text layer | Good — ~63,000 characters extracted, no near-empty pages |
| Expected count | ~500 words |
| Vietnamese content | Yes (diacritics present in text layer) |

## Source 2 — B2–C1 1000 words (VietAccepted)

| Field | Value |
|---|---|
| Original path | `D:\Notion\1000_tu_SAT_B2-C1_VietAccepted (1).pdf` |
| Local copy | `sources/1000_tu_SAT_B2-C1_VietAccepted (1).pdf` |
| Type | PDF 1.4, title `SAT_Advanced_Vocabulary_1000_watermarked` |
| Size | 13,369,290 bytes |
| SHA-256 | `cec97c4c5c599b0f4bd2b741353859ad38fd7fd962440173d004a7b659bcaf01` |
| Pages | 43, one full-page image per page, **no text layer (0 characters)** |
| Expected count | ~1,000 words |
| Extraction | Requires local OCR (Tesseract 5.5.2 present at `C:\Program Files\PDF24\tesseract`; language data must be supplied — see `reports/`) |

## Source 3 — Anki Starter package (aanhlle's SAT Words)

| Field | Value |
|---|---|
| Original path | `D:\Notion\[STARTER] aanhlle's SAT Words ⚡ (1).apkg` |
| Local copy | `sources/[STARTER] aanhlle's SAT Words ⚡ (1).apkg` |
| Unpacked to | `extracted/apkg/` (`collection.anki2`, `collection.anki21b`, `media`, `meta`) |
| Size | 212,986 bytes |
| SHA-256 | `b6e153ba76ee400ced57fcf1c94cda3feb9cd755ccaf8eb32568c9ec6f1c22ef` |
| Expected count | ~750 words |
| Notes | Legacy `collection.anki2` holds 1 placeholder note; real data is in the zstd-compressed `collection.anki21b`. Card HTML is treated as inert text — never executed. |

## Source 4 — Quizlet folder (dsat-va-2026) — EXCLUDED BY OWNER

- Owner reference: https://quizlet.com/user/AllahuAkbarWallahi/folders/dsat-va-2026?i=6k192q&x=1xqt
- Expected count: ~4,000 words.
- No export files were ever found locally (searched `D:\Notion`, Downloads, Desktop,
  Documents for `*quizlet*`, `*dsat*`, `*va-2026*`, `*.csv`, `*.tsv`).
- **On 2026-09-26 the owner explicitly chose to exclude this source.** The consolidation
  is final with the three supplied containers. It can be reintroduced later as a new
  source if an export is supplied; Quizlet was never scraped per the plan.

## Permissions / provenance

Owner-supplied files for personal Starter Deck preparation. Confirmation of which
definitions, translations, examples, images and audio may be republished is recorded in
`reports/` as the audit proceeds. No source file leaves local storage.
