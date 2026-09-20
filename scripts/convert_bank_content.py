"""Derive converted question presentations (stimulus, stem, choice crops)
from the three question banks and publish them as package revisions.

Every bank page is a single full-page raster in the Bluebooky visual grammar:
a question column with bordered choice boxes (letter badge at left) or an
SPR input box, and — for August R&W only — a passage pane left of a vertical
divider. Crops are taken from the package Source PDF pages so the player
renders real question and answer content.

Stages:
  analyze  - page geometry for every question, written to a JSON report with
             annotated check images for visual review
  build    - validate the reviewed geometry as player presentation payloads
  publish  - start a revision of each package, attach the presentations,
             publish, and archive superseded revisions from new practice
             (only after the checks pass; historical attempts are preserved)

Run: uv run python scripts/convert_bank_content.py analyze [bank ...]
     uv run python scripts/convert_bank_content.py build [bank ...]
     uv run python scripts/convert_bank_content.py publish [bank ...]
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.ndimage import uniform_filter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".scratch" / "converted"
CHECKS = OUT / "checks"

BANKS = {
    "meo": {
        "title": "August R&W",
        "pdf": "question-bank/whitened/meo-whitened.pdf",
        "answers": "question-bank/meo-answers.csv",
        "regions": "question-bank/meo-regions.csv",
    "package": "40a0b8a3-ae26-4c93-85e0-78169327f960",
    "top": 0.075,
    "bottom": 0.95,
    "content_bottom": 0.945,
    "panes": True,
    },
    "meo-math": {
        "title": "August Math",
        "pdf": "question-bank/whitened/meo-math-whitened.pdf",
        "answers": "question-bank/meo-math-answers.csv",
        "regions": "question-bank/meo-math-regions.csv",
    "package": "30056580-6dc6-498f-aa22-1eeec4c94a65",
    "top": 0.075,
    "bottom": 0.95,
    "content_bottom": 0.945,
    "panes": False,
    },
    "hardest": {
        "title": "Hardest SAT Math Questions",
        "pdf": "question-bank/hardest-sat-math-questions.pdf",
        "answers": "question-bank/hardest-answers.csv",
        "regions": "question-bank/hardest-regions.csv",
        "package": "0c86b7cd-137f-4bf2-84ee-d05023389438",
        "top": 0.030,
        "bottom": 0.985,
        "panes": False,
        "min_box_h": 0.045,
        "scan_overrides": True,
    },
}

# Choice box border / general ink thresholds.
INK = 150
INK_SOFT = 205
# A choice box: a hollow dark rectangle.
BOX_MIN_H, BOX_MAX_H = 0.020, 0.34
BOX_MIN_W, BOX_MAX_W = 0.22, 0.99
BOX_MAX_FILL = 0.16
# The printed A-D badge disc inside a box, as a fraction of box height.
BADGE_MIN, BADGE_MAX = 0.25, 0.75

RENDER_DPI = 120
SAMPLE_PAGES = {1, 2, 10, 60, 120, 203, 230, 239}

# Degraded photocopy pages where border detection fails; approximate choice
# box y-bands (fractions of page height) are snapped to the real edges.
CHOICE_BAND_OVERRIDES: dict[str, list[tuple[float, float]]] = {
    "Math:1:38": [
        (0.405, 0.500), (0.530, 0.635), (0.660, 0.775), (0.815, 0.945),
    ],
    "Math:1:129": [
        (0.415, 0.512), (0.555, 0.655), (0.685, 0.795), (0.825, 0.935),
    ],
    "Math:1:148": [
        (0.437, 0.507), (0.517, 0.585), (0.625, 0.697), (0.710, 0.787),
    ],
    "Math:1:149": [
        (0.397, 0.463), (0.500, 0.563), (0.585, 0.650), (0.697, 0.775),
    ],
    "Math:1:156": [
        (0.360, 0.445), (0.465, 0.545), (0.570, 0.655), (0.665, 0.755),
    ],
    "Math:1:180": [
        (0.610, 0.685), (0.710, 0.790), (0.820, 0.905), (0.940, 0.990),
    ],
    "Math:1:228": [
        (0.620, 0.685), (0.720, 0.795), (0.815, 0.905), (0.925, 0.990),
    ],
    "Math:1:231": [
        (0.600, 0.665), (0.695, 0.780), (0.800, 0.885), (0.915, 0.990),
    ],
    "Math:1:232": [
        (0.565, 0.645), (0.665, 0.740), (0.755, 0.870), (0.885, 0.990),
    ],
}


def page_array(doc: pymupdf.Document, page_no: int) -> np.ndarray:
    pix = doc[page_no - 1].get_pixmap(dpi=RENDER_DPI)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return a[:, :, :3].copy()


def luminance(a: np.ndarray) -> np.ndarray:
    return (
        0.299 * a[..., 0].astype(np.float32)
        + 0.587 * a[..., 1]
        + 0.114 * a[..., 2]
    )


def dark_components(mask: np.ndarray, min_area: int = 30) -> list[dict]:
    labeled, n = ndimage.label(mask)
    out = []
    for i, sl in enumerate(ndimage.find_objects(labeled), start=1):
        ys, xs = sl
        area = int((labeled[sl] == i).sum())
        if area < min_area:
            continue
        out.append(
            {
                "y0": ys.start, "y1": ys.stop, "x0": xs.start, "x1": xs.stop,
                "area": area,
            }
        )
    return out


def horizontal_lines(
    dark: np.ndarray, top: int, bottom: int, min_len: float
) -> list[dict]:
    """Merged horizontal dark runs long enough to be a box edge.

    Works on a copy: callers reuse the same ink mask for stimulus and stem
    bounding boxes afterwards, so erasing rows outside the search band here
    would hide real content (passage lines start above the question band).
    """
    h, w = dark.shape
    mask = dark.copy()
    mask[:top] = False
    mask[bottom:] = False
    runs: list[tuple[int, int, int]] = []  # y, x0, x1
    for y in range(top, bottom):
        row = mask[y]
        if not row.any():
            continue
        edges = np.flatnonzero(np.diff(np.concatenate(([False], row, [False])).astype(np.int8)))
        for start, stop in zip(edges[::2], edges[1::2]):
            if stop - start >= min_len:
                runs.append((y, int(start), int(stop)))
    lines: list[dict] = []
    for y, x0, x1 in runs:
        for line in lines:
            if (
                abs(y - line["ys"][-1]) <= 2
                and abs(x0 - line["x0"]) < 0.01 * w
                and abs(x1 - line["x1"]) < 0.01 * w
            ):
                line["ys"].append(y)
                line["x0"] = min(line["x0"], x0)
                line["x1"] = max(line["x1"], x1)
                break
        else:
            lines.append({"ys": [y], "x0": x0, "x1": x1})
    for line in lines:
        line["y"] = sum(line["ys"]) / len(line["ys"])
    # A dashed watermark crossing a box border splits the border into
    # fragments; re-join fragments on nearly the same row that touch or
    # overlap horizontally.
    merged = True
    while merged:
        merged = False
        for i, a in enumerate(lines):
            for j, b in enumerate(lines):
                if i >= j or abs(a["y"] - b["y"]) > 3:
                    continue
                gap = max(a["x0"], b["x0"]) - min(a["x1"], b["x1"])
                if gap <= 0.022 * w:
                    a["x0"] = min(a["x0"], b["x0"])
                    a["x1"] = max(a["x1"], b["x1"])
                    a["ys"] = a["ys"] + b["ys"]
                    a["y"] = (a["y"] + b["y"]) / 2
                    lines.pop(j)
                    merged = True
                    break
            if merged:
                break
    return sorted(lines, key=lambda line: line["y"])


def box_candidates(
    lines: list[dict], h: int, w: int, min_gap_frac: float = BOX_MIN_H
) -> list[dict]:
    """Pairs of edge lines with matching extents that enclose a box.

    Each edge line pairs with its nearest matching line below, so a box's
    top edge pairs with its own bottom edge rather than an edge further
    down the page.
    """
    tol = 0.008 * w
    found: list[dict] = []
    for i, top_line in enumerate(lines):
        for bottom_line in lines[i + 1 :]:
            gap = bottom_line["y"] - top_line["y"]
            if gap > BOX_MAX_H * h:
                break
            if gap < min_gap_frac * h:
                continue
            if (
                abs(top_line["x0"] - bottom_line["x0"]) <= tol
                and abs(top_line["x1"] - bottom_line["x1"]) <= tol
            ):
                found.append(
                    {
                        "x0": min(top_line["x0"], bottom_line["x0"]),
                        "x1": max(top_line["x1"], bottom_line["x1"]),
                        "y0": int(top_line["y"]),
                        "y1": int(bottom_line["y"]),
                    }
                )
                break
    # When two boxes nearly touch, the upper box's bottom edge can pair with
    # the lower box's bottom edge; among candidates sharing a bottom edge,
    # the tightest one is the real box.
    found.sort(key=lambda b: (b["y1"], b["y0"]))
    tightest: list[dict] = []
    for box in found:
        twin = next(
            (
                other
                for other in tightest
                if abs(other["y1"] - box["y1"]) <= 3
                and abs(other["x0"] - box["x0"]) < 0.012 * w
                and abs(other["x1"] - box["x1"]) < 0.012 * w
            ),
            None,
        )
        if twin is None:
            tightest.append(box)
        elif box["y0"] > twin["y0"]:
            tightest[tightest.index(twin)] = box
    found = tightest
    # Keep the outermost candidate per overlapping same-extent cluster, so a
    # table grid inside a choice box cannot shadow the box itself.
    found.sort(key=lambda b: b["y1"] - b["y0"], reverse=True)
    kept: list[dict] = []
    for box in found:
        shadowed = False
        for other in kept:
            if (
                abs(box["x0"] - other["x0"]) < 0.012 * w
                and abs(box["x1"] - other["x1"]) < 0.012 * w
            ):
                lo = max(box["y0"], other["y0"])
                hi = min(box["y1"], other["y1"])
                if hi - lo > 0.5 * min(box["y1"] - box["y0"], other["y1"] - other["y0"]):
                    shadowed = True
                    break
        if not shadowed:
            kept.append(box)
    # A ghost/echo edge can pair with a matching edge below such that the
    # phantom candidate swallows a real box; reject any candidate that has a
    # full-width line running through its interior.
    real: list[dict] = []
    for box in kept:
        width = box["x1"] - box["x0"]
        inside = [
            line
            for line in lines
            if box["y0"] + 3 < line["y"] < box["y1"] - 3
            and min(line["x1"], box["x1"]) - max(line["x0"], box["x0"])
            > 0.9 * width
        ]
        if not inside:
            real.append(box)
    for box in real:
        box["w"] = box["x1"] - box["x0"]
        box["h"] = box["y1"] - box["y0"]
    return real


def box_groups(boxes: list[dict], w: int) -> list[list[dict]]:
    """Cluster candidates that share left/right edges, top to bottom."""
    groups: list[list[dict]] = []
    for box in sorted(boxes, key=lambda b: (b["y0"], b["x0"])):
        for group in groups:
            head = group[0]
            if (
                abs(box["x0"] - head["x0"]) < 0.008 * w
                and abs(box["w"] - head["w"]) < 0.016 * w
            ):
                group.append(box)
                break
        else:
            groups.append([box])
    return groups


def stacked(group: list[dict]) -> bool:
    ordered = sorted(group, key=lambda b: b["y0"])
    return all(ordered[i + 1]["y0"] >= ordered[i]["y1"] for i in range(len(ordered) - 1))


def choice_stack(boxes: list[dict], h: int, w: int) -> list[dict] | None:
    """The four choice boxes: the bottom-most window of four consecutive
    stacked candidates within an edge-aligned group, so stem tables that
    share the choice boxes' column cannot break the group."""
    best: list[dict] | None = None
    for group in box_groups(boxes, w):
        ordered = sorted(group, key=lambda b: b["y0"])
        for i in range(len(ordered) - 3):
            window = ordered[i : i + 4]
            if not stacked(window):
                continue
            if best is None or window[-1]["y1"] > best[-1]["y1"]:
                best = window
    return best


