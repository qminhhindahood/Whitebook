"""Extract Anki .apkg notes into a staging JSONL with per-row provenance.

Usage: .venv/Scripts/python.exe scripts/extract_anki.py
Reads extracted/apkg/collection.anki21b (zstd sqlite), writes staging/anki_starter.jsonl.
Card HTML is kept as inert text: stripped of markup, never executed.
"""
import io
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import zstandard

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extracted" / "apkg" / "collection.anki21b"
OUT = ROOT / "staging" / "anki_starter.jsonl"

SOURCE_PATH = r"D:\Notion\[STARTER] aanhlle's SAT Words ⚡ (1).apkg"
SOURCE_SHA256 = "b6e153ba76ee400ced57fcf1c94cda3feb9cd755ccaf8eb32568c9ec6f1c22ef"

# Notetype 1607392320 "aanhlle SAT Model (STARTER)" field order.
FIELD_NAMES = ["word", "pos", "meaning_vi", "example_en", "example_vi",
               "mnemonic", "confusable_pairs", "cefr"]

TAG_RE = re.compile(r"\S+")


def strip_html(text: str) -> str:
    """Render Anki field HTML as plain display text. Markup is data, never code."""
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|li|tr)>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'"))
    text = re.sub(r"[ \t]+", " ", text)
    return "\n".join(line.strip() for line in text.splitlines() if line.strip()).strip()


def main() -> int:
    raw = SRC.read_bytes()
    dctx = zstandard.ZstdDecompressor()
    try:
        buf = dctx.decompress(raw)
    except zstandard.ZstdError:
        buf = b"".join(dctx.read_to_iter(io.BytesIO(raw)))
    (ROOT / "extracted" / "apkg" / "collection.anki21b.sqlite3").write_bytes(buf)

    con = sqlite3.connect(str(ROOT / "extracted" / "apkg" / "collection.anki21b.sqlite3"))
    con.create_collation("unicase", lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
    cur = con.cursor()

    deck_names = dict(cur.execute("select id, name from decks").fetchall())
    card_deck = dict(cur.execute("select nid, did from cards").fetchall())

    imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows_out = 0
    problems = []
    with OUT.open("w", encoding="utf-8", newline="\n") as fh:
        for nid, guid, mid, tags, flds in cur.execute(
                "select id, guid, mid, tags, flds from notes"):
            parts = flds.split("\x1f")
            if mid != 1607392320 or len(parts) < len(FIELD_NAMES):
                problems.append({"note_id": nid, "reason": f"unexpected mid/field count: {mid}, {len(parts)}"})
                continue
            record = dict(zip(FIELD_NAMES, parts))
            did = card_deck.get(nid)
            deck = deck_names.get(did, "")
            deck_sub = deck.split("\x1f")[-1].strip() if deck else ""
            row = {
                "source_deck": "anki_starter",
                "source_ref": f"note:{nid}",
                "original_id": str(nid),
                "guid": guid,
                "imported_at": imported_at,
                "source_path": SOURCE_PATH,
                "source_sha256": SOURCE_SHA256,
                "extraction": "anki21b-sqlite",
                "review_status": "extracted",
                "anki_tags": sorted(TAG_RE.findall(tags or "")),
                "anki_subdeck": deck_sub,
                "front": strip_html(record["word"]),
                "part_of_speech": strip_html(record["pos"]),
                "meaning_vi": strip_html(record["meaning_vi"]),
                "definition_en": "",  # field named 'Definition 1' holds Vietnamese in this deck
                "example_en": strip_html(record["example_en"]),
                "example_vi": strip_html(record["example_vi"]),
                "mnemonic": strip_html(record["mnemonic"]),
                "confusable_pairs": strip_html(record["confusable_pairs"]),
                "cefr": strip_html(record["cefr"]),
                "ipa": "",
                "audio": [],
                "raw_fields": record,  # original back fields preserved for audit
            }
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            rows_out += 1

    print(f"wrote {rows_out} rows -> {OUT}")
    if problems:
        print(f"{len(problems)} problem rows:", json.dumps(problems, ensure_ascii=False, indent=1))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
