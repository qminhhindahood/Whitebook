# Whitebook vocabulary staging (Starter Deck preparation)

All vocabulary source containers and the full extraction → review → publication
pipeline live in this folder. Originals are untouched in `D:\Notion`. Nothing here
is published to learners yet: every deck is a hash-checked **draft** awaiting
owner review (see `reports/REVIEW_PACK.md` for the decision list).

## Layout

| Path | Contents |
|---|---|
| `INVENTORY.md` | Per-source inventory: paths, SHA-256, page/note counts, text-layer quality, Quizlet status |
| `sources/` | Byte-identical copies of the three supplied containers |
| `extracted/apkg/` | Unpacked Anki package (zstd sqlite decoded; card HTML treated as inert text) |
| `staging/` | `anki_starter.jsonl` (839), `c1c2_wic500.jsonl` (500), `b2c1_1000.jsonl` (1000), `normalized.jsonl` (2339) — every row keeps source path, hash, page/note reference, original ID, import timestamp, review status |
| `scripts/` | The pipeline (see below) |
| `manifests/` | Hash-checked deck manifests (`*-manifest.json` + `*-v*-cards.json`) and the local draft store `vocab-store.sqlite3` |
| `reports/` | `REVIEW_PACK.md`, `preview.html` (Flashcard UI: library + study, phone+desktop), `duplicates.csv`, `audit.json`, page renders, cached OCR TSVs |
| `tests/` | pytest suite for the pipeline (12 tests) |
| `tessdata/` | Tesseract `eng`+`vie` language data (tessdata_best) |

## Pipeline commands (`.venv` in this folder)

```powershell
.venv\Scripts\python.exe scripts\extract_anki.py        # 839 notes from the .apkg
.venv\Scripts\python.exe scripts\extract_c1c2_pdf.py    # 500 rows, table+span layout parse
.venv\Scripts\python.exe scripts\extract_b2c1_pdf.py    # 1000 rows, 300dpi OCR (eng+vie)
.venv\Scripts\python.exe scripts\normalize_audit.py     # common schema + duplicates + audit
.venv\Scripts\python.exe scripts\publish_decks.py all   # manifests + gated local import
.venv\Scripts\python.exe scripts\make_review_pack.py    # REVIEW_PACK.md
.venv\Scripts\python.exe scripts\make_preview_site.py   # Flashcard preview site (reports/preview.html)
.venv\Scripts\python.exe -m pytest tests -q             # 12 passed
```

Tesseract binary: `C:\Program Files\PDF24\tesseract\tesseract.exe` (5.5.2).

## Status

- anki_starter 839/839, c1c2_wic500 500/500, b2c1_1000 1000/1000 — all rows staged
  with provenance; zero quarantines; 353 cross-source duplicate groups listed for
  owner decision (nothing merged or discarded).
- b2c1_1000 rows are OCR-derived and marked `ocr` / `ocr-lowconf` until spot-checked
  against `reports/b2c1_page_renders/`; its IPA column is flagged unreliable.
- Quizlet (~4,000 words): export files were never supplied; not scraped. The owner
  explicitly excluded this source on 2026-09-26 — the consolidation is final with the
  three supplied containers.
- Publication gate: the importer refuses any manifest not marked `published`; it
  becomes `published` only after owner approval flips rows to `approved`.
