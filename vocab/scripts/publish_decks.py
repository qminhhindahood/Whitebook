"""Build hash-checked Starter Deck manifests and import them idempotently
into a local draft store.

Usage:
  .venv/Scripts/python.exe scripts/publish_decks.py build   # manifests from staging
  .venv/Scripts/python.exe scripts/publish_decks.py import  # import manifests
  .venv/Scripts/python.exe scripts/publish_decks.py all

Publication boundary: a manifest is only importable when every card row is
owner-approved (review_status == 'approved'). Draft builds carry
status 'draft-pending-owner-review' and the importer refuses them, so
nothing reaches learner-visible storage before review. Rebuilding with a
changed source produces a NEW deck version; existing learner rows are kept
keyed by stable_id.
"""
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGING = ROOT / "staging"
MANIFEST_DIR = ROOT / "manifests"
STORE = ROOT / "manifests" / "vocab-store.sqlite3"

DECKS = {
    "anki_starter": "anki_starter.jsonl",
    "c1c2_wic500": "c1c2_wic500.jsonl",
    "b2c1_1000": "b2c1_1000.jsonl",
}

SCHEMA_VERSION = 1


def canonical_hash(obj) -> str:
    return hashlib.sha256(
        json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def build_manifests() -> int:
    MANIFEST_DIR.mkdir(exist_ok=True)
    records = [json.loads(l) for l in (STAGING / "normalized.jsonl").open(encoding="utf-8")]
    built = []
    for deck in DECKS:
        rows = [r for r in records if r["source_deck"] == deck]
        approved = [r for r in rows if r["review_status"] == "approved"]
        status = "published" if len(approved) == len(rows) and rows else "draft-pending-owner-review"
        cards = [{
            "stable_id": r["stable_id"],
            "front": r["front"],
            "part_of_speech": r["part_of_speech"],
            "ipa": r["ipa"],
            "meaning_vi": r["meaning_vi"],
            "definition_en": r["definition_en"],
            "synonyms": r["synonyms"],
            "example_en": r["example_en"],
            "example_vi": r["example_vi"],
            "cefr": r["cefr"],
            "audio": r["audio"],
            "source_ref": r["source_ref"],
            "review_status": r["review_status"],
        } for r in rows]
        prev = MANIFEST_DIR / f"{deck}-manifest.json"
        prev_version = 0
        prev_cards_hash = None
        if prev.exists():
            old = json.loads(prev.read_text(encoding="utf-8"))
            prev_version = old["version"]
            prev_cards_hash = old["cards_sha256"]
        cards_hash = canonical_hash(cards)
        version = prev_version + (0 if cards_hash == prev_cards_hash else 1) if prev.exists() else 1
        manifest = {
            "schema_version": SCHEMA_VERSION,
            "deck_id": deck,
            "version": version,
            "status": status,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "card_count": len(cards),
            "approved_count": len(approved),
            "source": {
                "path": rows[0]["source_path"],
                "sha256": rows[0]["source_sha256"],
                "extraction": rows[0]["extraction"],
                "imported_at": rows[0]["imported_at"],
            },
            "cards_file": f"{deck}-v{version}-cards.json",
            "cards_sha256": cards_hash,
            "manifest_sha256": None,  # filled below
        }
        manifest["manifest_sha256"] = canonical_hash(
            {k: v for k, v in manifest.items() if k != "manifest_sha256"})
        (MANIFEST_DIR / manifest["cards_file"]).write_text(
            json.dumps(cards, ensure_ascii=False, indent=0), encoding="utf-8")
        # drop stale card files from superseded draft rebuilds of the same version
        prev.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        built.append((deck, version, status, len(cards), manifest["manifest_sha256"][:12]))
    for deck, version, status, n, h in built:
        print(f"{deck}: v{version} {status} ({n} cards) manifest={h}...")
    return 0


def import_manifests(store: Path = None, manifest_dir: Path = None) -> int:
    store = store or STORE
    manifest_dir = manifest_dir or MANIFEST_DIR
    con = sqlite3.connect(str(store))
    con.execute("""CREATE TABLE IF NOT EXISTS deck_cards (
        deck_id TEXT NOT NULL,
        deck_version INTEGER NOT NULL,
        stable_id TEXT NOT NULL,
        front TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (deck_id, deck_version, stable_id))""")
    con.execute("""CREATE TABLE IF NOT EXISTS deck_versions (
        deck_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        cards_sha256 TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY (deck_id, version))""")
    report = []
    for deck in DECKS:
        mpath = manifest_dir / f"{deck}-manifest.json"
        if not mpath.exists():
            continue
        m = json.loads(mpath.read_text(encoding="utf-8"))
        if m["status"] != "published":
            report.append({"deck": deck, "imported": False,
                           "reason": f"manifest status '{m['status']}' - owner approval pending"})
            continue
        cards = json.loads((manifest_dir / m["cards_file"]).read_text(encoding="utf-8"))
        if canonical_hash(cards) != m["cards_sha256"]:
            report.append({"deck": deck, "imported": False,
                           "reason": "cards file hash mismatch - manifest/card tampering or truncation"})
            continue
        cur = con.execute(
            "SELECT cards_sha256 FROM deck_versions WHERE deck_id=? AND version=?",
            (deck, m["version"]))
        existing = cur.fetchone()
        if existing:
            report.append({"deck": deck, "imported": False,
                           "reason": f"v{m['version']} already imported (idempotent no-op)"})
            continue
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for c in cards:
            con.execute("INSERT OR IGNORE INTO deck_cards VALUES (?,?,?,?,?)",
                        (deck, m["version"], c["stable_id"], c["front"],
                         json.dumps(c, ensure_ascii=False)))
        con.execute("INSERT INTO deck_versions VALUES (?,?,?,?,?,?)",
                    (deck, m["version"], m["status"], m["cards_sha256"],
                     m["manifest_sha256"], now))
        report.append({"deck": deck, "imported": True, "version": m["version"],
                       "cards": len(cards)})
    con.commit()
    total = con.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0]
    con.close()
    print(json.dumps(report, indent=1))
    print(f"store rows total: {total}")
    return 0


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("build", "all"):
        build_manifests()
    if cmd in ("import", "all"):
        import_manifests()
    return 0


if __name__ == "__main__":
    sys.exit(main())
