"""Build the three Whitebook answer CSVs from scan fragments + the user's Hardest table.

- meo-answers.csv        (Reading and Writing, from meo.pdf page scans)
- meo-math-answers.csv   (Math, from meo-math.pdf page scans)
- hardest-answers.csv    (Math, user-provided page->answer table + scanned type/category)

Each bank also gets a companion *-regions.csv mapping question -> source PDF page(s).
Question numbers are renumbered 1..N within each (section, module) in page order.
"""
import csv, json, glob, os

SCANS = "question-bank/scans"
OUT = "question-bank"

def load(paths):
    rows = []
    for f in paths:
        with open(f, encoding="utf-8") as fh:
            rows += list(csv.DictReader(fh))
    return rows

def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["section","module","question_number","type","correct_answer","category"])
        w.writerows(rows)
    print(f"{path}: {len(rows)} rows")

# ---------- meo.pdf (Reading and Writing) ----------
meo = load([f"{SCANS}/meo-{a:03d}-{b:03d}.csv" for a,b in
            [(1,26),(27,52),(53,78),(79,104),(105,130),(131,156),(157,182),(183,208),(209,230),(231,254)]])
assert len(meo) == 254
meo_rows, regions = [], []
counters = {}
for r in meo:
    page = int(r["page"]); mod = r["module_label"]
    counters[mod] = counters.get(mod, 0) + 1
    qn = counters[mod]
    meo_rows.append(["Reading and Writing", mod, qn, r["type"], r["answer"], r["category"]])
    regions.append(["Reading and Writing", mod, qn, str(page)])
write_csv(f"{OUT}/meo-answers.csv", meo_rows)

# ---------- meo-math.pdf (Math) ----------
mm = load([f"{SCANS}/meo-math-{a:03d}-{b:03d}.csv" for a,b in
           [(1,26),(27,52),(53,78),(79,104),(105,130),(131,156),(157,182),(183,203)]])
assert len(mm) == 203
CONTINUATIONS = {86: 85, 156: 155}   # page -> parent question page
by_page = {int(r["page"]): r for r in mm}
# Printed module badges on p64 ("Module 1") and p131 ("Module 2") contradict their
# neighboring pages; verification-findings.md settles on the context-smoothed split.
MODULE_OVERRIDES = {64: "2", 131: "1"}
mm_rows, regions = [], []
counters = {}
for r in mm:
    page = int(r["page"])
    if page in CONTINUATIONS:
        parent = by_page[CONTINUATIONS[page]]
        assert r["answer"] == parent["answer"] and r["module_label"] == parent["module_label"], (page, r, parent)
        continue
    mod = MODULE_OVERRIDES.get(page, r["module_label"])
    counters[mod] = counters.get(mod, 0) + 1
    qn = counters[mod]
    mm_rows.append(["Math", mod, qn, r["type"], r["answer"], r["category"]])
    regions.append(["Math", mod, qn, str(page)])
write_csv(f"{OUT}/meo-math-answers.csv", mm_rows)

# ---------- Hardest SAT math questions.pdf (Math) ----------
h = load([f"{SCANS}/hardest-{a:03d}-{b:03d}.csv" for a,b in
          [(1,25),(26,50),(51,75),(76,100),(101,125),(126,150),(151,175),(176,200),(201,225),(226,241)]])
assert len(h) == 241
hmeta = {int(r["page"]): r for r in h}

user = {}
with open(f"{OUT}/hardest-user-table.csv", encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        user[int(r["page"])] = r["raw_answer"]

DUP_OR_CONT = {162: "duplicate of 161", 168: "continuation of 167", 178: "continuation of 179", 229: "duplicate of 228"}
# p188 is the "what could be the median" frequency-table question: the visible box is
# the SPR answer-entry box, not a choice; the scan mislabeled it.
TYPE_OVERRIDES = {188: "student-produced response"}

def parse_raw(raw, page):
    """-> (correct_answer, flagged_note or None)"""
    raw = raw.strip()
    if raw in ("A1", "A¹"): return "A", None
    if raw == "-26^2": return "-25", "key said '-26²' (footnote marker); mathematically least integer b is -25"
    if raw == "-10 OR -15": return "-10|-15", None
    if raw == "ANY (25-34)": return "|".join(str(v) for v in range(25, 35)), "key said 'ANY (25-34)'; enumerated integers"
    return raw, None

h_rows, regions, flags = [], [], []
skipped = []
for page in range(1, 242):
    raw = user[page]
    if page in DUP_OR_CONT:
        skipped.append((page, DUP_OR_CONT[page]))
        continue
    meta = hmeta[page]
    ans, note = parse_raw(raw, page)
    typ = TYPE_OVERRIDES.get(page, meta["type"])
    is_mc_ans = ans in list("ABCD")
    if is_mc_ans and typ != "multiple choice" and typ:
        flags.append((page, f"type says '{typ}' but answer is {ans}"))
    if not is_mc_ans and typ == "multiple choice":
        flags.append((page, f"type says MC but answer '{ans}'"))
    if not typ:
        typ = "multiple choice" if is_mc_ans else "student-produced response"
        flags.append((page, f"type undetermined by scan; inferred '{typ}' from answer"))
    if note:
        flags.append((page, note))
    h_rows.append(["Math", "1", page, typ, ans, meta["category"]])
    regions.append(["Math", "1", page, str(page)])
write_csv(f"{OUT}/hardest-answers.csv", h_rows)

# ---------- companions ----------
for name, rows in [("meo", None), ("meo-math", None), ("hardest", None)]:
    pass
def write_regions(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["section","module","question_number","source_pages"])
        w.writerows(rows)
    print(f"{path}: {len(rows)} rows")

# rebuild region lists (they were overwritten above)
regions = []
counters = {}
for r in meo:
    mod = r["module_label"]; counters[mod] = counters.get(mod, 0) + 1
    regions.append(["Reading and Writing", mod, counters[mod], r["page"]])
write_regions(f"{OUT}/meo-regions.csv", regions)
regions = []
counters = {}
parent_of = {parent: page for page, parent in CONTINUATIONS.items()}
for r in mm:
    page = int(r["page"])
    if page in CONTINUATIONS: continue
    mod = MODULE_OVERRIDES.get(page, r["module_label"]); counters[mod] = counters.get(mod, 0) + 1
    pages = [page] + ([parent_of[page]] if page in parent_of else [])
    regions.append(["Math", mod, counters[mod], ",".join(str(p) for p in pages)])
write_regions(f"{OUT}/meo-math-regions.csv", regions)
regions = [[ "Math","1",p,str(p)] for p in range(1,242) if p not in DUP_OR_CONT]
write_regions(f"{OUT}/hardest-regions.csv", regions)

print("\nskipped (dup/continuation pages):", skipped)
print("\nflags:")
for p, m in flags:
    print(f"  p{p}: {m}")
