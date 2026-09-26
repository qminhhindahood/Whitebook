"""Normalize all extracted sources into a common draft schema, detect
duplicates (without merging), and audit quality.

Usage: .venv/Scripts/python.exe scripts/normalize_audit.py

Outputs:
- staging/normalized.jsonl   one row per source record, common schema
- reports/duplicates.csv     proposed duplicate actions for owner review
- reports/audit.json         per-source accepted/quarantined/duplicate counts
No record is discarded: questionable rows are flagged review_status
'quarantine' with machine-readable reasons.
"""
import csv
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGING = ROOT / "staging"
OUT_NORM = STAGING / "normalized.jsonl"
OUT_DUP = ROOT / "reports" / "duplicates.csv"
OUT_AUDIT = ROOT / "reports" / "audit.json"

SOURCES = ["anki_starter", "c1c2_wic500", "b2c1_1000"]
EXPECTED = {"anki_starter": 750, "c1c2_wic500": 500, "b2c1_1000": 1000}

VN_CHARS = re.compile(r"[ăâđêôơưàáảãạấầẩẫậèéẻẽẹếềểễệìíỉĩịòóỏõọốồổỗộớờởỡợùúủũụứừửữựỳýỷỹỵ]", re.I)
MOJIBAKE = re.compile("[\ufffd]|Ã.|â€")
IPA_RE = re.compile(r"[/\ːˈˌəɪʊæɑɒɔɛʌʒʃθðŋɡːˈˌa-zæ ø œ ɐ ɜ ɞ ɟ ɠ]")  # loose
WS = re.compile(r"\s+")


def norm_text(s: str) -> str:
    """Display normalization: NFC + whitespace collapse. Never rewords."""
    if not s:
        return ""
    return WS.sub(" ", unicodedata.normalize("NFC", s)).strip()


def compare_key(s: str) -> str:
    """Comparison normalization: casefold, strip diacritics/punct/spacing."""
    s = unicodedata.normalize("NFD", norm_text(s).casefold())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return WS.sub(" ", s).strip()


def stable_id(source_deck: str, original_id: str) -> str:
    return hashlib.sha256(f"{source_deck}:{original_id}".encode()).hexdigest()[:16]


def audit_flags(row: dict) -> list[str]:
    flags = []
    front, vi = row["front"], row["meaning_vi"]
    back = " ".join(filter(None, [vi, row["definition_en"], row["example_en"]]))
    if not front:
        flags.append("missing_front")
    if not back:
        flags.append("missing_back")
    if MOJIBAKE.search(front + back):
        flags.append("broken_characters")
    if front and VN_CHARS.search(front):
        flags.append("unexpected_language_front")
    if row["ipa"] and not row["ipa"].startswith("/"):
        flags.append("ipa_not_delimited")
    if re.search(r"(  |\t)", front + back):
        flags.append("formatting_whitespace")
    if row["source_deck"] == "b2c1_1000":
        flags.append("ocr_source_unreviewed")
        if row["ipa_uncertain"]:
            flags.append("ipa_ocr_uncertain")
        if VN_CHARS.search(row["ipa"]):
            flags.append("ipa_contains_vietnamese")
    return flags


