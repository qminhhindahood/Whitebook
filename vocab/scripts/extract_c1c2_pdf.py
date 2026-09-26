"""Extract the C1-C2 WIC 500 vocabulary table PDF into staging JSONL.

Usage: .venv/Scripts/python.exe scripts/extract_c1c2_pdf.py

Layout-aware extraction:
- pymupdf table detection per page gives the row/column grid.
- Cell text is rebuilt from positioned text spans, EXCLUDING spans in the
  watermark font (DejaVuSans-BoldOblique, used only by the '[vietaccepted]'
  watermark - verified across the document). Redaction is not used because
  it clips body glyphs that overlap the watermark.
- The printed STT is reconstructed from positioned digit words inside the
  first column of each row (ReportLab wraps "249" into "24"+"9").
- Wrapped cells are joined per column semantics: word/IPA join without a
  space (mid-word wraps), text columns join with a space.

Every row carries page/row provenance and a review status; STT/sequence
mismatches are flagged rather than silently accepted.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sources" / "SAT_C1C2_WIC_500_VietAccepted (1) (1).pdf"
OUT = ROOT / "staging" / "c1c2_wic500.jsonl"

SOURCE_PATH = r"D:\Notion\SAT_C1C2_WIC_500_VietAccepted (1) (1).pdf"
SOURCE_SHA256 = "a907d7a08c1f79ff39bf0fcf1a29bcc75fbfb82760e07c19210e309c90a57690"

WATERMARK_FONT = "DejaVuSans-BoldOblique"  # used only by the watermark (verified)
FIRST_TABLE_PAGE = 3  # 1-based; pages 1-2 are cover/marketing
LAST_TABLE_PAGE = 28

NO_SPACE_COLS = {1, 2}  # word, IPA columns wrap mid-word
HEADER_KEYWORDS = ("từ vựng", "phát âm", "nghĩa tiếng", "synonyms")


def page_spans(page):
    """Yield (x0, y0, x1, y1, text) for every non-watermark span on the page."""
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                text = span["text"]
                if not text.strip() or span["font"] == WATERMARK_FONT:
                    continue
                x0, y0, x1, y1 = span["bbox"]
                yield x0, y0, x1, y1, text


def cell_text(spans, x_lo, x_hi, y_lo, y_hi, col, sep):
    """Rebuild one cell's text from spans inside the box.

    Spans are grouped into visual lines by y-center; lines join with `sep`
    (no space for mid-word wraps, space for prose). Within a line, spans
    join with a single space when a gap exists between them.
    """
    inbox = [s for s in spans
             if x_lo <= (s[0] + s[2]) / 2 < x_hi and y_lo <= (s[1] + s[3]) / 2 < y_hi]
    if not inbox:
        return ""
    inbox.sort(key=lambda s: (round(s[1], 1), s[0]))
    lines, cur, cur_y = [], [], None
    for s in inbox:
        y = round(s[1], 1)
        if cur_y is None or abs(y - cur_y) <= 2:
            cur.append(s)
            cur_y = y if cur_y is None else cur_y
        else:
            lines.append(cur)
            cur, cur_y = [s], y
    if cur:
        lines.append(cur)
    out_lines = []
    for ln in lines:
        parts, prev_x1 = [], None
        for s in ln:
            if prev_x1 is not None and s[0] - prev_x1 > 1.0:
                parts.append(" ")  # visible gap left by an excluded watermark span
            parts.append(s[4])
            prev_x1 = s[2]
        text = "".join(parts) if sep == "" else " ".join(p.strip() for p in "".join(parts).split(" ") if p.strip())
        if sep != "":
            text = re.sub(r"\s+", " ", " ".join(parts)).strip()
        out_lines.append(text.strip())
    joined = sep.join(out_lines)
    return re.sub(r"\s+", " ", joined).strip() if sep == " " else joined.strip()


def main() -> int:
    doc = pymupdf.open(str(SRC))
    rows = []
    warnings = []
    for pno in range(FIRST_TABLE_PAGE - 1, LAST_TABLE_PAGE):
        page = doc[pno]
        spans = list(page_spans(page))
        digit_words = [w for w in page.get_text("words") if w[4].isdigit()
                       and 40 <= w[1] <= 750 and w[6] >= 1]  # table body band
        tables = page.find_tables().tables
        for t_i, table in enumerate(tables):
            row_bboxes = [r.bbox for r in table.rows]
            if not row_bboxes:
                continue
            # column x-edges: cluster the left edges of all real (non-degenerate)
            # cells plus the table's right edge; page 19 has a degenerate col 0
            edges = []
            for r in table.rows:
                for c in r.cells:
                    if c and (c[2] - c[0]) >= 45:
                        edges.append(c[0])
            edges = sorted(set(round(e, 1) for e in edges))
            merged = []
            for e in edges:
                if not merged or e - merged[-1] > 3:
                    merged.append(e)
            # keep the last 7 edges: [STT, word, IPA, EN, VI, syn] bounds;
            # any earlier edge belongs to a degenerate column (page 19)
            x_edges = merged[-6:] + [row_bboxes[0][2]]
            if len(x_edges) < 7:
                warnings.append(f"page {pno+1} table {t_i}: only {len(x_edges)-1} columns detected")
                continue
            for r_i, (bx0, by0, bx1, by1) in enumerate(row_bboxes):
                # STT cell rebuilt from spans in the first column band
                stt_text = cell_text(spans, bx0, x_edges[1], by0, by1, 0, "")
                stt_digits = re.sub(r"\D", "", stt_text)
                stt = int(stt_digits) if 0 < len(stt_digits) <= 3 else None
                word = cell_text(spans, x_edges[1], x_edges[2], by0, by1, 1, "")
                ipa = cell_text(spans, x_edges[2], x_edges[3], by0, by1, 2, "")
                defn = cell_text(spans, x_edges[3], x_edges[4], by0, by1, 3, " ")
                mean_vi = cell_text(spans, x_edges[4], x_edges[5], by0, by1, 4, " ")
                syns = cell_text(spans, x_edges[5], x_edges[6], by0, by1, 5, " ")
                row_text = " ".join((word, ipa, defn)).lower()
                if any(k in row_text for k in HEADER_KEYWORDS):
                    continue  # header/banner row
                if not word:
                    warnings.append(f"page {pno+1} table {t_i} row {r_i}: STT {stt} but no word text")
                    continue
                rows.append({
                    "stt": stt, "page": pno + 1, "table": t_i, "row": r_i,
                    "front": word, "ipa": ipa, "definition_en": defn,
                    "meaning_vi": mean_vi, "synonyms": syns,
                })
    doc.close()

    seq_rows = sorted(rows, key=lambda r: (r["page"], r["table"], r["row"]))
    mismatch = []
    for i, r in enumerate(seq_rows):
        expected = i + 1
        if r["stt"] is not None and r["stt"] != expected:
            mismatch.append(f"row {i+1}: printed STT {r['stt']} != sequence {expected} (page {r['page']})")
    stts = [r["stt"] for r in seq_rows if r["stt"] is not None]
    dupes = sorted({s for s in stts if stts.count(s) > 1})
    missing = sorted(set(range(1, 501)) - set(stts))

    imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with OUT.open("w", encoding="utf-8", newline="\n") as fh:
        for i, r in enumerate(seq_rows):
            status = "extracted"
            if any(not r[k] for k in ("front", "definition_en", "meaning_vi")):
                status = "review"
            if r["stt"] is None:
                status = "review"
            stt_label = f"{r['stt']:03d}" if r["stt"] is not None else f"seq{i + 1:03d}"
            fh.write(json.dumps({
                "source_deck": "c1c2_wic500",
                "source_ref": f"page:{r['page']}/table:{r['table']}/row:{r['row']}",
                "original_id": f"c1c2-{stt_label}",
                "imported_at": imported_at,
                "source_path": SOURCE_PATH,
                "source_sha256": SOURCE_SHA256,
                "extraction": "pymupdf-table-grid+span-rebuild",
                "review_status": status,
                "stt": r["stt"],
                "front": r["front"],
                "ipa": r["ipa"],
                "definition_en": r["definition_en"],
                "meaning_vi": r["meaning_vi"],
                "synonyms": r["synonyms"],
                "part_of_speech": "",
                "example_en": "",
                "example_vi": "",
                "cefr": "C1-C2",
                "audio": [],
                "raw_fields": {k: r[k] for k in ("ipa", "definition_en", "meaning_vi", "synonyms")},
            }, ensure_ascii=False) + "\n")

    print(f"rows extracted: {len(rows)} -> {OUT}")
    print(f"printed-STT duplicates: {dupes[:20]}")
    print(f"missing from 1..500: {missing[:30]}{' ...' if len(missing) > 30 else ''}")
    for m in mismatch[:20]:
        print("mismatch:", m)
    for w in warnings[:20]:
        print("warn:", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
