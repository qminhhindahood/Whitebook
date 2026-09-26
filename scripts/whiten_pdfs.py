"""Produce answer-free ("whitened") copies of the meo source PDFs.

The bluebooky page scans mark the correct choice with a light-purple fill, a
purple border, and a solid purple letter disc; meo-math SPR pages print the
accepted answers inside purple-bordered overlay boxes. Every page is a single
full-page raster image, so each embedded image is decoded, the highlight
pixels are recolored, and the page image is replaced in a copy of the PDF.

MC choice boxes: purple pixels inside the highlighted box become white, then
the box border, the letter ring, and the letter itself (taken from the answer
CSV) are redrawn to match the unhighlighted choices.

SPR overlay boxes: the whole overlay (border plus printed answer text) is
covered with white.

Outputs land in question-bank/whitened/ next to a JSON report of every edit;
the original PDFs are never modified.
"""
from __future__ import annotations

import csv
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "question-bank" / "whitened"
CHECK_DIR = OUT_DIR / "checks"

# Content window: skip the header badge strip and the footer pills.
TOP_FRACTION = 0.075
BOTTOM_FRACTION = 0.95
# Everything "purple family": the solid highlight purple, its anti-alias
# blends, and the light fill. Hue window keeps this away from black/gray ink.
PURPLE_HUE = (248.0, 295.0)
PURPLE_SAT = 0.13
PURPLE_VAL = 0.25
LIGHT_FILL = np.array([238, 229, 250])
LIGHT_TOL = 20

BORDER_RGB = (80, 80, 80)
RING_RGB = (156, 163, 175)
LETTER_RGB = (25, 25, 25)


def purple_mask(a: np.ndarray) -> np.ndarray:
    """Purple-family pixels: solid highlight purple and its anti-alias blends.

    Deliberately excludes the light fill core so the letter disc stays a
    separate component from the box border (the fill touches both).
    """
    af = a.astype(np.float32) / 255.0
    maxc = af.max(axis=2)
    minc = af.min(axis=2)
    delta = maxc - minc
    sat = np.where(maxc > 0, delta / np.maximum(maxc, 1e-6), 0)
    val = maxc
    r, g, b = af[..., 0], af[..., 1], af[..., 2]
    hue = np.zeros_like(maxc)
    mask = delta > 1e-6
    idx = mask & (maxc == b)
    hue[idx] = 60.0 * (4.0 + (r[idx] - g[idx]) / delta[idx])
    idx = mask & (maxc == r)
    hue[idx] = (60.0 * ((g[idx] - b[idx]) / delta[idx])) % 360.0
    idx = mask & (maxc == g)
    hue[idx] = 60.0 * (2.0 + (b[idx] - r[idx]) / delta[idx])
    hue %= 360.0
    in_hue = (hue >= PURPLE_HUE[0]) & (hue <= PURPLE_HUE[1])
    return in_hue & (sat >= PURPLE_SAT) & (val >= PURPLE_VAL)


def light_mask(a: np.ndarray) -> np.ndarray:
    """Light purple choice-fill pixels (including near blends)."""
    return (np.abs(a.astype(np.int16) - LIGHT_FILL) <= LIGHT_TOL).all(axis=2)