def main() -> int:
    records = []
    for src in SOURCES:
        path = STAGING / {
            "anki_starter": "anki_starter.jsonl",
            "c1c2_wic500": "c1c2_wic500.jsonl",
            "b2c1_1000": "b2c1_1000.jsonl",
        }[src]
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                raw = json.loads(line)
                rec = {
                    "stable_id": stable_id(raw["source_deck"], raw["original_id"]),
                    "source_deck": raw["source_deck"],
                    "source_ref": raw["source_ref"],
                    "original_id": raw["original_id"],
                    "source_path": raw["source_path"],
                    "source_sha256": raw["source_sha256"],
                    "extraction": raw["extraction"],
                    "imported_at": raw["imported_at"],
                    "front": norm_text(raw["front"]),
                    "part_of_speech": norm_text(raw.get("part_of_speech", "")),
                    "ipa": norm_text(raw.get("ipa", "")),
                    "ipa_uncertain": bool(raw.get("ipa_uncertain")),
                    "meaning_vi": norm_text(raw.get("meaning_vi", "")),
                    "definition_en": norm_text(raw.get("definition_en", "")),
                    "synonyms": norm_text(raw.get("synonyms", "")),
                    "example_en": norm_text(raw.get("example_en", "")),
                    "example_vi": norm_text(raw.get("example_vi", "")),
                    "mnemonic": norm_text(raw.get("mnemonic", "")),
                    "confusable_pairs": norm_text(raw.get("confusable_pairs", "")),
                    "cefr": norm_text(raw.get("cefr", "")),
                    "audio": raw.get("audio", []),
                    "anki_tags": raw.get("anki_tags", []),
                    "anki_subdeck": raw.get("anki_subdeck", ""),
                    "ocr_anchor_conf": raw.get("ocr_anchor_conf"),
                    "review_status": raw["review_status"],
                    "raw_fields": raw.get("raw_fields", {}),
                    "flags": [],
                }
                rec["flags"] = audit_flags(rec)
                hard = {"missing_front", "missing_back", "broken_characters"}
                if hard & set(rec["flags"]):
                    rec["review_status"] = "quarantine"
                records.append(rec)

    # duplicates: exact key = front compare key; sense key adds back fields
    groups = defaultdict(list)
    for rec in records:
        groups[compare_key(rec["front"])].append(rec)

    dup_actions = []
    for key, members in groups.items():
        if len(members) < 2 or not key:
            continue  # empty fronts are quarantine material, not duplicates
        # exact duplicates: same front AND same back content
        sense_keys = defaultdict(list)
        for m in members:
            sense = compare_key(m["meaning_vi"] + "|" + m["definition_en"])
            sense_keys[sense].append(m)
        exact = len(sense_keys) == 1
        within = defaultdict(list)
        for m in members:
            within[m["source_deck"]].append(m)
        # identical back content -> propose excluding the redundant copy;
        # reworded or richer backs can be the same sense or genuinely
        # different senses - that judgment stays with the owner
        action = "exclude-proposal" if exact else "owner-review"
        for m in members:
            dup_actions.append({
                "front_key": key,
                "front": m["front"],
                "stable_id": m["stable_id"],
                "source_deck": m["source_deck"],
                "original_id": m["original_id"],
                "meaning_vi": m["meaning_vi"],
                "definition_en": m["definition_en"],
                "group_size": len(members),
                "distinct_senses": len(sense_keys),
                "within_source_dupes": sum(1 for v in within.values() if len(v) > 1 and m in v),
                "proposed_action": action,
            })

    with OUT_DUP.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(dup_actions[0].keys()) if dup_actions else ["front_key"])
        writer.writeheader()
        writer.writerows(dup_actions)

    stats = {}
    for src in SOURCES:
        rows = [r for r in records if r["source_deck"] == src]
        flagged = [r for r in rows if r["review_status"] == "quarantine"]
        ocr = [r for r in rows if r["review_status"].startswith("ocr")]
        stats[src] = {
            "expected_approx": EXPECTED[src],
            "extracted": len(rows),
            "accepted_draft": len(rows) - len(flagged),
            "quarantined": len(flagged),
            "ocr_unreviewed": len(ocr),
            "quarantine_ids": [r["original_id"] for r in flagged][:20],
            "flag_counts": dict(Counter(f for r in rows for f in r["flags"])),
        }
    dup_groups = len({d["front_key"] for d in dup_actions})
    audit = {
        "totals": {
            "records": len(records),
            "duplicate_rows_listed": len(dup_actions),
            "duplicate_groups": dup_groups,
        },
        "per_source": stats,
    }
    OUT_AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")

    with OUT_NORM.open("w", encoding="utf-8", newline="\n") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(json.dumps(audit["totals"], indent=1))
    for src, s in stats.items():
        print(f"{src}: extracted {s['extracted']} (expected ~{s['expected_approx']}), "
              f"quarantined {s['quarantined']}, ocr-unreviewed {s['ocr_unreviewed']}")
    print(f"-> {OUT_NORM}\n-> {OUT_DUP}\n-> {OUT_AUDIT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
