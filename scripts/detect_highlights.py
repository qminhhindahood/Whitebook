"""Detect the highlighted (correct) choice on meo/meo-math rendered pages.

The correct MC choice is a box with light purple fill (238,229,250) whose
letter circle is a solid purple disc; the other letter circles are gray
(222,222,222). We find the purple disc column, then cluster non-white runs
in that column strip into letter circles; the purple one's index = letter.
"""
import sys, os, json
import numpy as np
from PIL import Image


def close(arr, color, tol):
    return (np.abs(arr.astype(np.int16) - np.array(color, dtype=np.int16)) <= tol).all(axis=-1)


def detect(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im)
    h, w, _ = a.shape
    y0s, y1s = int(h * 0.08), int(h * 0.93)   # skip header badge & footer pills
    x0s, x1s = int(w * 0.28), int(w * 0.85)
    region = a[y0s:y1s, x0s:x1s]
    purple = close(region, (89, 0, 204), 45) | close(region, (108, 29, 209), 35)

    col_counts = purple.sum(axis=0)
    disc_cols = np.where(col_counts >= 35)[0]
    if len(disc_cols) == 0:
        return {"page": os.path.basename(path), "kind": "no_disc"}
    # disc columns = contiguous group with the tallest column mass
    groups, start, prev = [], disc_cols[0], disc_cols[0]
    for c in disc_cols[1:]:
        if c - prev > 20:
            groups.append((start, prev)); start = c
        prev = c
    groups.append((start, prev))
    g = max(groups, key=lambda g: purple[:, g[0]:g[1] + 1].sum())
    bx = (g[0] + g[1]) // 2

    strip = region[:, bx - 35: bx + 36]
    nonwhite = (strip < 240).any(axis=-1).sum(axis=1) > 10
    runs, start, prev = [], None, None
    for y in np.where(nonwhite)[0]:
        if start is None:
            start = prev = y; continue
        if y - prev > 12:
            runs.append((start, prev)); start = y
        prev = y
    if start is not None:
        runs.append((start, prev))
    runs = [r for r in runs if r[1] - r[0] >= 35]
    if len(runs) < 2:
        return {"page": os.path.basename(path), "kind": "ambiguous", "note": f"runs={runs}"}
    # classify each run by purple share
    idx = None
    for i, (s, e) in enumerate(runs):
        share = purple[s:e + 1, bx - 35: bx + 36].mean()
        if share > 0.1:
            idx = i
            break
    kind = "mc" if idx is not None and idx < 4 else "ambiguous"
    letter = "ABCD"[idx] if idx is not None and idx < 4 else "?"
    return {"page": os.path.basename(path), "kind": kind, "letter": letter,
            "n_circles": len(runs)}


def main(folder, out):
    results = []
    for f in sorted(os.listdir(folder)):
        if not f.endswith(".png"):
            continue
        try:
            r = detect(os.path.join(folder, f))
        except Exception as e:  # noqa
            r = {"page": f, "kind": "error", "note": str(e)}
        r["page"] = int(r["page"][1:4])
        results.append(r)
    with open(out, "w") as fh:
        json.dump(results, fh, indent=1)
    kinds = {}
    for r in results:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    print(folder, json.dumps(kinds))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