def find_badge_right(box: dict, dark: np.ndarray) -> int:
    """Right edge of the printed letter badge inside a box.

    Multi-line choices make the badge small relative to the whole box, so
    the size window also accepts badges scaled to the first text line —
    single-line boxes keep the original fraction-of-box-height window.
    """
    inner = dark[box["y0"] : box["y1"], box["x0"] : box["x1"]]
    # The badge sits in a fixed left column of the box; scanning only there
    # keeps first text characters from matching. Its disc aligns with the
    # first text line rather than the whole box (multi-line choices), so the
    # size window uses the taller of box fraction and first-line height.
    zone = inner[:, : max(1, int(inner.shape[1] * 0.15))]
    comps = [
        c
        # The zone's outer border often connects into one component that
        # spans the whole box; the interior view ignores it.
        for c in dark_components(zone[4:-4, 4:-4], min_area=40)
        if (c["y1"] - c["y0"]) < zone.shape[0] - 8
        and (c["x1"] - c["x0"]) < zone.shape[1] - 8
    ]
    if not comps:
        return box["x0"] + int(box["w"] * 0.085)
    # Height of the badge zone's tallest component approximates the disc.
    disc_h = max(c["y1"] - c["y0"] for c in comps)
    lower = min(BADGE_MIN * box["h"], disc_h)
    upper = max(BADGE_MAX * box["h"], disc_h)
    for c in comps:
        ch = c["y1"] - c["y0"]
        cw = c["x1"] - c["x0"]
        if not (lower <= ch <= upper and lower <= cw <= upper):
            continue
        if abs((ch / max(cw, 1)) - 1.0) > 0.45:
            continue
        return box["x0"] + c["x1"]
    return box["x0"] + int(box["w"] * 0.085)


