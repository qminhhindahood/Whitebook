"""OCR-extract the B2-C1 1000-word vocabulary PDF (image-only pages) into staging JSONL.

Usage: .venv/Scripts/python.exe scripts/extract_b2c1_pdf.py [--pages N,M-...]

Pipeline per page:
1. Render at 300 DPI grayscale via pymupdf.
2. Threshold away light pixels (<200 -> black keeps dark body text; the tiled
   'VietAccepted' watermark is light gray and mostly disappears).
3. Tesseract 5.5.2 (eng+vie, tessdata_best) -> TSV word boxes (cached).
4. Rebuild table rows: STT numbers in the first column anchor each row;
   remaining words are bucketed into 6 columns by x-band and joined per row.

All rows are OCR-derived: review_status is 'ocr' (owner should spot-check
against page renders) or 'ocr-lowconf' when confidence is poor. IPA glyphs
(schwa, stress marks) are unreliable under OCR and are flagged.
"""
import csv
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sources" / "1000_tu_SAT_B2-C1_VietAccepted (1).pdf"
OUT = ROOT / "staging" / "b2c1_1000.jsonl"
TSV_DIR = ROOT / "reports" / "ocr_tsv"
PNG_DIR = ROOT / "reports" / "b2c1_page_renders"
TESSERACT = Path(r"C:\Program Files\PDF24\tesseract\tesseract.exe")
TESSDATA = ROOT / "tessdata"

SOURCE_PATH = r"D:\Notion\1000_tu_SAT_B2-C1_VietAccepted (1).pdf"
SOURCE_SHA256 = "cec97c4c5c599b0f4bd2b741353859ad38fd7fd962440173d004a7b659bcaf01"

FIRST_TABLE_PAGE = 3   # 1-based; page 1 cover, page 2 instructions
LAST_TABLE_PAGE = 43
EXPECTED_ROWS = 1000

# x-bands at 300 DPI (page width 2550), from measured OCR boxes
COLS = {"stt": (150, 300), "word": (300, 560), "ipa": (560, 990),
        "en": (990, 1665), "vi": (1665, 2070), "syn": (2070, 2540)}


def ocr_page(pno: int) -> tuple[list[dict], list[int]]:
    """OCR one 0-based page. Returns (word dicts, row-line y centers)."""
    TSV_DIR.mkdir(parents=True, exist_ok=True)
    tsv_path = TSV_DIR / f"page{pno + 1:02d}.tsv"
    lines_path = TSV_DIR / f"page{pno + 1:02d}.lines.json"
    if not tsv_path.exists() or not lines_path.exists():
        doc = pymupdf.open(str(SRC))
        pix = doc[pno].get_pixmap(dpi=300, colorspace=pymupdf.csGRAY)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
        doc.close()
        PNG_DIR.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.where(img < 200, 0, 255).astype(np.uint8)).save(TSV_DIR / f"page{pno + 1:02d}.png")
        # row separator rules: light-blue lines vanish at thr=200; detect on
        # the raw grayscale at thr=230 as near-full-width dark runs
        th = img < 230
        frac = th[:, 200:2300].mean(axis=1)
        ys = np.where(frac > 0.5)[0]
        groups = []
        for y in ys:
            if groups and y - groups[-1][-1] <= 4:
                groups[-1].append(y)
            else:
                groups.append([y])
        centers = [int(np.mean(g)) for g in groups]
        lines_path.write_text(json.dumps(centers))
        if not tsv_path.exists():
            subprocess.run(
                [str(TESSERACT), str(TSV_DIR / f"page{pno + 1:02d}.png"),
                 str(tsv_path.with_suffix("")),
                 "-l", "vie+eng", "--tessdata-dir", str(TESSDATA),
                 "-c", "tessedit_create_tsv=1"],
                check=True, capture_output=True)
    centers = json.loads(lines_path.read_text())
    words = []
    with tsv_path.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            try:
                conf = float(r["conf"])
            except (ValueError, KeyError):
                continue
            text = (r.get("text") or "").strip()
            if not text or conf <= 0:
                continue
            words.append({"x": int(r["left"]), "y": int(r["top"]),
                          "w": int(r["width"]), "h": int(r["height"]),
                          "conf": conf, "text": text})
    # dedicated pass for the STT column: single digits vanish from the
    # full-page OCR, so re-OCR the cropped column with a digit whitelist
    stt_tsv = TSV_DIR / f"page{pno + 1:02d}.stt.tsv"
    if not stt_tsv.exists():
        col_img = Image.open(TSV_DIR / f"page{pno + 1:02d}.png").crop((140, 0, 300, 3300))
        col_img.save(stt_tsv.with_suffix(".png"))
        subprocess.run(
            [str(TESSERACT), str(stt_tsv.with_suffix(".png")),
             str(stt_tsv.with_suffix("")), "--psm", "6",
             "-c", "tessedit_char_whitelist=0123456789",
             "--tessdata-dir", str(TESSDATA), "-c", "tessedit_create_tsv=1"],
            check=True, capture_output=True)
    with stt_tsv.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            try:
                conf = float(r["conf"])
            except (ValueError, KeyError):
                continue
            text = (r.get("text") or "").strip()
            if not text or conf <= 0:
                continue
            words.append({"x": int(r["left"]) + 140, "y": int(r["top"]),
                          "w": int(r["width"]), "h": int(r["height"]),
                          "conf": conf, "text": text, "stt_pass": True})
    # dedicated pass for the word column: some bold words vanish from the
    # full-page pass under auto page segmentation; psm 6 on the crop sees them
    word_tsv = TSV_DIR / f"page{pno + 1:02d}.word.tsv"
    if not word_tsv.exists():
        col_img = Image.open(TSV_DIR / f"page{pno + 1:02d}.png").crop((280, 0, 600, 3300))
        col_img.save(word_tsv.with_suffix(".png"))
        subprocess.run(
            [str(TESSERACT), str(word_tsv.with_suffix(".png")),
             str(word_tsv.with_suffix("")), "--psm", "6",
             "-l", "vie+eng", "--tessdata-dir", str(TESSDATA),
             "-c", "tessedit_create_tsv=1"],
            check=True, capture_output=True)
    with word_tsv.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            try:
                conf = float(r["conf"])
            except (ValueError, KeyError):
                continue
            text = (r.get("text") or "").strip()
            if not text or conf <= 0:
                continue
            words.append({"x": int(r["left"]) + 280, "y": int(r["top"]),
                          "w": int(r["width"]), "h": int(r["height"]),
                          "conf": conf, "text": text, "word_pass": True})
    return words, centers


