"""Build the Flashcard preview site (reports/preview.html) from staged rows.

Usage: .venv/Scripts/python.exe scripts/make_preview_site.py

One self-contained HTML file (no network, no backend):
- Library view styled after the owner's reference: pastel set cards in a
  responsive grid, 50 words per section (last set of a deck may be smaller),
  search, pagination, and a local "Ôn hôm nay" banner.
- Study view: front (word + tap-to-flip hint) / back (word, POS, IPA with
  browser speech synthesis, Vietnamese meaning, English definition, synonym
  chips, example box with the word highlighted), "Không chắc / Thuộc"
  ratings stored in localStorage (+1 / +4 days due), progress bar,
  keyboard navigation.
All content comes from staging/normalized.jsonl; the page is a local draft
preview, not learner-facing state.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "reports" / "preview.html"
SET_SIZE = 50

DECKS = [
    ("anki_starter", "SAT Starter"),
    ("c1c2_wic500", "C1-C2"),
    ("b2c1_1000", "B2-C1"),
]

PASTELS = [
    ("#f3f0fb", "#e9e4f8"),  # violet
    ("#e8f6f1", "#d9efe6"),  # teal
    ("#e9f2fd", "#dbe9fa"),  # blue
    ("#fdeef1", "#f9dee4"),  # pink
    ("#fdf6e7", "#faedd2"),  # amber
    ("#eef7ec", "#dff0dc"),  # green
]


def build_sections() -> list[dict]:
    rows = [json.loads(l) for l in (ROOT / "staging" / "normalized.jsonl").open(encoding="utf-8")]
    sections = []
    for deck, label in DECKS:
        recs = [r for r in rows if r["source_deck"] == deck]
        for i in range(0, len(recs), SET_SIZE):
            chunk = recs[i:i + SET_SIZE]
            n = i // SET_SIZE + 1
            cards = [{
                "id": r["stable_id"],
                "front": r["front"],
                "pos": r["part_of_speech"],
                "ipa": r["ipa"],
                "vi": r["meaning_vi"],
                "en": r["definition_en"],
                "ex": r["example_en"],
                "exvi": r["example_vi"],
                "syn": [s.strip() for s in r["synonyms"].split(",") if s.strip()] or
                       [s.strip() for s in r["synonyms"].split(";") if s.strip()],
                "cefr": r["cefr"],
                "ref": r["source_ref"],
            } for r in chunk]
            sections.append({
                "key": f"{deck}-set{n:02d}",
                "title": f"Flashcard {label} Set {n:02d}",
                "deck": deck,
                "count": len(cards),
                "cards": cards,
            })
    return sections


def esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace("'", "\\'").replace("</", "<\\/")


PAGE = """<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flashcard — Starter Deck preview</title>
<style>
  :root {
    --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --bg:#f7f7f8;
    --indigo:#4f46e5; --indigo-soft:#eef2ff; --amber:#b45309; --green:#15803d;
  }
  * { box-sizing:border-box; }
  html, body { margin:0; }
  body { font:15px/1.55 Inter, "Segoe UI", system-ui, -apple-system, sans-serif; color:var(--ink); background:var(--bg); }
  button { font:inherit; cursor:pointer; }

  /* ---------- library ---------- */
  .lib-header { background:#f1f1f3; border-bottom:1px solid var(--line); padding:14px 22px; font-weight:600; }
  .wrap { max-width:1400px; margin:0 auto; padding:18px 22px 60px; }
  .banner { display:flex; align-items:center; gap:18px; background:#eceafd; border:1px solid #dcd6f8;
            border-radius:14px; padding:16px 20px; margin-bottom:18px; }
  .banner .t { color:var(--indigo); font-weight:700; margin-bottom:3px; }
  .banner .d { color:#4b5563; font-size:14px; }
  .banner .spacer { flex:1; }
  .btn-primary { background:var(--indigo); color:#fff; border:none; border-radius:999px; padding:9px 18px; font-weight:600; }
  .btn-primary:disabled { opacity:.45; cursor:default; }
  .search { display:flex; gap:0; margin-bottom:20px; max-width:420px; }
  .search input { flex:1; border:1px solid var(--line); border-right:none; border-radius:10px 0 0 10px;
                  padding:9px 14px; font:inherit; background:#fff; outline:none; }
  .search button { border:1px solid var(--line); border-left:none; background:#fff; border-radius:0 10px 10px 0;
                   padding:9px 14px; color:#dc2626; font-weight:600; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
  @media (max-width:1100px){ .grid { grid-template-columns:repeat(2,1fr);} }
  @media (max-width:640px){ .grid { grid-template-columns:1fr;} .wrap{padding:14px 12px 50px;} }
  .set { position:relative; border:1px solid #eef0f3; border-radius:12px; padding:18px 18px 30px; cursor:pointer;
         transition:transform .08s ease, box-shadow .12s ease; overflow:hidden; text-align:left; }
  .set:hover { transform:translateY(-2px); box-shadow:0 6px 18px rgba(17,24,39,.08); }
  .set .title { font-weight:700; font-size:16px; margin-bottom:26px; }
  .set .chip { display:inline-block; background:rgba(255,255,255,.85); border-radius:6px; padding:2px 10px;
               font-size:13px; color:#374151; }
  .set .deco { position:absolute; right:10px; bottom:8px; opacity:.75; }
  .pager { display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:22px;
           color:#4b5563; font-size:13px; }
  .pager button { border:none; background:transparent; color:#9ca3af; font-size:16px; padding:2px 6px; }
  .pager button.cur { color:#dc2626; border:1px solid #f3c1c6; border-radius:8px; background:#fff; }
  .pager button:disabled { opacity:.35; }
  .empty { color:var(--muted); padding:30px 4px; }

  /* ---------- study ---------- */
  #study { display:none; min-height:100vh; background:var(--bg); }
  .study-top { display:flex; align-items:center; gap:10px; background:#fff; border-bottom:1px solid var(--line);
               padding:10px 18px; position:sticky; top:0; z-index:5; }
  .study-top .brand { font-weight:700; }
  .study-top .crumb { color:var(--muted); font-size:14px; }
  .study-top .spacer { flex:1; }
  .btn-exit { display:flex; align-items:center; gap:6px; border:1px solid var(--line); background:#fff;
              border-radius:999px; padding:6px 14px; }
  .stage { display:flex; flex-direction:column; align-items:center; padding:22px 14px 90px; }
  .count-pill { background:#fff; border:1px solid var(--line); border-radius:999px; padding:5px 14px;
                font-size:13px; color:#374151; margin-bottom:18px; }
  .card-zone { display:flex; align-items:center; gap:14px; width:100%; max-width:860px; justify-content:center; }
  .arrow { width:40px; height:40px; border-radius:50%; border:1px solid var(--line); background:#fff;
           color:#6b7280; font-size:16px; flex:none; }
  .card3d { background:#fff; border-radius:18px; box-shadow:0 10px 30px rgba(17,24,39,.10);
            width:min(560px, 92vw); min-height:340px; padding:30px 34px; cursor:pointer;
            display:flex; flex-direction:column; }
  .face-front { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; }
  .word-xl { font-size:clamp(28px, 5vw, 44px); font-weight:800; text-align:center; }
  .hint { color:#9ca3af; font-size:14px; display:flex; gap:6px; align-items:center; }
  .face-back { flex:1; }
  .word-row { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .word-lg { font-size:30px; font-weight:800; }
  .pos { color:var(--muted); font-style:italic; }
  .ipa-row { display:flex; align-items:center; gap:10px; margin:8px 0 18px; color:#374151; }
  .speak { width:34px; height:34px; border-radius:50%; border:none; background:#eef2ff; color:var(--indigo);
           display:flex; align-items:center; justify-content:center; font-size:15px; }
  .vi-mean { font-weight:700; font-size:18px; margin-bottom:4px; }
  .en-mean { color:var(--muted); margin-bottom:16px; }
  .sec-label { font-size:11px; letter-spacing:.08em; color:#9ca3af; font-weight:700; margin:12px 0 8px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip2 { background:#f3f4f6; border-radius:999px; padding:5px 14px; font-size:14px; color:#374151; }
  .exbox { background:#eef2ff; border-radius:12px; padding:14px 16px; margin-top:16px; }
  .exbox .lab { color:var(--indigo); font-size:11px; font-weight:700; letter-spacing:.08em; margin-bottom:6px; }
  .exbox .tx { color:#374151; }
  .exbox .tx b { color:var(--indigo); }
  .ratings { display:flex; gap:16px; margin-top:22px; width:min(560px,92vw); }
  .rate { flex:1; background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px; text-align:center; }
  .rate .a { font-weight:700; margin-bottom:2px; }
  .rate .b { color:#9ca3af; font-size:12.5px; }
  .rate.amber .a { color:var(--amber); } .rate.green .a { color:var(--green); }
  .progress { position:fixed; left:50%; transform:translateX(-50%); bottom:56px; width:min(560px,90vw);
              height:6px; background:#e5e7eb; border-radius:999px; }
  .progress i { display:block; height:100%; background:var(--indigo); border-radius:999px; transition:width .2s; }
  .study-bottom { position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:1px solid var(--line);
                  display:flex; align-items:center; padding:10px 18px; gap:10px; }
  .study-bottom .u { font-weight:600; font-size:14px; }
  .study-bottom .m { color:#9ca3af; font-size:12.5px; }
  .study-bottom .spacer { flex:1; }
  .btn-ghost { border:1px solid var(--line); background:#fff; border-radius:10px; padding:8px 18px; }
  .done { text-align:center; padding:60px 20px; }
  .done h2 { margin:0 0 8px; }
  .done p { color:var(--muted); margin:0 0 20px; }
</style>
</head>
<body>

<div id="library">
  <div class="lib-header">Flashcard</div>
  <div class="wrap">
    <div class="banner">
      <div>
        <div class="t">Ôn hôm nay</div>
        <div class="d" id="due-text">Chưa có từ nào đến hạn — chọn một bộ để học.</div>
      </div>
      <div class="spacer"></div>
      <button class="btn-primary" id="btn-due" disabled>Bắt đầu ôn</button>
    </div>
    <div class="search">
      <input id="q" placeholder="Nhập từ khóa..." aria-label="Tìm kiếm">
      <button id="btn-search">Tìm kiếm</button>
    </div>
    <div class="grid" id="grid"></div>
    <div class="pager" id="pager"></div>
  </div>
</div>

<div id="study">
  <div class="study-top">
    <span class="brand">Flashcard</span>
    <span class="crumb" id="crumb">Ôn hôm nay</span>
    <span class="spacer"></span>
    <button class="btn-exit" id="btn-exit">⟲ Thoát</button>
  </div>
  <div class="stage">
    <div class="count-pill" id="count-pill"></div>
    <div class="card-zone">
      <button class="arrow" id="prev" aria-label="Thẻ trước">‹</button>
      <div class="card3d" id="card"></div>
      <button class="arrow" id="next" aria-label="Thẻ sau">›</button>
    </div>
    <div class="ratings" id="ratings" style="display:none">
      <button class="rate amber" id="rate-again"><div class="a">Không chắc</div><div class="b">ôn lại sau 1 ngày</div></button>
      <button class="rate green" id="rate-good"><div class="a">Thuộc</div><div class="b">ôn lại sau 4 ngày</div></button>
    </div>
  </div>
  <div class="progress"><i id="bar" style="width:0%"></i></div>
  <div class="study-bottom">
    <div><div class="u">Starter Deck preview</div><div class="m">bản nháp local — chưa phát hành</div></div>
    <span class="spacer"></span>
    <button class="btn-ghost" id="btn-prev">Trước</button>
    <button class="btn-primary" id="btn-next">Tiếp</button>
  </div>
</div>

<script>
const SECTIONS = __SECTIONS__;

/* ---------- library ---------- */
const PASTELS = [
  ['#f3f0fb', '#e9e4f8'], ['#e8f6f1', '#d9efe6'], ['#e9f2fd', '#dbe9fa'],
  ['#fdeef1', '#f9dee4'], ['#fdf6e7', '#faedd2'], ['#eef7ec', '#dff0dc']
];
const PAGE_SIZE = 24;
let filtered = SECTIONS.slice(), page = 0;
const grid = document.getElementById('grid'), pager = document.getElementById('pager');
const DECO = ['🎧','📐','🌈','📕','🧩','✏️'];

function dueMap() { try { return JSON.parse(localStorage.getItem('wb-vocab-due') || '{}'); } catch { return {}; } }
function saveDue(m) { localStorage.setItem('wb-vocab-due', JSON.stringify(m)); }
function dueToday() {
  const today = new Date().toISOString().slice(0, 10);
  const m = dueMap();
  return SECTIONS.flatMap(s => s.cards).filter(c => m[c.id] && m[c.id] <= today);
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(page, pages - 1);
  const lo = filtered.length ? page * PAGE_SIZE + 1 : 0;
  const hi = Math.min(filtered.length, (page + 1) * PAGE_SIZE);
  let html = `<span>${lo}-${hi} trong tổng số ${filtered.length} kết quả</span>`;
  html += `<button ${page === 0 ? 'disabled' : ''} data-p="${page-1}">‹</button>`;
  for (let i = 0; i < pages; i++)
    html += `<button class="${i === page ? 'cur' : ''}" data-p="${i}">${i+1}</button>`;
  html += `<button ${page >= pages-1 ? 'disabled' : ''} data-p="${page+1}">›</button>`;
  pager.innerHTML = html;
  pager.querySelectorAll('button[data-p]').forEach(b =>
    b.onclick = () => { page = +b.dataset.p; renderGrid(); });
}

function renderGrid() {
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  grid.innerHTML = slice.length ? '' : '<div class="empty">Không có bộ nào khớp từ khóa.</div>';
  for (const s of slice) {
    const c = PASTELS[SECTIONS.indexOf(s) % PASTELS.length];
    const b = document.createElement('button');
    b.className = 'set';
    b.style.background = `linear-gradient(135deg, ${c[0]}, ${c[1]})`;
    b.innerHTML = `<div class="title">${s.title}</div><span class="chip">${s.count} terms</span>`
                + `<span class="deco">${DECO[SECTIONS.indexOf(s) % DECO.length]}</span>`;
    b.onclick = () => startSession([s], s.title);
    grid.appendChild(b);
  }
  renderPager();
}

function refreshBanner() {
  const due = dueToday();
  document.getElementById('due-text').textContent = due.length
    ? `${due.length} từ đến hạn — nhấn "Bắt đầu ôn" để ôn theo lịch.` 
    : 'Chưa có từ nào đến hạn — chọn một bộ để học.';
  const btn = document.getElementById('btn-due');
  btn.disabled = !due.length;
  btn.onclick = () => startSession(dueToday(), 'Ôn hôm nay');
}

function doSearch() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  filtered = !q ? SECTIONS.slice()
    : SECTIONS.filter(s => s.title.toLowerCase().includes(q)
        || s.cards.some(c => c.front.toLowerCase().includes(q) || (c.vi || '').toLowerCase().includes(q)));
  page = 0;
  renderGrid();
}
document.getElementById('btn-search').onclick = doSearch;
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

/* ---------- study ---------- */
let session = null; // { title, cards, idx, flipped }
const $card = document.getElementById('card'), $ratings = document.getElementById('ratings');

function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function hi(example, word) {
  if (!example) return '';
  const w = word.trim();
  const re = new RegExp('\\\\b' + w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\w*', 'i');
  return esc(example).replace(re, m => '<b>' + m + '</b>');
}

function renderCard() {
  const c = session.cards[session.idx];
  document.getElementById('count-pill').textContent = `${session.title} · thẻ ${session.idx+1} / ${session.cards.length}`;
  document.getElementById('crumb').textContent = session.title;
  document.getElementById('bar').style.width = (session.idx / session.cards.length * 100) + '%';
  if (!session.flipped) {
    $ratings.style.display = 'none';
    $card.innerHTML = `<div class="face-front"><div class="word-xl">${esc(c.front)}</div>
      <div class="hint">⟳ Nhấn để xem nghĩa</div></div>`;
  } else {
    $ratings.style.display = 'flex';
    const syn = (c.syn || []).slice(0, 4).map(s => `<span class="chip2">${esc(s)}</span>`).join('');
    $card.innerHTML = `<div class="face-back">
      <div class="word-row"><span class="word-lg">${esc(c.front)}</span>
        ${c.pos ? `<span class="pos">${esc(c.pos)}.</span>` : ''}</div>
      <div class="ipa-row"><span>${esc(c.ipa)}</span>
        <button class="speak" title="Đọc từ">🔊</button></div>
      ${c.vi ? `<div class="vi-mean">${esc(c.vi)}</div>` : ''}
      ${c.en ? `<div class="en-mean">${esc(c.en)}</div>` : ''}
      ${syn ? `<div class="sec-label">ĐỒNG NGHĨA</div><div class="chips">${syn}</div>` : ''}
      ${c.ex ? `<div class="exbox"><div class="lab">VÍ DỤ TRONG NGỮ CẢNH</div>
        <div class="tx">${hi(c.ex, c.front)}</div>
        ${c.exvi ? `<div class="tx" style="margin-top:6px;color:#6b7280">${esc(c.exvi)}</div>` : ''}</div>` : ''}
    </div>`;
    $card.querySelector('.speak').onclick = (e) => {
      e.stopPropagation();
      try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(c.front);
            u.lang = 'en-US'; speechSynthesis.speak(u); } catch {}
    };
  }
  document.getElementById('btn-prev').disabled = session.idx === 0;
  document.getElementById('prev').disabled = session.idx === 0;
}

function flip() { session.flipped = !session.flipped; renderCard(); }
function go(delta) {
  const next = session.idx + delta;
  if (next < 0) return;
  if (next >= session.cards.length) { endSession(); return; }
  session.idx = next; session.flipped = false; renderCard();
}
function rate(kind) {
  const c = session.cards[session.idx];
  const m = dueMap();
  const d = new Date();
  d.setDate(d.getDate() + (kind === 'again' ? 1 : 4));
  m[c.id] = d.toISOString().slice(0, 10);
  saveDue(m);
  go(1);
}
function endSession() {
  refreshBanner();
  document.getElementById('library').style.display = 'block';
  document.getElementById('study').style.display = 'none';
  location.hash = '';
}
function startSession(cards, title) {
  session = { title, cards: cards.slice(), idx: 0, flipped: false };
  document.getElementById('library').style.display = 'none';
  document.getElementById('study').style.display = 'block';
  renderCard();
  window.scrollTo(0, 0);
}
document.getElementById('card').onclick = flip;
document.getElementById('prev').onclick = () => go(-1);
document.getElementById('next').onclick = () => go(1);
document.getElementById('btn-prev').onclick = () => go(-1);
document.getElementById('btn-next').onclick = () => session.flipped ? go(1) : flip();
document.getElementById('rate-again').onclick = () => rate('again');
document.getElementById('rate-good').onclick = () => rate('good');
document.getElementById('btn-exit').onclick = endSession;
document.addEventListener('keydown', e => {
  if (document.getElementById('study').style.display !== 'block') return;
  if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === ' ') { e.preventDefault(); flip(); }
});

renderGrid();
refreshBanner();
</script>
</body>
</html>
"""

def main() -> int:
    sections = build_sections()
    page = PAGE.replace("__SECTIONS__", json.dumps(sections, ensure_ascii=False))
    OUT.write_text(page, encoding="utf-8")
    total = sum(s["count"] for s in sections)
    print(f"{len(sections)} sections / {total} cards -> {OUT}")
    for s in sections[:4]:
        print(f"  {s['title']}: {s['count']} terms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
