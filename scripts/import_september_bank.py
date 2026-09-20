"""Import the September question bank from the supplied image based PDF.

The source is a page-per-question capture rather than a text PDF.  This
importer keeps each page as a visual Question Region, which preserves charts,
tables, equations, browser captures, and the phone shaped pages without
trying to redraw them as HTML.  It also removes the dark selected-answer
outline when it can be identified from the four answer boxes.

Run from the repository root:

    .venv\\Scripts\\python.exe scripts\\import_september_bank.py

The generated source PDFs and manifests live under question-bank/ (ignored by
Git), while the published packages are stored in the local data directory.
The operation is idempotent by package title and source hash.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"D:\Notion\SEPQB.pdf")
DATA = ROOT / "data"
OUT = ROOT / "question-bank" / "september"
OUT.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(ROOT / "src"))
from whitebook.authoring import PackageAuthoring
from whitebook.question_presentation import QuestionPresentation
from whitebook.storage import connect

sys.path.insert(0, str(ROOT / "scripts"))
import convert_bank_content as geometry  # noqa: I001


PACKAGES = (
    {
        "title": "September R&W",
        "section": "Reading and Writing",
        "page_start": 1,
        "page_end": 218,
        "module_break": 73,
    },
    {
        "title": "September Math",
        "section": "Math",
        "page_start": 219,
        "page_end": 461,
        "module_break": 311,
    },
)


def _page_array(doc: pymupdf.Document, page_number: int) -> np.ndarray:
    """Render at a small analysis scale; the player still uses the original PDF."""
    pix = doc[page_number - 1].get_pixmap(dpi=60, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].copy()


def _bank_config(page_number: int, section: str) -> dict:
    phone = page_number >= 380
    return {
        "top": 0.03 if phone else 0.075,
        "bottom": 0.985 if phone else 0.95,
        "panes": section == "Reading and Writing",
    }


def _long_horizontal_groups(a: np.ndarray) -> list[dict[str, float]]:
    """Find broad horizontal edges, used to distinguish MC from SPR pages."""
    lum = geometry.luminance(a)
    h, w = lum.shape
    mask = lum < 250
    runs: list[tuple[int, int, int]] = []
    for y in range(int(0.12 * h), int(0.82 * h)):
        row = mask[y]
        edges = np.flatnonzero(np.diff(np.r_[False, row, False].astype(np.int8)))
        for x0, x1 in zip(edges[::2], edges[1::2]):
            if x1 - x0 >= 0.30 * w:
                runs.append((y, int(x0), int(x1)))
    groups: list[dict[str, float]] = []
    for y, x0, x1 in runs:
        if groups and y / h - groups[-1]["y"] < 0.01 and abs(x0 / w - groups[-1]["x"]) < 0.05:
            groups[-1]["y1"] = y / h
            groups[-1]["x1"] = max(groups[-1]["x1"], x1 / w)
        else:
            groups.append({"y": y / h, "y1": y / h, "x": x0 / w, "x1": x1 / w})
    return groups


def _ocr_for_response(a: np.ndarray) -> str:
    """Best effort OCR for an SPR answer box; the visual page remains source of truth."""
    # OCR is optional.  The package is still useful when the local Tesseract
    # language data is unavailable because an SPR answer can be corrected in
    # the editable source manifest before publishing a revision.
    import os
    import subprocess
    import tempfile

    exe = Path(r"C:\Program Files\PDF24\tesseract\tesseract.exe")
    tessdata = Path(r"C:\Users\PC\AppData\Local\Temp\tessdata")
    if not exe.exists() or not (tessdata / "eng.traineddata").exists():
        return "0"
    with tempfile.TemporaryDirectory() as td:
        image_path = Path(td) / "page.png"
        Image.fromarray(a).save(image_path)
        env = os.environ.copy()
        env["TESSDATA_PREFIX"] = str(tessdata)
        result = subprocess.run(
            [str(exe), str(image_path), "stdout", "--psm", "6"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            env=env,
            check=False,
        )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    # The source answer box is near the end of the question area.  Keep the
    # last compact mathematical line and strip the watermark/footer noise.
    candidates = [
        re.sub(r"[^0-9A-Za-z.+\-*/=()^ ]", "", line).strip()
        for line in lines
    ]
    candidates = [line for line in candidates if any(ch.isdigit() for ch in line)]
    return candidates[-1][:200] if candidates else "0"


def _response_type(a: np.ndarray, page_number: int, section: str) -> str:
    config = _bank_config(page_number, section)
    result = geometry.analyze_single(a, config, False, True)
    if len(result.get("choices", [])) >= 3:
        return "multiple choice"
    # Failed border detection is common on graph/table pages.  A page with
    # five or more broad edges in the answer area is still a multiple-choice
    # page; a single compact box is a student-produced response.
    groups = _long_horizontal_groups(a)
    if len(groups) >= 5:
        return "multiple choice"
    return "student-produced response"


def _selected_choice(a: np.ndarray, result: dict) -> str:
    choices = result.get("choices", [])
    if len(choices) != 4:
        return "A"
    lum = geometry.luminance(a)
    h, w = lum.shape
    scores: list[float] = []
    for choice in choices:
        x0 = max(0, int(choice["x0"] if "x0" in choice else choice["cx0"]))
        x1 = min(w, int(choice["x1"] if "x1" in choice else choice["cx1"]))
        y0 = max(0, int(choice["y0"] if "y0" in choice else choice["cy0"]))
        y1 = min(h, int(choice["y1"] if "y1" in choice else choice["cy1"]))
        edge = np.concatenate((lum[y0 : min(y0 + 4, y1), x0:x1].ravel(), lum[max(y0, y1 - 4) : y1, x0:x1].ravel()))
        # The selected frame is dark over a substantial fraction of the
        # perimeter, while the normal frame is a pale blue line.  Mean
        # luminance is more stable than the median when anti-aliasing leaves
        # white gaps in a screenshot border.
        scores.append(float(edge.mean()) if edge.size else 255.0)
    return "ABCD"[int(np.argmin(scores))]


def _mask_selected_outline(image: Image.Image, a: np.ndarray, result: dict) -> Image.Image:
    """Lighten only the selected answer's outer frame in the source image."""
    if len(result.get("choices", [])) != 4:
        return image
    selected = _selected_choice(a, result)
    choice = result["choices"]["ABCD".index(selected)]
    arr = np.asarray(image.convert("RGB")).copy()
    ih, iw = arr.shape[:2]
    ah, aw = a.shape[:2]
    x0 = int((choice.get("x0", choice.get("cx0", 0)) / aw) * iw)
    x1 = int((choice.get("x1", choice.get("cx1", aw)) / aw) * iw)
    y0 = int((choice.get("y0", choice.get("cy0", 0)) / ah) * ih)
    y1 = int((choice.get("y1", choice.get("cy1", ah)) / ah) * ih)
    pad = max(2, min(iw, ih) // 700)
    color = np.array([210, 216, 228], dtype=np.uint8)
    arr[max(0, y0) : min(ih, y0 + pad), max(0, x0) : min(iw, x1)] = color
    arr[max(0, y1 - pad) : min(ih, y1), max(0, x0) : min(iw, x1)] = color
    arr[max(0, y0) : min(ih, y1), max(0, x0) : min(iw, x0 + pad)] = color
    arr[max(0, y0) : min(ih, y1), max(0, x1 - pad) : min(iw, x1)] = color
    return Image.fromarray(arr)


def _clean_source_pdf(package: dict, out_pdf: Path) -> None:
    """Copy the source PDF and cover keyed-choice outlines with vector paint."""
    document = pymupdf.open(SOURCE)
    for source_page in range(package["page_start"], package["page_end"] + 1):
        # Use the higher analysis scale for border detection; the four light
        # choice frames on the browser captures are too close together at 60
        # dpi.  This pass is separate from manifest generation and runs once
        # per package.
        rendered = geometry.page_array(document, source_page)
        analysis = geometry.analyze_single(
            rendered, _bank_config(source_page, package["section"]), False, True
        )
        if len(analysis.get("choices", [])) != 4:
            continue
        selected = analysis["choices"]["ABCD".index(_selected_choice(rendered, analysis))]
        page = document[source_page - 1]
        pw, ph = page.rect.width, page.rect.height
        aw, ah = rendered.shape[1], rendered.shape[0]
        x0 = selected.get("x0", selected.get("cx0", 0)) / aw * pw
        x1 = selected.get("x1", selected.get("cx1", aw)) / aw * pw
        y0 = selected.get("y0", selected.get("cy0", 0)) / ah * ph
        y1 = selected.get("y1", selected.get("cy1", ah)) / ah * ph
        band = min(5.0, max(2.0, min(pw, ph) / 260.0))
        light = (0.82, 0.85, 0.90)
        page.draw_rect(pymupdf.Rect(x0, y0, x1, y0 + band), color=None, fill=light, overlay=True)
        page.draw_rect(pymupdf.Rect(x0, y1 - band, x1, y1), color=None, fill=light, overlay=True)
        page.draw_rect(pymupdf.Rect(x0, y0, x0 + band, y1), color=None, fill=light, overlay=True)
        page.draw_rect(pymupdf.Rect(x1 - band, y0, x1, y1), color=None, fill=light, overlay=True)
    temp = out_pdf.with_suffix(".clean.pdf")
    document.save(temp, garbage=4, deflate=True)
    document.close()
    temp.replace(out_pdf)


def _build_pdf_and_manifest(source: pymupdf.Document, package: dict) -> tuple[Path, Path, int]:
    out_pdf = OUT / ("september-rw.pdf" if package["section"] != "Math" else "september-math.pdf")
    out_csv = OUT / ("september-rw-answers.csv" if package["section"] != "Math" else "september-math-answers.csv")
    # Keep the original page numbering and image objects.  The package only
    # exposes its own manifest rows, so pages belonging to the other Section
    # are never reached by the player.  This also avoids re-encoding a
    # 171 MB, image-only PDF and keeps the full visual source intact.
    if not out_pdf.exists() or out_pdf.stat().st_size == SOURCE.stat().st_size:
        _clean_source_pdf(package, out_pdf)
    # The answer CSV was reviewed when first generated; trust it as-is so a
    # reimport for presentation repairs never reruns the slow OCR pass.
    if out_csv.exists():
        page_count = package["page_end"] - package["page_start"] + 1
        return out_pdf, out_csv, page_count
    rows: list[dict[str, object]] = []
    page_count = 0
    for source_page in range(package["page_start"], package["page_end"] + 1):
        rendered = _page_array(source, source_page)
        response_type = _response_type(rendered, source_page, package["section"])
        config = _bank_config(source_page, package["section"])
        analysis = geometry.analyze_single(rendered, config, False, True)
        if response_type == "multiple choice":
            answer = _selected_choice(rendered, analysis)
        else:
            answer = _ocr_for_response(rendered)
        module = 1 if source_page <= package["module_break"] else 2
        module_first = package["page_start"] if module == 1 else package["module_break"] + 1
        question_number = source_page - module_first + 1
        rows.append(
            {
                "section": package["section"],
                "module": module,
                "question_number": question_number,
                "type": response_type,
                "correct_answer": answer,
                "category": "",
            }
        )
        page_count += 1
    with out_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["section", "module", "question_number", "type", "correct_answer", "category"])
        writer.writeheader()
        writer.writerows(rows)
    return out_pdf, out_csv, page_count