def col_of(x_center: int) -> str | None:
    for c, (lo, hi) in COLS.items():
        if lo <= x_center < hi:
            return c
    return None


HEADER_PAT = re.compile(r"(vừng|phiên âm|nghĩa tiếng|đồng nghĩa)", re.I)
WM_PAT = re.compile(r"vietaccept", re.I)
HEADER_LEXICON = {"từ", "vựng", "phien", "phiên", "am", "âm", "nghĩa", "nghĩa",
                  "tiếng", "anh", "việt", "viet", "đồng", "đông"}


def parse_page(words: list[dict], lines: list[int]) -> list[dict]:
    for w in words:
        w["col"] = col_of(w["x"] + w["w"] / 2)
        w["cy"] = w["y"] + w["h"] / 2
        if w.get("word_pass"):
            w["col"] = "word" if 250 <= (w["x"] + w["w"] / 2) <= 620 else None
    # word-pass words fill gaps in the full-page pass; where both saw the
    # same word, the full-page reading wins
    main_word_cys = [w["cy"] for w in words if w["col"] == "word" and not w.get("word_pass")]
    words = [w for w in words
             if not (w.get("word_pass") and w["col"] == "word"
                     and any(abs(w["cy"] - c) < 30 for c in main_word_cys))]
    if len(lines) < 2:
        return []
    # row bands between consecutive rule lines
    bands = list(zip(lines[:-1], lines[1:]))
    stt_words = [w for w in words if w["col"] == "stt" and re.fullmatch(r"\d{1,4}", w["text"])
                 and w["conf"] >= 60]
    # the digit-pass reading is authoritative; drop any full-page word that
    # duplicates its position (the full pass can misread "551" as "51")
    dedup = []
    for w in sorted(stt_words, key=lambda w: -int(w.get("stt_pass", False))):
        if any(abs(w["cy"] - d["cy"]) < 30 for d in dedup):
            continue
        dedup.append(w)
    stt_words = dedup
    rows = []
    for lo, hi in bands:
        anchors = sorted((w for w in stt_words if lo < w["cy"] < hi),
                         key=lambda w: (w["cy"], w["x"]))
        if not anchors:
            continue  # header band or banner
        if len(anchors) > 1:
            # a missed rule line merged two rows; split only at a real row
            # gap (>45 px) - vertically split digits ("551" -> "55"+"1") sit
            # ~25 px apart and must stay one anchor group
            gaps = [(anchors[i + 1]["cy"] - anchors[i]["cy"], i)
                    for i in range(len(anchors) - 1)]
            gaps.sort(reverse=True)
            if gaps[0][0] > 45:
                cut = anchors[gaps[0][1] + 1]["cy"]
                rows.extend(parse_band(words, lo, cut, anchors[:gaps[0][1] + 1]))
                rows.extend(parse_band(words, cut, hi, anchors[gaps[0][1] + 1:]))
            else:
                rows.extend(parse_band(words, lo, hi, anchors))
        else:
            rows.extend(parse_band(words, lo, hi, anchors))
    return rows


