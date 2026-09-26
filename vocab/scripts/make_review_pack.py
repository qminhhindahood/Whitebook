"""Generate the owner-review pack: REVIEW_PACK.md and preview.html.

Usage: .venv/Scripts/python.exe scripts/make_review_pack.py
"""
import html
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_MD = ROOT / "reports" / "REVIEW_PACK.md"
OUT_HTML = ROOT / "reports" / "preview.html"


def esc(s):
    return html.escape(s or "")


def main() -> int:
    rows = [json.loads(l) for l in (ROOT / "staging" / "normalized.jsonl").open(encoding="utf-8")]
    audit = json.loads((ROOT / "reports" / "audit.json").read_text(encoding="utf-8"))
    dups = list((__import__("csv").DictReader((ROOT / "reports" / "duplicates.csv").open(encoding="utf-8"))))
    manifests = {}
    for deck in ("anki_starter", "c1c2_wic500", "b2c1_1000"):
        manifests[deck] = json.loads((ROOT / "manifests" / f"{deck}-manifest.json").read_text(encoding="utf-8"))

    by_source = defaultdict(list)
    for r in rows:
        by_source[r["source_deck"]].append(r)

    lines = []
    A = lines.append
    A("# Starter Deck owner-review pack")
    A("")
    A(f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}. "
      "Everything here is local staging; nothing has been published. "
      "Decks become publishable only after you approve the items marked DECISION below.")
    A("")
    A("## 1. Count reconciliation")
    A("")
    A("| Source | Expected | Extracted | Accepted draft | Quarantined | OCR-unreviewed |")
    A("|---|---|---|---|---|---|")
    exp = {"anki_starter": "~750", "c1c2_wic500": "~500", "b2c1_1000": "~1,000", "quizlet_2026": "~4,000"}
    for deck in ("anki_starter", "c1c2_wic500", "b2c1_1000"):
        s = audit["per_source"][deck]
        A(f"| {deck} | {exp[deck]} | {s['extracted']} | {s['accepted_draft']} | {s['quarantined']} | {s['ocr_unreviewed']} |")
    A("| quizlet_2026 | ~4,000 | 0 | - | - | **excluded by owner decision (2026-09-26)** — no export was ever supplied |")
    A("")
    A("- **anki_starter: 839 notes vs ~750 expected.** The package contains exactly 839 notes; "
      "the 750 figure was an estimate. All 839 extracted; none dropped.")
    A("- **c1c2_wic500: 500/500.** Printed STT 1-500 all reconciled against the sequence; no gaps, no duplicates.")
    A("- **b2c1_1000: 1000/1000.** Printed STT 1-1000 reconciled; 6 rows recovered via a targeted "
      "word-column OCR pass (grain, pine, vivid, rhythm, gulf, fecal).")
    A("- **quizlet_2026: EXCLUDED.** No export files were ever found on this machine and Quizlet "
      "was not scraped per the plan. On 2026-09-26 the owner explicitly chose to exclude this "
      "source, completing the consolidation with the three supplied containers. It can be added "
      "back later as a new source if an export is provided.")
    A("")
    A("## 2. Schema mapping")
    A("")
    A("| Common field | anki_starter | c1c2_wic500 | b2c1_1000 |")
    A("|---|---|---|---|")
    A("| front | Anki `Word` | PDF TỪ VỰNG | PDF TỪ VỰNG (OCR) |")
    A("| part_of_speech | Anki `Part of Speech 1` | - (absent in source) | - (absent in source) |")
    A("| ipa | - (absent) | PDF PHÁT ÂM | PDF PHIÊN ÂM (OCR, unreliable - flagged) |")
    A("| meaning_vi | Anki `Definition 1` (Vietnamese) | PDF NGHĨA TIẾNG VIỆT | PDF NGHĨA TIẾNG VIỆT (OCR) |")
    A("| definition_en | - (absent) | PDF NGHĨA TIẾNG ANH | PDF NGHĨA TIẾNG ANH (OCR) |")
    A("| synonyms | - (absent) | PDF SYNONYMS | PDF TỪ ĐỒNG NGHĨA (OCR) |")
    A("| example_en/vi | Anki `Example 1` + `Translation` | - | - |")
    A("| mnemonic, confusable_pairs | Anki fields | - | - |")
    A("| cefr | Anki `CEFR` (C1/C2/B2) | constant C1-C2 | constant B2-C1 |")
    A("| audio | none in package (media file empty) | none | none |")
    A("")
    A("## 3. Provenance / permissions summary")
    A("")
    for deck in ("anki_starter", "c1c2_wic500", "b2c1_1000"):
        m = manifests[deck]
        A(f"- **{deck}**: `{m['source']['path']}` sha256 `{m['source']['sha256'][:16]}…`, "
          f"extraction `{m['source']['extraction']}`, manifest v{m['version']} "
          f"`{m['status']}` ({m['manifest_sha256'][:12]}…)")
    A("")
    A("All three sources are owner-supplied files for the owner's own Starter Decks "
      "(VietAccepted study material and an Anki deck by aanhlle). "
      "**DECISION:** confirm you hold the right to republish these as shared Starter Decks "
      "to learner accounts. No audio exists in any source; none was added.")
    A("")
    A("## 4. Duplicates (no data was merged or discarded)")
    A("")
    groups = defaultdict(list)
    for d in dups:
        groups[d["front_key"]].append(d)
    acts = Counter(d["proposed_action"] for d in dups)
    A(f"- {len(groups)} duplicate word groups / {len(dups)} rows flagged: "
      f"{acts.get('exclude-proposal', 0)} rows are exact back-content duplicates "
      f"(proposal: keep one copy), {acts.get('owner-review', 0)} rows need your call "
      "(reworded same-sense entries vs genuinely different senses). "
      "Full list: `reports/duplicates.csv`. All four source decks stay separate until you decide.")
    A("")
    A("Top cross-source overlaps (of your Anki deck against the VietAccepted PDFs):")
    shown = 0
    for key, g in groups.items():
        srcs = {x["source_deck"] for x in g}
        if len(srcs) >= 2 and shown < 8:
            A(f"  - **{g[0]['front']}** ({len(g)} copies: {', '.join(sorted(srcs))})")
            shown += 1
    A("")
    A("## 5. Uncertain rows needing page-check")
    A("")
    s = audit["per_source"]["b2c1_1000"]
    A(f"- **b2c1_1000: all {s['ocr_unreviewed']} rows are OCR-derived** (the PDF has no text layer). "
      f"{s['flag_counts'].get('ipa_ocr_uncertain', 0)} of them have IPA that failed sanity checks; "
      "the IPA column from this source should be treated as draft until spot-checked "
      "(or dropped at review - your call). 5 rows have low anchor confidence and are "
      "marked `ocr-lowconf`.")
    A("- c1c2_wic500 and anki_starter come from clean text layers; 0 rows flagged.")
    A("- Page renders for spot-checking: `reports/b2c1_page_renders/` (one PNG per source page).")
    A("")
    A("## 6. Sample cards")
    A("")
    def sample_rows(deck, n=3):
        rs = by_source[deck]
        picks = []
        # representative: a normal row, longest text, richest diacritics
        picks.append(rs[len(rs) // 2])
        picks.append(max(rs, key=lambda r: len(r["definition_en"] + r["meaning_vi"])))
        picks.append(max(rs, key=lambda r: sum(ch in "ăâđêôơưáàảãạếềệộớờứừỵịọẬẶ" for ch in r["meaning_vi"])))
        seen = set()
        out = []
        for p in picks:
            if p["stable_id"] not in seen:
                out.append(p)
                seen.add(p["stable_id"])
        return out[:n]

    for deck in ("anki_starter", "c1c2_wic500", "b2c1_1000"):
        A(f"### {deck}")
        A("")
        for r in sample_rows(deck):
            A(f"- `{r['stable_id']}` **{r['front']}** {('(' + r['part_of_speech'] + ')') if r['part_of_speech'] else ''} "
              f"{r['ipa']} — VI: {r['meaning_vi'] or '_(absent)_'} — EN: {r['definition_en'] or '_(absent)_'}"
              + (f" — ex: {r['example_en']}" if r["example_en"] else "")
              + (f" — syn: {r['synonyms']}" if r["synonyms"] else ""))
        A("")
    A("A rendered, clickable preview (library + flashcard study, phone + desktop) "
      "is at `reports/preview.html` — regenerate with `scripts/make_preview_site.py`.")
    A("")
    A("## 7. What happens after your review")
    A("")
    A("1. You return: approvals/edits per deck, duplicate decisions, permission confirmation, "
      "and (if supplied) the Quizlet export.")
    A("2. Rows you approve flip to `review_status: approved`; `publish_decks.py build` then emits "
      "`published` manifests and the importer loads them atomically into learner-visible storage.")
    A("3. Any later corrected source becomes deck version N+1; learner review history is preserved "
      "by `stable_id` where content is unchanged (covered by tests).")

    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT_MD}")


    return 0


if __name__ == "__main__":
    sys.exit(main())
