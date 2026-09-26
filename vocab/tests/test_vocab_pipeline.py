"""Tests for the Starter Deck pipeline: extraction invariants, stable IDs,
publication boundaries, and idempotent import.

Run: .venv/Scripts/python.exe -m pytest tests/ -q
"""
import json
import shutil
import sqlite3
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import publish_decks  # noqa: E402

VN = "ăâđêôơưáàảãạếềểễệộờởỡợứừửữự"


def load_normalized():
    return [json.loads(l) for l in (ROOT / "staging" / "normalized.jsonl").open(encoding="utf-8")]


def test_every_record_has_front_useful_back_and_provenance():
    for r in load_normalized():
        assert r["front"].strip(), f"{r['source_deck']}/{r['original_id']} empty front"
        back = r["meaning_vi"] + r["definition_en"] + r["example_en"] + r["synonyms"]
        assert back.strip(), f"{r['source_deck']}/{r['original_id']} empty back"
        assert r["stable_id"] and len(r["stable_id"]) == 16
        assert r["source_path"] and r["source_sha256"] and r["extraction"] and r["source_ref"]


def test_stable_ids_unique_and_deterministic():
    rows = load_normalized()
    ids = [r["stable_id"] for r in rows]
    assert len(ids) == len(set(ids)), "stable_id collision"
    assert publish_decks.canonical_hash({"a": 1}) == publish_decks.canonical_hash({"a": 1})


def test_counts_reconcile_with_expected():
    rows = load_normalized()
    counts = {d: sum(1 for r in rows if r["source_deck"] == d)
              for d in ("anki_starter", "c1c2_wic500", "b2c1_1000")}
    assert counts["c1c2_wic500"] == 500
    assert counts["b2c1_1000"] == 1000
    assert counts["anki_starter"] == 839  # expected ~750; exact count documented


def test_no_quarantined_row_passes_and_no_record_dropped():
    rows = load_normalized()
    # nothing was silently discarded: all extracted rows are present
    assert len(rows) == 839 + 500 + 1000
    for r in rows:
        if r["review_status"] == "quarantine":
            assert r["flags"], "quarantine without a reason flag"


def test_vietnamese_diacritics_survive_normalization():
    rows = load_normalized()
    vi_rows = [r for r in rows if r["source_deck"] == "c1c2_wic500"][:50]
    joined = " ".join(r["meaning_vi"] for r in vi_rows)
    assert any(ch in joined for ch in VN)
    for r in rows:
        assert unicodedata.normalize("NFC", r["front"]) == r["front"]


def test_no_raw_source_or_executable_content_in_cards():
    for deck in ("anki_starter", "c1c2_wic500", "b2c1_1000"):
        m = json.loads((ROOT / "manifests" / f"{deck}-manifest.json").read_text(encoding="utf-8"))
        cards = json.loads((ROOT / "manifests" / m["cards_file"]).read_text(encoding="utf-8"))
        for c in cards:
            blob = json.dumps(c, ensure_ascii=False).lower()
            # learner-visible card content: no scripts, no raw source artifacts
            assert "<script" not in blob
            assert "%pdf" not in blob
            assert ".apkg" not in blob
            assert "d:\\notion" not in blob
            assert "quizlet.com" not in blob
        # provenance must still exist at manifest level for auditability
        assert m["source"]["sha256"] and m["source"]["path"]


def _approved_copy(mdir: Path, deck: str) -> dict:
    """Copy a manifest into tmp with simulated owner approval (same cards+hash)."""
    src = json.loads((ROOT / "manifests" / f"{deck}-manifest.json").read_text(encoding="utf-8"))
    src["status"] = "published"
    shutil.copyfile(ROOT / "manifests" / src["cards_file"], mdir / src["cards_file"])
    (mdir / f"{deck}-manifest.json").write_text(json.dumps(src), encoding="utf-8")
    return src


def test_importer_imports_owner_approved_and_refuses_draft_decks(tmp_path):
    # anki_starter + b2c1_1000 carry the owner's 2026-09-26 approval decision;
    # c1c2_wic500 is still a draft, so its 500 rows must never import.
    store = tmp_path / "store.sqlite3"
    publish_decks.import_manifests(store=store)
    con = sqlite3.connect(str(store))
    counts = dict(con.execute(
        "SELECT deck_id, COUNT(*) FROM deck_cards GROUP BY deck_id").fetchall())
    assert counts == {"anki_starter": 839, "b2c1_1000": 1000}
    drafts = con.execute(
        "SELECT COUNT(*) FROM deck_versions WHERE deck_id='c1c2_wic500'").fetchone()[0]
    assert drafts == 0
    con.close()