def parse_band(words: list[dict], lo: float, hi: float, anchors: list[dict]) -> list[dict]:
    members = [w for w in words
               if w["col"] and w["col"] != "stt" and lo <= w["cy"] < hi
               and not (w["text"].strip().lower() in HEADER_LEXICON
                        and (w["cy"] - lo < 18 or hi - w["cy"] < 18))]
    cells = {}
    for c in ("word", "ipa", "en", "vi", "syn"):
        col_words = sorted((w for w in members if w["col"] == c),
                           key=lambda w: (round(w["cy"] / 30), w["x"]))
        cells[c] = join_col_words(col_words, c)
    stt_text = "".join(a["text"] for a in sorted(anchors, key=lambda w: (w["cy"], w["x"])))
    if HEADER_PAT.search(cells["word"] + " " + cells["ipa"] + " " + cells["en"]):
        return []  # header band fragments
    return [{"stt": int(stt_text) if stt_text.isdigit() else None,
             "anchor_conf": min(a["conf"] for a in anchors),
             "cy": (lo + hi) / 2,
             "page": None, **cells}]


def join_col_words(col_words: list[dict], col: str) -> str:
    """Join words into lines (clustered by y), lines into text.

    Word/IPA columns wrap mid-word, so lines join with no space; prose
    columns join with a space. Lines are real clusters (y gap > 15 px),
    never fixed-size buckets, so wrapped lines keep their word order.
    """
    if not col_words:
        return ""
    sep = "" if col in ("word", "ipa") else " "
    clean = [w for w in col_words
             if not WM_PAT.search(w["text"])
             and (re.search(r"[\w]", w["text"]) or w["text"] in ("/", "-"))]
    if not clean:
        return ""
    clean.sort(key=lambda w: (w["cy"], w["x"]))
    lines, cur = [], [clean[0]]
    for w in clean[1:]:
        if w["cy"] - cur[-1]["cy"] <= 15:
            cur.append(w)
        else:
            lines.append(cur)
            cur = [w]
    lines.append(cur)
    out = sep.join(" ".join(w["text"] for w in sorted(ln, key=lambda w: w["x"]))
                   for ln in lines)
    return re.sub(r"\s+", " ", out).strip() if sep == " " else out.strip()


def main() -> int:
    doc = pymupdf.open(str(SRC))
    page_count = doc.page_count
    doc.close()
    all_rows = []
    for pno in range(FIRST_TABLE_PAGE - 1, LAST_TABLE_PAGE):
        words, lines = ocr_page(pno)
        rows = parse_page(words, lines)
        for r in rows:
            r["page"] = pno + 1
        all_rows.extend(rows)
        print(f"page {pno+1}: {len(rows)} rows")

    seq_rows = sorted(all_rows, key=lambda r: (r["page"], r["cy"]))
    stts = [r["stt"] for r in seq_rows]
    dupes = sorted({s for s in stts if stts.count(s) > 1})
    missing = sorted(set(range(1, EXPECTED_ROWS + 1)) - set(stts))

    imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    IPA_OK = re.compile(r"^/.*+/$")
    with OUT.open("w", encoding="utf-8", newline="\n") as fh:
        for i, r in enumerate(seq_rows):
            avg_conf = r["anchor_conf"]
            low_conf = avg_conf < 85 or not r["word"] or not r["vi"] or not r["en"]
            ipa_bad = not r["ipa"].startswith("/") or not r["ipa"].endswith("/")
            status = ("ocr-lowconf" if low_conf else "ocr")
            fh.write(json.dumps({
                "source_deck": "b2c1_1000",
                "source_ref": f"page:{r['page']}/stt:{r['stt']}",
                "original_id": f"b2c1-{r['stt']:04d}",
                "imported_at": imported_at,
                "source_path": SOURCE_PATH,
                "source_sha256": SOURCE_SHA256,
                "extraction": "tesseract-eng+vie-300dpi-threshold",
                "review_status": status,
                "stt": r["stt"],
                "front": r["word"],
                "ipa": r["ipa"],
                "ipa_uncertain": ipa_bad,
                "definition_en": r["en"],
                "meaning_vi": r["vi"],
                "synonyms": r["syn"],
                "part_of_speech": "",
                "example_en": "",
                "example_vi": "",
                "cefr": "B2-C1",
                "audio": [],
                "ocr_anchor_conf": round(avg_conf, 1),
                "raw_fields": {k: r[k] for k in ("ipa", "en", "vi", "syn")},
            }, ensure_ascii=False) + "\n")

    print(f"\nrows extracted: {len(seq_rows)} -> {OUT}")
    print(f"duplicate STTs: {dupes[:20]}")
    print(f"missing from 1..{EXPECTED_ROWS}: {missing[:40]}{' ...' if len(missing) > 40 else ''}")
    lowconf = sum(1 for r in seq_rows if r["anchor_conf"] < 85)
    print(f"low-confidence rows: {lowconf}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