def banner_bottom(
    lum: np.ndarray, h: int, w: int, x_lo: int, x_hi: int, y_max: int
) -> int | None:
    """Bottom of a gray 'Mark for Review' banner, if present.

    The banner is a contiguous band of gray rows; isolated gray rows (box
    border anti-aliasing) do not qualify.
    """
    band = lum[:y_max, x_lo:x_hi]
    gray = ((band > 190) & (band < 245)).mean(axis=1)
    rows = np.where(gray > 0.55)[0]
    if not len(rows):
        return None
    min_run = max(8, int(h * 0.012))
    runs = []
    start = prev = int(rows[0])
    for row in rows[1:]:
        row = int(row)
        if row - prev <= 2:
            prev = row
            continue
        runs.append((start, prev))
        start = prev = row
    runs.append((start, prev))
    for start, stop in runs:
        if stop - start >= min_run:
            return stop + max(3, h // 400)
    return None


def border_stroke_end(dark: np.ndarray, y0: int, y1: int, x0: int, x1: int) -> tuple[int, int]:
    """Last row of the top border strokes and first row of the bottom ones.

    Borders can be double lines with small gaps, so skip solid dark rows
    and any rows within a few pixels below them before the interior starts.
    """
    width = max(1, x1 - x0)

    def solid(y: int) -> bool:
        # Border strokes run dark across the whole strip; text rows carry
        # word gaps and stay well below this density.
        return dark[y, x0:x1].mean() > 0.85

    top = y0
    last_stroke = None
    for y in range(y0, y1):
        if solid(y):
            last_stroke = y
        elif last_stroke is not None and y - last_stroke > 3:
            top = last_stroke + 1
            break
    if last_stroke is not None and top == y0:
        top = last_stroke + 1
    bottom = y1
    last_stroke = None
    for y in range(y1 - 1, top, -1):
        if solid(y):
            last_stroke = y
        elif last_stroke is not None and last_stroke - y > 3:
            bottom = last_stroke
            break
    if last_stroke is not None and bottom == y1:
        bottom = last_stroke
    return top, bottom


def choice_interior(box: dict, dark: np.ndarray, w: int) -> dict:
    """Interior crop of one choice box: right of the printed badge and
    inside the box's own borders.

    The detected box edge can overshoot the drawn border (dashed-watermark
    line merging tolerates small gaps), so the right edge snaps to the
    actual border column rather than trusting a fixed inset. Vertical
    bounds follow the box's ink rows — choice text can hug the borders, so
    a flat height fraction would slice multi-line choices; only the border
    strokes themselves are excluded.
    """
    right = box["x1"]
    window = max(6, int(w * 0.01))
    for x in range(box["x1"] - 1, max(box["x0"], box["x1"] - window), -1):
        column = dark[box["y0"] + 4 : box["y1"] - 4, x]
        if column.mean() > 0.6:
            right = x
            break
    badge_right = find_badge_right(box, dark) + max(3, w // 500)
    stroke_top, stroke_bottom = border_stroke_end(
        dark, box["y0"], box["y1"], badge_right, right
    )
    inner = dark[stroke_top:stroke_bottom, badge_right:right]
    rows = np.where(inner.any(axis=1))[0]
    border = max(2, int(w * 0.002))
    if len(rows):
        cy0 = max(stroke_top, stroke_top + int(rows[0]) - border)
        cy1 = min(stroke_bottom, stroke_top + int(rows[-1]) + 1 + border)
    else:
        cy0, cy1 = box["y0"] + max(2, box["h"] // 6), box["y1"] - max(2, box["h"] // 6)
    return {
        "y0": box["y0"],
        "y1": box["y1"],
        "cx0": badge_right,
        "cx1": right - max(3, w // 500),
        "cy0": cy0,
        "cy1": cy1,
    }


def ink_bbox(mask: np.ndarray, y0: int, y1: int, x0: int, x1: int, h: int, w: int):
    region = mask[y0:y1, x0:x1]
    rows = np.where(region.any(axis=1))[0]
    cols = np.where(region.any(axis=0))[0]
    if not len(rows) or not len(cols):
        return None
    pad_x, pad_y = int(w * 0.008), int(h * 0.006)
    return {
        "y0": max(y0, y0 + int(rows[0]) - pad_y),
        "y1": min(y1, y0 + int(rows[-1]) + pad_y + 1),
        "x0": max(x0, x0 + int(cols[0]) - pad_x),
        "x1": min(x1, x0 + int(cols[-1]) + pad_x + 1),
    }


def analyze_single(
    a: np.ndarray, bank: dict, is_spr: bool, last_page: bool,
    forced_boxes: list[dict] | None = None,
) -> dict:
    """Geometry for one page: stem box, choice interiors, input box."""
    h, w, _ = a.shape
    lum = luminance(a)
    # Adaptive ink mask: ink is darker than its local background, which
    # survives the uneven photocopy shading in the hardest bank.
    local = uniform_filter(lum, size=61)
    dark = lum < local - 15.0
    top = int(h * bank["top"])
    bottom = int(h * bank["bottom"])
    if forced_boxes:
        lines = []
        boxes = [dict(b) for b in forced_boxes]
        stack = choice_stack(boxes, h, w)
    else:
        # Degraded photocopy pages fragment box borders under the standard
        # adaptive mask; retry with more tolerant binarizations before
        # giving up on the page.
        masks = [
            dark,
            lum < uniform_filter(lum, size=31) - 8.0,
            lum < float(np.median(lum)) - 40.0,
        ]
        boxes, stack, lines = [], None, []
        for mask in masks:
            # Pane layouts keep the choices right of the divider; without
            # this restriction the detector can lock onto stimulus table
            # rows in the passage pane and publish them as answer choices.
            # Tolerances and width filters stay calibrated on the full page
            # width — halving them breaks edge matching for boxes whose
            # borders differ by a dozen pixels (highlighted choices).
            box_left = int(w * 0.502) if bank["panes"] else 0
            box_mask = mask[:, box_left:].copy() if box_left else mask
            lines = horizontal_lines(box_mask, top, bottom, min_len=0.30 * w)
            boxes = [
                dict(b, x0=b["x0"] + box_left, x1=b["x1"] + box_left)
                for b in box_candidates(
                    lines, h, w, bank.get("min_box_h", BOX_MIN_H)
                )
                if BOX_MIN_W * w <= b["w"] <= BOX_MAX_W * w
            ]
            stack = (
                None
                if is_spr
                else choice_stack(boxes, h, w)
            )
            if stack is not None:
                break
    result: dict = {"boxes": len(boxes), "spr": is_spr}

    x_lo, x_hi = int(w * 0.005), int(w * 0.995)
    # The stimulus pane can begin above the question band (passages start
    # right under the page margin), so its search window opens at the page
    # top and stops at the footer rule instead of the box-search band.
    stim_top = int(h * 0.005)
    stim_bottom = int(h * bank.get("content_bottom", bank["bottom"]))
    if bank["panes"]:
        # Passage pane left of the divider; question pane right of it.
        result["stimulus_box"] = ink_bbox(
            dark, stim_top, stim_bottom, x_lo, int(w * 0.498), h, w
        )
        x_lo, x_hi = int(w * 0.502), int(w * 0.995)

    banner = banner_bottom(lum, h, w, x_lo, x_hi, int(h * 0.12))
    top_edge = banner or top
    result["banner"] = bool(banner)

    if not is_spr:
        if stack is None:
            # Continuation pages legitimately hold fewer than four boxes;
            # every candidate is a partial-choice contribution and the stem
            # ends above the first candidate box.
            if boxes:
                result["choices"] = [
                    choice_interior(b, dark, w)
                    for b in sorted(boxes, key=lambda b: b["y0"])
                ]
                stem_bottom = min(b["y0"] for b in boxes) - 2
            else:
                stem_bottom = bottom
        else:
            stem_bottom = stack[0]["y0"] - 2
            result["choices"] = [choice_interior(b, dark, w) for b in stack]
    else:
        # SPR pages may show the shared directions pane left of a divider;
        # the player renders its own directions, so only the question pane
        # belongs in the stem.
        band = dark[top:bottom, int(w * 0.35) : int(w * 0.65)]
        counts = band.sum(axis=0)
        if counts.size and counts.max() > 0.3 * (bottom - top):
            div_x = int(w * 0.35) + int(counts.argmax())
            x_lo = div_x + int(w * 0.01)
            result["divider"] = div_x
            banner = banner_bottom(lum, h, w, x_lo, x_hi, int(h * 0.5))
            top_edge = banner or top
            result["banner"] = bool(banner)
        # Everything above the input box is the problem; whitened banks may
        # have erased the input entirely, leaving the whole window as stem.
        stem_bottom = bottom
        short_lines = horizontal_lines(dark, top, bottom, min_len=0.06 * w)
        small = sorted(
            (
                b
                for b in box_candidates(short_lines, h, w)
                if 0.05 * w <= b["w"] <= 0.48 * w and b["h"] <= 0.12 * h
            ),
            key=lambda b: b["y0"],
        )

        def isolated(candidate: dict) -> bool:
            """True when no sibling candidate shares its extent nearby, so
            stem table rows are not mistaken for the answer input."""
            return not any(
                other is not candidate
                and abs(other["x0"] - candidate["x0"]) < 0.012 * w
                and abs(other["x1"] - candidate["x1"]) < 0.012 * w
                and abs(other["y0"] - candidate["y1"]) < 2.5 * candidate["h"]
                for other in small
            )

        for candidate in small:
            if not isolated(candidate):
                continue
            box_h = candidate["y1"] - candidate["y0"]
            if candidate["w"] / box_h < 1.35:
                continue  # square icon buttons are not answer inputs
            interior = dark[
                candidate["y0"] + 4 : candidate["y1"] - 4,
                candidate["x0"] + 4 : candidate["x1"] - 4,
            ]
            mid = dark[
                candidate["y0"] + int(0.35 * box_h) : candidate["y0"] + int(0.65 * box_h),
                candidate["x0"] + 4 : candidate["x1"] - 4,
            ]
            above = dark[
                max(top, candidate["y0"] - int(h * 0.09)) : candidate["y0"] - 2,
                candidate["x0"] : candidate["x1"],
            ]
            if mid.mean() < 0.03 and above.any():
                stem_bottom = candidate["y0"] - 2
                result["input_box"] = {
                    k: candidate[k] for k in ("x0", "x1", "y0", "y1")
                }
                break

    if not last_page:
        # Continuation page: drop choices cut by the footer.
        result["choices"] = [
            c for c in result.get("choices", []) if c["y1"] < bottom - 4
        ]
    else:
        result["choices"] = [c for c in result.get("choices", []) if c["y0"] > top + 4]

    stem = ink_bbox(dark, top_edge, stem_bottom, x_lo, x_hi, h, w)
    if stem is None:
        result["error"] = "empty stem area"
        return result
    result["stem_box"] = stem
    return result


def compose(pages: list[dict]) -> dict:
    """Merge per-page geometry into one question's presentation geometry."""
    if len(pages) == 1:
        page = pages[0]
        if not page.get("spr") and len(page.get("choices", [])) != 4:
            return {"error": "no choice stack"}
        return page
    stem_pages = [p for p in pages if "stem_box" in p]
    if not stem_pages:
        return {"error": "no stem on any page"}
    choices: list[dict] = []
    for page in pages:
        choices.extend(page.get("choices", []))
    if len(choices) != 4:
        return {"error": f"multi-page choice composition found {len(choices)}"}
    composed = dict(pages[0])
    composed["stem_box"] = stem_pages[0]["stem_box"]
    composed["choices"] = choices
    composed["pages_used"] = len(pages)
    return composed


def snap_band(
    lum: np.ndarray, h: int, w: int, band: tuple[float, float], thr: float
) -> tuple[int, int] | None:
    """Snap an approximate box y-band to the strongest border rows.

    Border rows are the rows with the most ink across the content width;
    fragmented photocopy borders never form one continuous run.
    """
    y0_hint, y1_hint = int(band[0] * h), int(band[1] * h)
    window = int(h * 0.02)
    x0, x1 = int(w * 0.05), int(w * 0.95)

    def snap(row_hint: int) -> int | None:
        scores = (
            (lum[y, x0:x1] < thr).mean()
            for y in range(max(1, row_hint - window), min(h - 1, row_hint + window))
        )
        best = max(scores, default=0.0)
        if best < 0.4:
            return None
        return max(range(max(1, row_hint - window), min(h - 1, row_hint + window)),
                   key=lambda y: (lum[y, x0:x1] < thr).mean())

    top = snap(y0_hint)
    bottom = snap(y1_hint)
    if top is None or bottom is None or bottom - top < BOX_MIN_H * h:
        return None
    return top, bottom


def analyze_question(
    doc: pymupdf.Document, bank: dict, pages: list[int], is_spr: bool,
    key: tuple[str, str, str] | None = None,
) -> tuple[dict, list[tuple[int, np.ndarray, dict]]]:
    page_results = []
    rendered = []
    for page_no in pages:
        a = page_array(doc, page_no)
        result = analyze_single(a, bank, is_spr, last_page=page_no == pages[-1])
        override = CHOICE_BAND_OVERRIDES.get(
            ":".join((key[0], *key[1:])) if key else ""
        ) if bank.get("scan_overrides") else None
        if override and (
            result.get("error")
            or (
                not result.get("spr")
                and len(result.get("choices", [])) != 4
            )
        ):
            h, w, _ = a.shape
            lum = luminance(a)
            thr = float(np.median(lum)) - 25.0
            boxes = []
            for band in override:
                snapped = snap_band(lum, h, w, band, thr)
                y0, y1 = snapped if snapped else (
                    int(band[0] * h), int(band[1] * h)
                )
                frac = (lum[y0 + 2 : y1 - 2] < thr).mean(axis=0)
                left = next(
                    (x for x in range(int(0.02 * w), int(0.3 * w)) if frac[x] > 0.5),
                    int(0.07 * w),
                )
                right = next(
                    (x for x in range(int(0.98 * w), int(0.7 * w), -1) if frac[x] > 0.5),
                    int(0.88 * w),
                )
                boxes.append({"x0": left, "x1": right + 1,
                              "y0": y0, "y1": y1, "w": right + 1 - left,
                              "h": y1 - y0})
            if len(boxes) == 4:
                result = analyze_single(
                    a, bank, is_spr, last_page=True, forced_boxes=boxes
                )
        page_results.append(result)
        rendered.append((page_no, a, result))
    return compose(page_results), rendered


def question_rows(bank_key: str) -> dict[tuple[str, str, str], dict]:
    bank = BANKS[bank_key]
    answers: dict[tuple[str, str, str], dict] = {}
    with open(ROOT / bank["answers"], encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            answers[(row["section"], row["module"], row["question_number"])] = row
    questions: dict[tuple[str, str, str], dict] = {}
    with open(ROOT / bank["regions"], encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = (row["section"], row["module"], row["question_number"])
            questions[key] = {
                "pages": [int(p) for p in row["source_pages"].split(",")],
                "type": answers[key]["type"],
            }
    return questions


def annotate(a: np.ndarray, result: dict, path: Path) -> None:
    img = Image.fromarray(a)
    d = ImageDraw.Draw(img)
    def rect(b, color):
        d.rectangle((b["x0"], b["y0"], b["x1"], b["y1"]), outline=color, width=3)
    if result.get("stimulus_box"):
        rect(result["stimulus_box"], (0, 150, 0))
    if result.get("stem_box"):
        rect(result["stem_box"], (200, 120, 0))
    for choice in result.get("choices", []):
        d.rectangle(
            (choice["cx0"], choice["cy0"], choice["cx1"], choice["cy1"]),
            outline=(0, 90, 220),
            width=3,
        )
    if result.get("input_box"):
        rect(result["input_box"], (150, 0, 200))
    img.save(path)


def analyze(bank_keys: list[str]) -> None:
    CHECKS.mkdir(parents=True, exist_ok=True)
    for key in bank_keys:
        bank = BANKS[key]
        questions = question_rows(key)
        doc = pymupdf.open(ROOT / bank["pdf"])
        report = {}
        for qkey, row in questions.items():
            is_spr = row["type"].strip().lower() == "student-produced response"
            try:
                composed, rendered = analyze_question(
                    doc, bank, row["pages"], is_spr, key=qkey
                )
            except Exception as error:  # noqa: BLE001 - report and continue
                report[str(qkey)] = {"error": str(error)}
                continue
            composed["page_dims"] = {
                str(p): [a.shape[1], a.shape[0]] for p, a, _ in rendered
            }
            for kind in ("stem_box", "stimulus_box", "input_box"):
                if kind in composed:
                    composed[kind]["page"] = row["pages"][0]
            # Track which page each surviving choice came from.
            choice_pages: list[int] = []
            for page_no, _, result in rendered:
                choice_pages.extend([page_no] * len(result.get("choices", [])))
            for choice, page_no in zip(composed.get("choices", []), choice_pages):
                choice["page"] = page_no
            report[str(qkey)] = composed
            sample = any(p in SAMPLE_PAGES for p in row["pages"])
            if "error" in composed or sample or len(row["pages"]) > 1:
                for page_no, a, result in rendered:
                    annotate(a, result, CHECKS / f"{key}-{'-'.join(qkey[1:])}-p{page_no:03d}.png")
        out = OUT / f"{key}-analysis.json"
        out.write_text(json.dumps(report, indent=1))
        errors = {q: r for q, r in report.items() if "error" in r}
        print(f"{key}: {len(report)} questions -> {out.name}; {len(errors)} errors")
        for q, r in list(errors.items())[:30]:
            print(f"  {q}: {r['error']}")


# Questions whose printed choices are incomplete in the source scan. Their
# missing options are represented by an explicit placeholder so the package
# stays publishable without inventing content.
MISSING_CHOICE_TEXT = "[Choice not shown in the source scan.]"
MANUAL_GEOMETRY: dict[str, dict] = {
    "Math:1:84": {
        "stem": {"page": 84, "y": (0.115, 0.720)},
        "choices": [
            {"page": 84, "y": (0.725, 0.790)},
            {"page": 84, "y": (0.815, 0.885)},
            {"page": 84, "y": (0.910, 0.975)},
            None,
        ],
    },
    "Math:1:167": {
        "stem": {"page": 167, "y": (0.100, 0.196)},
        "choices": [
            {"page": 167, "y": (0.195, 0.655)},
            {"page": 168, "y": (0.185, 0.628)},
            {"page": 168, "y": (0.653, 0.985)},
            None,
        ],
    },
    "Math:1:179": {
        "stem": {"page": 179, "y": (0.260, 0.393)},
        "choices": [
            {"page": 179, "y": (0.395, 0.897)},
            None,
            None,
            None,
        ],
    },
}


def build_presentations(bank_keys: list[str]) -> None:
    """Convert the analyzed geometry into validated presentation payloads."""
    from whitebook.question_presentation import QuestionPresentation

    for key in bank_keys:
        bank = BANKS[key]
        report = json.loads((OUT / f"{key}-analysis.json").read_text())
        questions = question_rows(key)
        presentations: dict[str, dict] = {}
        problems = 0
        for qkey in questions:
            label = ":".join(qkey)
            composed = report[str(qkey)]
            is_spr = questions[qkey]["type"].strip().lower() == (
                "student-produced response"
            )
            manual = MANUAL_GEOMETRY.get(label) if bank.get("scan_overrides") else None
            if manual:
                presentation = manual_presentation(manual, is_spr)
            elif "error" in composed:
                print(f"  [skip] {label}: {composed['error']}")
                problems += 1
                continue
            else:
                presentation = geometry_presentation(composed, is_spr)
            QuestionPresentation.model_validate(presentation)
            presentations[label] = presentation
        out = OUT / f"{key}-presentations.json"
        out.write_text(json.dumps(presentations, indent=1))
        print(f"{key}: {len(presentations)} presentations -> {out.name}")


def crop_bounds(box: dict) -> tuple[int, int, int, int]:
    """Use the same reviewed interior in previews and published regions."""
    # Choice dicts carry both outer box bounds (y0/y1) and reviewed interior
    # bounds (cx*/cy*); the interior excludes the printed badge and the box's
    # own borders, so it must win whenever present.
    x0 = box["cx0"] if "cx0" in box else box["x0"]
    x1 = box["cx1"] if "cx1" in box else box["x1"]
    y0 = box["cy0"] if "cy0" in box else box["y0"]
    y1 = box["cy1"] if "cy1" in box else box["y1"]
    return x0, y0, x1, y1


def norm_region(page: int, dims: dict, box: dict) -> dict:
    w, h = dims[str(page)]
    x0, y0, x1, y1 = crop_bounds(box)
    return {
        "pageNumber": page,
        "x": max(0.0, round(x0 / w, 5)),
        "y": max(0.0, round(y0 / h, 5)),
        "width": min(1.0, round((x1 - x0) / w, 5)),
        "height": min(1.0, round((y1 - y0) / h, 5)),
        "confirmed": True,
    }


def geometry_presentation(composed: dict, is_spr: bool) -> dict:
    dims = composed["page_dims"]
    stem = composed["stem_box"]
    presentation: dict = {
        "version": 1,
        "stimulus": [],
        "stem": [{"kind": "region", "region": norm_region(stem["page"], dims, stem)}],
    }
    if composed.get("stimulus_box"):
        stim = composed["stimulus_box"]
        presentation["stimulus"] = [
            {"kind": "region", "region": norm_region(stim["page"], dims, stim)}
        ]
    if not is_spr:
        letters = "ABCD"
        presentation["choices"] = [
            {
                "id": letters[index],
                "content": [
                    {
                        "kind": "region",
                        "region": norm_region(choice["page"], dims, choice),
                    }
                ],
            }
            for index, choice in enumerate(composed["choices"])
        ]
    return presentation


def manual_presentation(manual: dict, is_spr: bool) -> dict:
    """Presentations for questions with incomplete source scans."""
    doc = pymupdf.open(ROOT / "question-bank" / "hardest-sat-math-questions.pdf")
    page_size = {
        page: (doc[page - 1].rect.width, doc[page - 1].rect.height)
        for page in (
            manual["stem"]["page"],
            *(c["page"] for c in manual["choices"] if c),
        )
    }
    def region(spec: dict) -> dict:
        page = spec["page"]
        pw, ph = page_size[page]
        y0, y1 = spec["y"]
        x0, x1 = spec.get("x", (0.02, 0.97))
        return {
            "pageNumber": page,
            "x": round(x0, 5),
            "y": round(y0, 5),
            "width": round(x1 - x0, 5),
            "height": round(y1 - y0, 5),
            "confirmed": True,
        }
    presentation: dict = {
        "version": 1,
        "stimulus": [],
        "stem": [{"kind": "region", "region": region(manual["stem"])}],
    }
    if not is_spr:
        letters = "ABCD"
        presentation["choices"] = []
        for index, choice in enumerate(manual["choices"]):
            if choice is None:
                content: list[dict] = [{"kind": "text", "text": MISSING_CHOICE_TEXT}]
            else:
                content = [{"kind": "region", "region": region(choice)}]
            presentation["choices"].append({"id": letters[index], "content": content})
    return presentation


def main() -> None:
    stage = sys.argv[1] if len(sys.argv) > 1 else "analyze"
    keys = sys.argv[2:] or list(BANKS)
    if stage == "analyze":
        analyze(keys)
    elif stage == "build":
        build_presentations(keys)
    elif stage == "publish":
        publish(keys)
    else:
        raise SystemExit(f"unknown stage {stage!r}")




from whitebook.question_presentation import QuestionPresentation as QuestionPresentationModel


def publish(bank_keys: list[str]) -> None:
    """Publish converted revisions of the bank packages."""
    sys.path.insert(0, str(ROOT / "src"))
    from whitebook.authoring import PackageAuthoring

    authoring = PackageAuthoring(ROOT / "data")
    for key in bank_keys:
        bank = BANKS[key]
        presentations = json.loads(
            (OUT / f"{key}-presentations.json").read_text()
        )
        original = authoring.get_package(bank["package"])
        if original is None:
            raise ValueError(f"{key}: source package not found")
        family = [
            item for item in authoring.list_packages(include_archived=True)
            if item["familyId"] == original["familyId"]
        ]
        latest = max(family, key=lambda item: item["revision"])
        draft = authoring.start_package_revision(latest["id"])
        placed = 0
        for index, question in enumerate(draft.questions):
            qkey = ":".join(
                (question["section"], str(question["module"]),
                 str(question["questionNumber"]))
            )
            payload = presentations.get(qkey)
            if payload is None:
                raise ValueError(f"{key}: missing presentation for {qkey}")
            authoring.set_question_presentation(
                draft.id, index, QuestionPresentationModel.model_validate(payload)
            )
            placed += 1
        progress = authoring.get_import_draft(draft.id).mapping_progress
        if progress["confirmed"] != progress["total"]:
            print(f"[FAIL] {key}: mapping {progress}")
            sys.exit(1)
        package = authoring.publish(draft.id)
        # Keep historical attempts intact, but offer only the repaired bank
        # when starting new practice. Archive only after publication succeeds.
        for previous in family:
            if not previous["archived"]:
                authoring.set_archived(previous["id"], archived=True)
        print(
            f"[published] {key}: revision {package['revision']} | "
            f"{package['questionCount']} questions | {placed} presentations | "
            f"eligible={package['simulationEligible']}"
        )


if __name__ == "__main__":
    main()