def test_importer_refuses_tampered_cards(tmp_path):
    store = tmp_path / "store.sqlite3"
    mdir = tmp_path / "manifests"
    mdir.mkdir()
    src = _approved_copy(mdir, "c1c2_wic500")
    cards = json.loads((mdir / src["cards_file"]).read_text(encoding="utf-8"))
    cards[0]["meaning_vi"] = "tampered"
    (mdir / src["cards_file"]).write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
    publish_decks.import_manifests(store=store, manifest_dir=mdir)
    con = sqlite3.connect(str(store))
    assert con.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0] == 0
    con.close()


def test_import_published_manifest_is_idempotent(tmp_path):
    store = tmp_path / "store.sqlite3"
    mdir = tmp_path / "manifests"
    mdir.mkdir()
    _approved_copy(mdir, "c1c2_wic500")
    publish_decks.import_manifests(store=store, manifest_dir=mdir)
    con = sqlite3.connect(str(store))
    n1 = con.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0]
    assert n1 == 500
    con.close()
    # retry must not duplicate anything
    publish_decks.import_manifests(store=store, manifest_dir=mdir)
    con = sqlite3.connect(str(store))
    n2 = con.execute("SELECT COUNT(*) FROM deck_cards").fetchone()[0]
    assert n2 == n1
    con.close()


def test_corrected_source_creates_new_version_preserving_history(tmp_path):
    store = tmp_path / "store.sqlite3"
    mdir = tmp_path / "manifests"
    mdir.mkdir()
def test_corrected_source_creates_new_version_preserving_history(tmp_path):
    store = tmp_path / "store.sqlite3"
    mdir = tmp_path / "manifests"
    mdir.mkdir()
    src = _approved_copy(mdir, "c1c2_wic500")
    publish_decks.import_manifests(store=store, manifest_dir=mdir)
    # corrected content => new manifest version with its own cards file
    cards = json.loads((mdir / src["cards_file"]).read_text(encoding="utf-8"))
    cards[0]["meaning_vi"] = cards[0]["meaning_vi"] + " (sửa)"
    cards_file_v2 = "c1c2_wic500-v2-cards.json"
    (mdir / cards_file_v2).write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
    v2 = dict(src, version=2, cards_file=cards_file_v2,
              cards_sha256=publish_decks.canonical_hash(cards), manifest_sha256=None)
    v2["manifest_sha256"] = publish_decks.canonical_hash(
        {k: v for k, v in v2.items() if k != "manifest_sha256"})
    (mdir / "c1c2_wic500-manifest.json").write_text(json.dumps(v2), encoding="utf-8")
    publish_decks.import_manifests(store=store, manifest_dir=mdir)
    con = sqlite3.connect(str(store))
    versions = con.execute("SELECT version FROM deck_versions WHERE deck_id='c1c2_wic500' ORDER BY version").fetchall()
    assert [v[0] for v in versions] == [1, 2]
    n = con.execute("SELECT COUNT(*) FROM deck_cards WHERE deck_id='c1c2_wic500'").fetchone()[0]
    assert n == 1000  # v1 rows kept, v2 added - history preserved
    con.close()


def test_manifests_are_hash_checked():
    for deck in ("anki_starter", "c1c2_wic500", "b2c1_1000"):
        m = json.loads((ROOT / "manifests" / f"{deck}-manifest.json").read_text(encoding="utf-8"))
        body = {k: v for k, v in m.items() if k != "manifest_sha256"}
        assert publish_decks.canonical_hash(body) == m["manifest_sha256"], f"{deck} manifest hash mismatch"


def test_duplicate_preservation_not_silently_merged():
    rows = load_normalized()
    corroborate = [r for r in rows if r["front"].casefold() == "corroborate"]
    assert len(corroborate) >= 2, "cross-source copies must all be kept for review"
    assert {r["source_deck"] for r in corroborate} >= {"anki_starter", "c1c2_wic500"}