def _strict_ink(rendered: np.ndarray) -> np.ndarray:
    """Ink mask that ignores the gray watermark overlay.

    The watermark prints around luminance 150-215 while question content is
    black, so a fixed dark threshold drops the watermark without touching
    text, figures, or the selected choice's dark frame.
    """
    return geometry.luminance(rendered) < 120


def _stem_top(rendered: np.ndarray, default_top: int) -> int:
    """Top of the actual question text, below the capture chrome.

    September captures open with browser rows and a 'Mark for Review'
    header.  The question-number chip is a small dark square left of that
    header on every page; the stem starts below the header row containing
    it.  Pages without a detectable chip keep the untrimmed band top.
    """
    h, w = rendered.shape[:2]
    mask = _strict_ink(rendered)[: int(0.25 * h), int(0.14 * w) : int(0.30 * w)]
    squares = [
        (sl[0].start, sl[0].stop)
        for sl in ndimage.find_objects(ndimage.label(mask)[0])
        if 12 <= sl[0].stop - sl[0].start <= 0.045 * h
        and (sl[1].stop - sl[1].start) <= 0.06 * w
        and (sl[0].stop - sl[0].start) >= 0.6 * (sl[1].stop - sl[1].start)
    ]
    if not squares:
        return default_top
    chip_top, chip_bottom = min(squares, key=lambda s: s[0])
    cluster_bottom = chip_bottom
    for sl in ndimage.find_objects(ndimage.label(mask)[0]):
        if sl[0].start < chip_bottom + 6 and sl[0].stop > chip_top - 6:
            cluster_bottom = max(cluster_bottom, sl[0].stop)
    top = cluster_bottom + max(4, h // 300)
    return min(max(default_top, top), int(0.35 * h))


def _ring_columns(rendered: np.ndarray) -> list[dict[str, object]]:
    """Disc-shaped components in the badge zone, grouped into x columns.

    Ring borders fragmented by the watermark pass produce multiple small
    components per ring; callers merge the y positions before use.  The
    rings only seed approximate choice rows for border snapping - the
    published crops always come from the border pipeline.
    """
    h, w = rendered.shape[:2]
    y_lo, y_hi = int(0.10 * h), int(0.97 * h)
    x_lo, x_hi = int(0.05 * w), int(0.50 * w)
    labels = ndimage.label(rendered[y_lo:y_hi, x_lo:x_hi].min(axis=2) < 150)[0]
    discs: list[dict[str, float]] = []
    for sl in ndimage.find_objects(labels):
        ch, cw = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        cy = (sl[0].start + sl[0].stop) / 2 + y_lo
        cx = (sl[1].start + sl[1].stop) / 2 + x_lo
        if (
            0.007 * w <= ch <= 0.05 * w
            and 0.007 * w <= cw <= 0.05 * w
            and abs(ch - cw) <= 0.6 * max(ch, cw)
        ):
            discs.append({"y": cy, "x": cx})
    discs.sort(key=lambda d: d["x"])
    columns: list[list[dict[str, float]]] = []
    for disc in discs:
        for column in columns:
            if abs(disc["x"] - sum(p["x"] for p in column) / len(column)) <= 0.015 * w:
                column.append(disc)
                break
        else:
            columns.append([disc])
    return [
        {"x": sum(p["x"] for p in column) / len(column), "ys": sorted(p["y"] for p in column)}
        for column in columns
        if len(column) >= 2
    ]


def _merge_ring_fragments(ys: list[float]) -> list[float]:
    """Collapse ring double-detections: a gap far below its neighbours is
    one ring split by watermark overlap or inner-letter components."""
    merged = [float(y) for y in ys]
    changed = True
    while changed and len(merged) > 1:
        changed = False
        for i in range(len(merged) - 1):
            left = merged[i] - merged[i - 1] if i else float("inf")
            right = merged[i + 2] - merged[i + 1] if i + 2 < len(merged) else float("inf")
            if merged[i + 1] - merged[i] < 0.6 * min(left, right):
                merged[i : i + 2] = [(merged[i] + merged[i + 1]) / 2]
                changed = True
                break
    return merged


def _plausible_four(ys: list[float], h: int) -> bool:
    gaps = [ys[i + 1] - ys[i] for i in range(3)]
    return (
        min(gaps) >= 0.02 * h
        and max(gaps) <= 0.18 * h
        and max(gaps) <= 2.4 * min(gaps)
    )


def _hint_windows(column_ys: list[float], correct_letter: str, h: int) -> list[list[float]]:
    """Candidate four-choice row centers from one ring column, best first.

    The watermark splits rings and the selected answer's filled badge hides
    its ring, so a window is either four consecutive merged detections or
    three completed by prepending, appending, or splitting a wide gap.
    A completion inserts exactly one ring, and the inserted slot is the
    selected answer - the known correct letter ranks those first.  These
    are snap hints only; the border pipeline validates every final box.
    """
    merged = _merge_ring_fragments(column_ys)
    letter_index = "ABCD".index(correct_letter) if correct_letter in "ABCD" else -1
    windows: list[tuple[int, float, list[float]]] = []
    for start in range(len(merged) - 3):
        window = merged[start : start + 4]
        if _plausible_four(window, h):
            windows.append((0, -window[0], window))
    for start in range(len(merged) - 2):
        ys = merged[start : start + 3]
        gap1, gap2 = ys[1] - ys[0], ys[2] - ys[1]
        completions: list[tuple[int, list[float]]] = [
            (0, [ys[0] - (gap1 + gap2) / 2, *ys]),  # A hidden
            (3, [*ys, ys[2] + (gap1 + gap2) / 2]),  # D hidden
        ]
        if max(gap1, gap2) <= 2.8 * min(gap1, gap2):
            split = (ys[1] + ys[2]) / 2 if gap2 > gap1 else (ys[0] + ys[1]) / 2
            completions.append((1, sorted([*ys, split])))  # B or C hidden
            completions.append((2, sorted([*ys, split])))
        for inserted, candidate in completions:
            if not _plausible_four(candidate, h):
                continue
            # The hidden ring is the selected answer's own badge.
            windows.append((0 if inserted == letter_index else 1, -candidate[0], candidate))
    windows.sort(key=lambda item: (item[0], item[1]))
    ranked = [item[2] for item in windows]
    unique: list[list[float]] = []
    for window in ranked:
        if all(max(abs(a - b) for a, b in zip(window, kept)) > 4 for kept in unique):
            unique.append(window)
    return unique


def _spr_input_box(rendered: np.ndarray) -> dict[str, int] | None:
    """The SPR answer input, detected with typed ink allowed.

    September input borders are pale (~248), so the box scan runs on a
    near-white threshold; the watermark stays fragmented and cannot form
    paired edges.  The shared analyzer expects an empty input box, but
    these captures hold the typed answer, so interior emptiness is
    replaced by a sparsity bound (a solid dark button is not an input).
    Footer pills and nav buttons are excluded by their right-edge contact.
    """
    h, w = rendered.shape[:2]
    lum = geometry.luminance(rendered)
    dark = lum < 250
    top, bottom = int(h * 0.1), int(h * 0.95)
    short_lines = geometry.horizontal_lines(dark, top, bottom, min_len=0.06 * w)
    small = sorted(
        (
            b
            for b in geometry.box_candidates(short_lines, h, w)
            if 0.05 * w <= b["w"] <= 0.75 * w
            and b["h"] <= 0.14 * h
            and b["x1"] < 0.9 * w
            and b["y0"] > 0.15 * h
        ),
        key=lambda b: b["y0"],
    )
    strict = _strict_ink(rendered)

    def isolated(candidate: dict) -> bool:
        return not any(
            other is not candidate
            and abs(other["x0"] - candidate["x0"]) < 0.012 * w
            and abs(other["x1"] - candidate["x1"]) < 0.012 * w
            and abs(other["y0"] - candidate["y1"]) < 2.5 * candidate["h"]
            for other in small
        )

    for candidate in small:
        box_h = candidate["y1"] - candidate["y0"]
        if candidate["w"] / box_h < 1.35:
            continue
        if not isolated(candidate):
            continue
        interior = strict[
            candidate["y0"] + 4 : candidate["y1"] - 4,
            candidate["x0"] + 4 : candidate["x1"] - 4,
        ]
        if interior.mean() > 0.3:  # solid dark button, not an input
            continue
        above = strict[
            max(top, candidate["y0"] - int(h * 0.12)) : candidate["y0"] - 2,
            candidate["x0"] : candidate["x1"],
        ]
        if above.any():
            return {k: candidate[k] for k in ("x0", "x1", "y0", "y1")}
    return None


def _keyboard_top(rendered: np.ndarray) -> int | None:
    """Top of an on-screen keyboard band covering the lower page."""
    h, w = rendered.shape[:2]
    dark = rendered.min(axis=2) < 200
    for y in range(int(0.5 * h), int(0.9 * h)):
        if dark[y : y + int(0.03 * h)].mean() > 0.5:
            return y
    return None


def _snap_hint_boxes(
    rendered: np.ndarray, windows: list[list[float]]
) -> list[dict[str, int]] | None:
    """Snap ring-hint rows onto the page's real choice box borders.

    Each hinted row expands to a y-band which snap_band anchors to the
    strongest border rows (the hint band itself is the fallback when a
    band's borders are too fragmented).  The shared vertical borders are
    columns dark across every band - the boxes all end on the same lines,
    while the diagonal watermark only crosses a few rows per column - so
    per-band edge scans cannot be skewed by it.  The snapped boxes go
    through analyze_single's forced-box path, so every published crop
    comes from the same border pipeline as August.
    """
    h, w = rendered.shape[:2]
    lum = geometry.luminance(rendered)
    thr = float(np.median(lum)) - 9.0
    pale = lum < thr

    # September's browser frames are pale blue (about luminance 248), so the
    # adaptive analyzer can miss their borders even though the borders are
    # still real geometry.  Recover those borders in the same border-pairing
    # pipeline used by analyze_single, then use ring windows only to select
    # the relevant stack.
    border_mask = lum < 250
    border_lines = geometry.horizontal_lines(
        border_mask, int(0.10 * h), int(0.97 * h), min_len=0.50 * w
    )
    border_boxes = [
        b
        for b in geometry.box_candidates(border_lines, h, w)
        if 0.45 * w <= b["w"] <= 0.90 * w
        and 0.03 * h <= b["h"] <= 0.30 * h
        and b["x0"] > 0.05 * w
        and b["x1"] < 0.97 * w
    ]
    for window in windows:
        # Some phone captures and selected desktop rows have fragmented
        # borders which do not form four complete box candidates.  Rebuild
        # the four row bands from the nearest long horizontal border above
        # and below each hint center.  The hints still select the rows; the
        # published coordinates remain real page-border coordinates.
        step = (window[-1] - window[0]) / 3
        if step > 0:
            long_lines = [
                line
                for line in border_lines
                if line["x1"] - line["x0"] >= 0.50 * w
                and line["x0"] > 0.04 * w
                and line["x1"] < 0.99 * w
            ]
            reconstructed: list[dict[str, int]] = []
            for center in window:
                above = [line for line in long_lines if line["y"] <= center]
                below = [line for line in long_lines if line["y"] >= center]
                if not above or not below:
                    reconstructed = []
                    break
                top = max(above, key=lambda line: line["y"])
                bottom = min(below, key=lambda line: line["y"])
                if (
                    center - top["y"] < 0.20 * step
                    or bottom["y"] - center < 0.20 * step
                    or bottom["y"] - top["y"] < 0.25 * step
                    or bottom["y"] - top["y"] > 1.10 * step
                ):
                    reconstructed = []
                    break
                x0 = min(top["x0"], bottom["x0"])
                x1 = max(top["x1"], bottom["x1"])
                reconstructed.append(
                    {
                        "x0": int(x0),
                        "x1": int(x1),
                        "y0": int(top["y"]),
                        "y1": int(bottom["y"]),
                        "w": int(x1 - x0),
                        "h": int(bottom["y"] - top["y"]),
                    }
                )
            if len(reconstructed) == 4:
                centers = [
                    (box["y0"] + box["y1"]) / 2 for box in reconstructed
                ]
                gaps = [centers[i + 1] - centers[i] for i in range(3)]
                if (
                    all(gap > 0 for gap in gaps)
                    and all(
                        reconstructed[i]["y1"] <= reconstructed[i + 1]["y0"]
                        for i in range(3)
                    )
                    and max(gaps) <= 2.4 * min(gaps)
                    and all(box["w"] >= 0.45 * w for box in reconstructed)
                ):
                    # Individual horizontal fragments can start after the
                    # left badge or end before the selected row's right
                    # border.  Recover the shared vertical borders across
                    # all four real bands before forcing the analyzer.
                    left = None
                    right = None
                    for x in range(int(0.02 * w), int(0.40 * w)):
                        if all(
                            pale[box["y0"] : box["y1"], x].mean() > 0.5
                            for box in reconstructed
                        ):
                            left = x
                            break
                    for x in range(int(0.98 * w) - 1, int(0.60 * w), -1):
                        if all(
                            pale[box["y0"] : box["y1"], x].mean() > 0.5
                            for box in reconstructed
                        ):
                            right = x
                            break
                    if left is not None and right is not None and right - left >= 0.45 * w:
                        for box in reconstructed:
                            box["x0"] = left
                            box["x1"] = right + 1
                            box["w"] = right + 1 - left
                    return reconstructed

        # Prefer a contiguous run of actual pale-border boxes.  Some source
        # captures end before the last box, so synthesize only the missing
        # tail from the measured row spacing; the resulting boxes still pass
        # through analyze_single's forced-box path below.
        lo = min(window) - 0.08 * h
        hi = max(window) + 0.08 * h
        nearby = [
            b
            for b in border_boxes
            if lo <= (b["y0"] + b["y1"]) / 2 <= hi
        ]
        nearby.sort(key=lambda b: b["y0"])
        if len(nearby) >= 2:
            gaps = [
                (nearby[i + 1]["y0"] + nearby[i + 1]["y1"]) / 2
                - (nearby[i]["y0"] + nearby[i]["y1"]) / 2
                for i in range(len(nearby) - 1)
            ]
            step = float(np.median(gaps))
            if step > 0 and max(gaps) <= 2.4 * min(gaps):
                selected = nearby[:4]
                while len(selected) < 4:
                    previous = selected[-1]
                    center = (previous["y0"] + previous["y1"]) / 2 + step
                    box_h = float(np.median([b["h"] for b in selected]))
                    y0 = max(0, int(round(center - box_h / 2)))
                    y1 = min(h - 1, int(round(center + box_h / 2)))
                    selected.append(
                        {
                            "x0": previous["x0"],
                            "x1": previous["x1"],
                            "y0": y0,
                            "y1": y1,
                            "w": previous["w"],
                            "h": y1 - y0,
                        }
                    )
                return selected

        gap = (window[-1] - window[0]) / 3
        bands: list[tuple[int, int]] = []
        for cy in window:
            hint = (max(0.0, (cy - gap / 2) / h), min(1.0, (cy + gap / 2) / h))
            snapped = geometry.snap_band(lum, h, w, hint, thr)
            y0, y1 = snapped if snapped else (int(hint[0] * h), int(hint[1] * h))
            y0, y1 = max(0, y0), min(h - 1, y1)
            if y1 - y0 < 0.015 * h:
                break
            bands.append((y0, y1))
        if len(bands) != 4:
            continue
        y_lo, y_hi = min(b[0] for b in bands), max(b[1] for b in bands)
        column_frac = pale[y_lo:y_hi, :].mean(axis=0)
        left = next(
            (x for x in range(int(0.02 * w), int(0.4 * w)) if column_frac[x] > 0.5),
            None,
        )
        right = next(
            (x for x in range(int(0.98 * w) - 1, int(0.6 * w), -1) if column_frac[x] > 0.5),
            None,
        )
        if left is None or right is None or right - left < 0.25 * w:
            continue
        return [
            {
                "x0": left,
                "x1": right + 1,
                "y0": y0,
                "y1": y1,
                "w": right + 1 - left,
                "h": y1 - y0,
            }
            for y0, y1 in bands
        ]
    return None


def _repair_choice_lefts(
    rendered: np.ndarray,
    choices: list[dict[str, int]],
    boxes: list[dict[str, int]],
) -> list[dict[str, int]]:
    """Keep the first answer character when a pale badge is not ink-detected.

    A few captures render the printed badge in gray, while the answer text is
    black.  In that case choice_interior's conservative fallback can start
    to the right of the first character.  The box itself remains the
    border-pipeline result.
    """
    strict = _strict_ink(rendered)
    repaired: list[dict[str, int]] = []
    for choice, box in zip(choices, boxes):
        fixed = dict(choice)
        x0, x1 = int(box["x0"]), int(box["x1"])
        y0, y1 = int(box["y0"]), int(box["y1"])
        zone_x1 = min(x1, x0 + max(20, int(0.15 * (x1 - x0))))
        zone = strict[y0 + 4 : max(y0 + 5, y1 - 4), x0 + 4 : zone_x1]
        components = geometry.dark_components(zone, min_area=20)
        badges = [
            c
            for c in components
            if c["x0"] <= 0.035 * (x1 - x0)
            and 0.55
            <= (c["y1"] - c["y0"]) / max(1, c["x1"] - c["x0"])
            <= 1.8
        ]
        badge_near_edge = bool(badges)
        if badges:
            badge = max(badges, key=lambda c: c["x1"])
            fixed["cx0"] = min(
                fixed["cx0"], x0 + 4 + badge["x1"] + max(3, rendered.shape[1] // 500)
            )
        elif components:
            first = min(c["x0"] for c in components) + x0 + 4
            if first < fixed["cx0"] - 8:
                fixed["cx0"] = max(x0 + 3, first - 6)
        repaired.append(fixed)
    return repaired


def _trim_choice_content(
    rendered: np.ndarray,
    choices: list[dict[str, int]],
) -> list[dict[str, int]]:
    """Exclude large browser overlays from forced choice interiors.

    Answer text is made of compact strict-ink components.  Footer pills and
    toast notifications are large dark components; including the full box
    interior would publish those unrelated UI elements with the answer.
    """
    h, w = rendered.shape[:2]
    strict = _strict_ink(rendered)
    trimmed: list[dict[str, int]] = []
    for choice in choices:
        fixed = dict(choice)
        x0, x1 = max(0, choice["cx0"]), min(w, choice["cx1"])
        y0, y1 = max(0, choice["cy0"]), min(h, choice["cy1"])
        region = strict[y0:y1, x0:x1]
        region_h, region_w = region.shape[:2]
        raw_components = [
            component
            for component in geometry.dark_components(region, min_area=8)
            # A selected card's dark border can be connected to a corner or
            # side fragment.  It touches the forced interior edge, unlike
            # the answer glyphs, and must not enlarge the content crop.
            if component["x0"] > 2
            and component["y0"] > 2
            and component["x1"] < region_w - 2
            and component["y1"] < region_h - 2
        ]
        overlays = [
            c
            for c in raw_components
            if c["x1"] - c["x0"] > 0.15 * w
            or c["y1"] - c["y0"] > 0.03 * h
        ]

        def overlay_component(component: dict[str, int]) -> bool:
            for overlay in overlays:
                if (
                    component["x0"] < overlay["x1"]
                    and component["x1"] > overlay["x0"]
                    and component["y0"] < overlay["y1"]
                    and component["y1"] > overlay["y0"]
                ):
                    return True
            return False

        components = [
            c
            for c in raw_components
            if c["x1"] - c["x0"] <= 0.15 * w
            and c["y1"] - c["y0"] <= 0.03 * h
            and not overlay_component(c)
        ]
        if not any(c["x0"] + x0 < 0.35 * w for c in components):
            components = []
        if components:
            left = min(c["x0"] for c in components) + x0
            right = max(c["x1"] for c in components) + x0
            top = min(c["y0"] for c in components) + y0
            bottom = max(c["y1"] for c in components) + y0
            fixed["cx0"] = max(choice["cx0"], left - max(3, w // 500))
            fixed["cx1"] = min(choice["cx1"], right + max(3, w // 500))
            fixed["cy0"] = max(choice["cy0"], top - max(2, h // 500))
            fixed["cy1"] = min(choice["cy1"], bottom + max(2, h // 500))
        else:
            # The source viewport clipped this answer row.  Keep a tiny
            # in-bounds region instead of exposing a footer pill or toast.
            fixed["cx1"] = min(choice["cx1"], fixed["cx0"] + 2)
            fixed["cy1"] = min(choice["cy1"], fixed["cy0"] + 2)
        trimmed.append(fixed)
    return trimmed


def _forced_choices_valid(
    rendered: np.ndarray, choices: list[dict[str, int]], h: int, w: int
) -> bool:
    """Guard against hint windows snapping onto stem figures.

    Real choice rows are vertically ordered with roughly even gaps and hold
    black answer text; a graph's pale grid rows have neither.  Interior
    lefts may differ a little because the selected badge prints wider.
    """
    if len(choices) != 4:
        return False
    lefts = [c["cx0"] for c in choices]
    if max(lefts) - min(lefts) > 0.05 * w:
        return False
    centers = [(c["y0"] + c["y1"]) / 2 for c in choices]
    if any(centers[i + 1] <= centers[i] for i in range(3)):
        return False
    gaps = [centers[i + 1] - centers[i] for i in range(3)]
    if max(gaps) > 2.4 * min(gaps):
        return False
    if min(gaps) <= 0.5 * min(c["y1"] - c["y0"] for c in choices):
        return False
    # At least three interiors carry black ink (the fourth may be a blank
    # numeric distractor, but four empty rows means the window is junk).
    strict = _strict_ink(rendered)
    inked = 0
    for c in choices:
        interior = strict[max(0, c["cy0"]) : c["cy1"], max(0, c["cx0"]) : c["cx1"]]
        if interior.size and interior.any():
            inked += 1
    return inked >= 3


def _repair_empty_interiors(
    rendered: np.ndarray, choices: list[dict[str, int]]
) -> list[dict[str, int]]:
    """Re-anchor interiors that lost their text to the badge scan.

    The badge scanner can mistake the first answer character for the badge
    disc, putting the whole answer left of cx0.  When an interior holds no
    black ink but the box row does, cx0 moves back to the shared interior
    column of the inked siblings.
    """
    h, w = rendered.shape[:2]
    strict = _strict_ink(rendered)

    def has_ink(choice: dict[str, int]) -> bool:
        interior = strict[max(0, choice["cy0"]) : choice["cy1"], max(0, choice["cx0"]) : choice["cx1"]]
        return bool(interior.size and interior.any())

    if all(has_ink(c) for c in choices) or not any(has_ink(c) for c in choices):
        return choices
    inked_lefts = [c["cx0"] for c in choices if has_ink(c)]
    if not inked_lefts:
        return choices
    anchor = int(np.median(inked_lefts))
    repaired = []
    for choice in choices:
        if has_ink(choice) or choice["cx0"] <= anchor:
            repaired.append(choice)
            continue
        fixed = dict(choice)
        fixed["cx0"] = anchor
        repaired.append(fixed)
    return repaired


def _geometry_math_presentation(
    source_doc: pymupdf.Document,
    page_number: int,
    is_spr: bool,
    correct_letter: str = "A",
) -> dict[str, object] | None:
    """Stem and choice crops for one September Math page, or None.

    Every crop comes from the shared border-detection pipeline
    (analyze_single), as on August.  When the watermark fragments the
    choice box borders, ring positions only seed approximate rows that are
    snapped back onto the page's real borders and re-analyzed; ring
    coordinates themselves are never published.  SPR stems end above the
    detected input box (typed ink allowed) or an on-screen keyboard band.
    Returns None when detection fails so the caller can fall back.
    """
    rendered = geometry.page_array(source_doc, page_number)
    h, w = rendered.shape[:2]
    config = _bank_config(page_number, "Math")
    result = geometry.analyze_single(rendered, config, is_spr, True)
    choices = list(result.get("choices", []))
    snapped_boxes: list[dict[str, int]] | None = None
    if not is_spr and len(choices) != 4:
        windows: list[list[float]] = []
        for column in _ring_columns(rendered):
            windows.extend(_hint_windows(column["ys"], correct_letter, h))
        # A noisy desktop capture can yield several equally plausible ring
        # columns before the real four-row stack.  Keep the validation guard
        # strict, but inspect a few more ranked windows so a valid border
        # stack is not discarded solely by the hint-search cutoff.
        for window in windows[:12]:
            boxes = _snap_hint_boxes(rendered, [window])
            if boxes is None:
                continue
            try:
                forced = geometry.analyze_single(
                    rendered, config, False, True, forced_boxes=boxes
                )
            except Exception:  # noqa: BLE001 - a bad window must not stop the page
                continue
            candidate_choices = list(forced.get("choices", []))
            if len(candidate_choices) == 4:
                candidate_choices = _repair_choice_lefts(
                    rendered, candidate_choices, boxes
                )
            if len(candidate_choices) == 4 and _forced_choices_valid(
                rendered, candidate_choices, h, w
            ):
                choices = candidate_choices
                snapped_boxes = boxes
                break
    if not is_spr and len(choices) == 4:
        if snapped_boxes is not None:
            choices = _repair_choice_lefts(rendered, choices, snapped_boxes)
            choices = _trim_choice_content(rendered, choices)
        choices = _repair_empty_interiors(rendered, choices)
    if is_spr:
        input_box = result.get("input_box") or _spr_input_box(rendered)
        if input_box is None:
            keyboard = _keyboard_top(rendered)
            if keyboard is None:
                return None
            stem_bottom = keyboard - max(2, h // 500)
        else:
            stem_bottom = int(input_box["y0"]) - max(2, h // 500)
    else:
        if len(choices) != 4:
            return None
        stem_bottom = min(c["y0"] for c in choices) - 2
    stem = geometry.ink_bbox(
        _strict_ink(rendered),
        _stem_top(rendered, int(h * config["top"])),
        stem_bottom,
        int(w * 0.005),
        int(w * 0.995),
        h,
        w,
    )
    if stem is None:
        return None
    composed = {
        "page_dims": {str(page_number): [w, h]},
        "stem_box": {**stem, "page": page_number},
        "choices": [{**choice, "page": page_number} for choice in choices],
        "spr": is_spr,
        "banner": False,
    }
    try:
        presentation = geometry.geometry_presentation(composed, is_spr)
        QuestionPresentation.model_validate(presentation)
    except Exception:  # noqa: BLE001 - any invalid geometry falls back
        return None
    return presentation


def _publish(authoring: PackageAuthoring, package: dict, pdf_path: Path, csv_path: Path) -> None:
    use_geometry = package["section"] == "Math"

    if use_geometry:
        # Republish from scratch: every stored question gets new presentation
        # content, and create_import_draft dedupes on the unchanged source
        # hashes, so the previous package must be gone before the draft is
        # created.  Historical attempts are removed with it.
        with connect(DATA) as connection:
            stale = connection.execute(
                "SELECT id FROM test_packages WHERE title = ?", (package["title"],)
            ).fetchall()
        for row in stale:
            removed = authoring.permanently_delete(row["id"], package["title"])
            print(
                f"[deleted] {package['title']} {row['id']} "
                f"({removed['removedAttempts']} attempts)"
            )
    else:
        with connect(DATA) as connection:
            existing = connection.execute(
                "SELECT id FROM test_packages WHERE title = ? AND archived = 0", (package["title"],)
            ).fetchone()
        if existing is not None:
            print(f"[skip] {package['title']} already exists ({existing['id']})")
            return
    draft = authoring.create_import_draft(
        title=package["title"],
        original_filename=pdf_path.name,
        temporary_pdf=pdf_path,
        answer_csv=csv_path.read_bytes(),
    )
    if draft.status != "mapping":
        raise RuntimeError(f"{package['title']} import diagnostics: {draft.diagnostics}")
    source_doc = pymupdf.open(pdf_path) if use_geometry else None
    # Ring recovery needs the known correct letter: the selected answer's
    # badge is filled and can hide its ring entirely.
    correct_letters: dict[int, str] = {}
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            module_first = package["page_start"] if int(row["module"]) == 1 else package["module_break"] + 1
            page = module_first + int(row["question_number"]) - 1
            correct_letters[page] = row["correct_answer"].strip().upper()[:1]
    detected = fallback = 0
    for question in draft.questions:
        index = int(question["index"])
        response_type = question["responseType"]
        is_spr = response_type == "student_produced_response"
        page_number = package["page_start"] + index
        presentation: dict[str, object] | None = None
        if source_doc is not None:
            presentation = _geometry_math_presentation(
                source_doc, page_number, is_spr, correct_letters.get(page_number, "A")
            )
            if presentation is not None:
                detected += 1
            else:
                fallback += 1
        if presentation is None:
            presentation = {
                "version": 1,
                "stimulus": [],
                    "stem": [{"kind": "region", "region": {"pageNumber": page_number, "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "confirmed": True}}],
            }
            if not is_spr:
                presentation["choices"] = [
                    {"id": letter, "content": [{"kind": "text", "text": f"Choice {letter}"}]}
                    for letter in "ABCD"
                ]
        authoring.set_question_presentation(draft.id, index, QuestionPresentation.model_validate(presentation))
    if source_doc is not None:
        source_doc.close()
    published = authoring.publish(draft.id)
    if published["questionCount"] != draft.question_count:
        raise RuntimeError(f"{package['title']} published count mismatch")
    counts = f", geometry {detected} ok / {fallback} fallback" if use_geometry else ""
    print(
        f"[published] {package['title']}: {published['questionCount']} questions, "
        f"package {published['id']}{counts}"
    )


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Source PDF not found: {SOURCE}")
    source = pymupdf.open(SOURCE)
    if len(source) != 461:
        raise SystemExit(f"Expected 461 source pages, found {len(source)}")
    authoring = PackageAuthoring(DATA)
    for package in PACKAGES:
        pdf_path, csv_path, count = _build_pdf_and_manifest(source, package)
        print(f"[built] {package['title']}: {count} pages -> {pdf_path.name}")
        _publish(authoring, package, pdf_path, csv_path)
    source.close()


if __name__ == "__main__":
    main()