def load_page_map(csv_path: Path) -> dict[int, dict[str, str]]:
    """source page -> answer row for the question that owns the page."""
    answers: dict[tuple[str, str, str], dict[str, str]] = {}
    with open(ROOT / "question-bank" / f"{csv_path}-answers.csv", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            answers[(row["section"], row["module"], row["question_number"])] = row
    pages: dict[int, dict[str, str]] = {}
    with open(ROOT / "question-bank" / f"{csv_path}-regions.csv", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            for page in row["source_pages"].split(","):
                pages[int(page)] = answers[
                    (row["section"], row["module"], row["question_number"])
                ]
    return pages


def components(mask: np.ndarray) -> list[dict[str, object]]:
    labeled, n = ndimage.label(mask)
    out = []
    for i, sl in enumerate(ndimage.find_objects(labeled), start=1):
        ys, xs = sl
        area = int((labeled[sl] == i).sum())
        out.append(
            {
                "id": i,
                "labeled": labeled,
                "y0": ys.start,
                "y1": ys.stop,
                "x0": xs.start,
                "x1": xs.stop,
                "area": area,
            }
        )
    return out


def whiten_page(
    a: np.ndarray, is_spr: bool, answer_letter: str | None
) -> tuple[np.ndarray, dict[str, object]]:
    h, w, _ = a.shape
    y_top, y_bot = int(h * TOP_FRACTION), int(h * BOTTOM_FRACTION)
    out = a.copy()
    report: dict[str, object] = {"boxes": 0, "letters": [], "spr_overlays": 0, "notes": []}

    purple = purple_mask(a)
    highlight = purple | light_mask(a)
    window = np.zeros_like(purple)
    window[y_top:y_bot] = highlight[y_top:y_bot]

    if is_spr:
        labeled, n = ndimage.label(window)
        if n:
            slices = ndimage.find_objects(labeled)
            covered = 0
            for i, sl in enumerate(slices, start=1):
                if (labeled[sl] == i).sum() < 40:
                    continue
                ys, xs = sl
                pad = max(3, h // 300)
                y0, y1 = max(0, ys.start - pad), min(h, ys.stop + pad)
                x0, x1 = max(0, xs.start - pad), min(w, xs.stop + pad)
                out[y0:y1, x0:x1] = (255, 255, 255)
                covered += 1
            report["spr_overlays"] = covered
            if covered == 0:
                report["notes"].append("SPR page but no purple overlay found")
        return out, report

    # MC page: locate the highlighted choice by its purple border frame. The
    # frame is one connected component even when the fill inside is split by
    # tables, and it may start at the very top of the page (continuation
    # pages), so only the footer is cropped out here.
    purple = purple_mask(a)
    purple[y_bot:] = False
    light = light_mask(a)
    light[y_bot:] = False
    lab, ncomp = ndimage.label(purple)
    frame = None
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        area = int((lab[sl] == i).sum())
        ys, xs = sl
        # Ignore the header badge strip entirely.
        if ys.stop <= y_top:
            continue
        dw, dh = xs.stop - xs.start, ys.stop - ys.start
        if dw >= w * 0.25 and dh >= h * 0.04 and area >= w * 0.01:
            if frame is None or area > frame["area"]:
                frame = {"y0": ys.start, "y1": ys.stop, "x0": xs.start,
                         "x1": xs.stop, "area": area}
    if frame is None:
        report["notes"].append("no purple choice-box frame found")
        return out, report

    y0 = max(0, frame["y0"] - 4)
    y1 = min(h, frame["y1"] + 4)
    x0 = max(0, frame["x0"] - 4)
    x1 = min(w, frame["x1"] + 4)
    inside = np.zeros_like(purple)
    inside[y0:y1, x0:x1] = (purple | light)[y0:y1, x0:x1]

    # Disc: purple component roughly circular, fully inside the frame.
    disc = None
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        ys, xs = sl
        if ys.start < y0 or ys.stop > y1 or xs.start < x0 or xs.stop > x1:
            continue
        area = int((lab[sl] == i).sum())
        if area < 40:
            continue
        dw, dh = xs.stop - xs.start, ys.stop - ys.start
        if not (0.6 <= dw / max(dh, 1) <= 1.6):
            continue
        if not (h * 0.008 <= dw <= h * 0.05 and h * 0.008 <= dh <= h * 0.05):
            continue
        fill_ratio = area / (dw * dh)
        if fill_ratio < 0.55:
            continue
        if disc is None or area > disc["area"]:
            disc = {"cy": (ys.start + ys.stop) / 2, "cx": (xs.start + xs.stop) / 2,
                    "r": (dw + dh) / 4, "area": area}
    if disc is None:
        report["notes"].append("highlight box without a letter disc")

    # Recolor every purple/fill pixel inside the frame to white (fill, border,
    # disc; the black choice text and table grids are untouched).
    out[y0:y1, x0:x1][inside[y0:y1, x0:x1]] = (255, 255, 255)

    # Redraw: choice box border, letter ring, letter.
    img = Image.fromarray(out)
    draw = ImageDraw.Draw(img)
    thickness = max(2, h // 700)
    draw.rectangle((x0, y0, x1, y1), outline=BORDER_RGB, width=thickness)
    if disc:
        r = disc["r"]
        draw.ellipse(
            (disc["cx"] - r, disc["cy"] - r, disc["cx"] + r, disc["cy"] + r),
            outline=RING_RGB,
            width=thickness,
        )
        if answer_letter:
            font = _letter_font(int(r * 1.5))
            bbox = draw.textbbox((0, 0), answer_letter, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text(
                (disc["cx"] - tw / 2 - bbox[0], disc["cy"] - th / 2 - bbox[1]),
                answer_letter,
                font=font,
                fill=LETTER_RGB,
            )
            report["letters"].append(
                {"letter": answer_letter, "cy": disc["cy"], "cx": disc["cx"]}
            )
    out = np.array(img)
    report["boxes"] += 1
    return out, report


_FONT_CACHE: dict[int, ImageFont.FreeTypeFont] = {}


def _letter_font(size: int) -> ImageFont.FreeTypeFont:
    size = max(10, size)
    if size not in _FONT_CACHE:
        for candidate in ("arialbd.ttf", "Arial Bold.ttf", "dejavaudbd.ttf",
                          "C:/Windows/Fonts/arialbd.ttf",
                          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
            try:
                _FONT_CACHE[size] = ImageFont.truetype(candidate, size)
                break
            except OSError:
                continue
        else:
            _FONT_CACHE[size] = ImageFont.load_default()
    return _FONT_CACHE[size]


def whiten_pdf(
    source: Path,
    bank: str,
    output: Path,
    check_pages: list[int],
) -> None:
    page_map = load_page_map(bank)
    doc = pymupdf.open(source)
    report: dict[str, object] = {}
    for index, page in enumerate(doc):
        page_no = index + 1
        images = page.get_images()
        if len(images) != 1:
            report[page_no] = {"error": f"expected 1 image, found {len(images)}"}
            continue
        xref = images[0][0]
        pix = pymupdf.Pixmap(doc, xref)
        if pix.alpha:
            pix = pymupdf.Pixmap(pix, 0)
        a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        a = a[:, :, :3].copy()
        row = page_map.get(page_no)
        if row is None:
            report[page_no] = {"error": "no answer row for this page"}
            continue
        is_spr = row["type"].strip().lower() == "student-produced response"
        letter = row["correct_answer"].strip() if not is_spr else None
        if is_spr:
            letter = None
        elif len(letter) != 1:
            report_note = f"unexpected MC answer {letter!r}"
            report.setdefault(page_no, {}).setdefault("notes", []).append(report_note)
            letter = letter[:1]
        out, page_report = whiten_page(a, is_spr, letter)
        page_report["spr"] = is_spr
        report[page_no] = page_report

        buf = io.BytesIO()
        Image.fromarray(out).save(buf, format="JPEG", quality=85, subsampling=1)
        page.replace_image(xref, stream=buf.getvalue())

        if page_no in check_pages:
            CHECK_DIR.mkdir(parents=True, exist_ok=True)
            side = Image.new("RGB", (a.shape[1] * 2 + 20, a.shape[0]), (200, 200, 200))
            side.paste(Image.fromarray(a), (0, 0))
            side.paste(Image.fromarray(out), (a.shape[1] + 20, 0))
            scale = 1400 / side.height
            side = side.resize((int(side.width * scale), 1400))
            side.save(CHECK_DIR / f"{bank}-p{page_no:03d}.png")

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output, garbage=3, deflate=True)
    doc.close()
    report_path = OUT_DIR / f"{bank}-whiten-report.json"
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1, default=str)
    notes = {p: r for p, r in report.items() if isinstance(r, dict) and r.get("notes")}
    print(f"{source.name} -> {output.name}: {len(report)} pages, report {report_path.name}")
    for p, r in notes.items():
        print(f"  page {p}: {r['notes']}")


def main() -> None:
    check = [int(v) for v in sys.argv[1:]] or [1, 2, 85, 86, 155, 156]
    whiten_pdf(
        ROOT / "question-bank" / "meo.pdf",
        "meo",
        OUT_DIR / "meo-whitened.pdf",
        check_pages=check,
    )
    whiten_pdf(
        ROOT / "question-bank" / "meo-math.pdf",
        "meo-math",
        OUT_DIR / "meo-math-whitened.pdf",
        check_pages=check,
    )


if __name__ == "__main__":
    main()
