# 01 — Launch an isolated Whitebook shell

**What to build:** A one-action local launch experience that starts Whitebook, selects its own unused loopback port, prepares its private data store, opens the learner interface, and safely reuses an existing Whitebook instance without interfering with any other application.

**Blocked by:** None — can start immediately.

**Status:** completed

- [x] One root PowerShell launcher starts the FastAPI process and React/Vite interface and opens the Windows default browser.
- [x] Whitebook binds only to `127.0.0.1` on an operating-system-assigned free port and rejects non-loopback and unauthorized requests.
- [x] The first launch creates Whitebook's private runtime directories and a working SQLite database without exposing them through the static web interface.
- [x] A per-launch capability token protects the localhost interface and is absent from logs and browser-visible page content.
- [x] Launching while unrelated processes occupy ports leaves those processes untouched and starts Whitebook on a different port.
- [x] Launching while a live Whitebook instance owns the data lock opens that instance instead of starting another.
- [x] A stale lock is recovered only after its owning process is verified dead.
- [x] The visible shell identifies itself as Whitebook and reports that the local application is ready.
- [x] Automated tests exercise the launcher, port isolation, token enforcement, live-instance reuse, stale-lock recovery, and health interface through public seams.

## Comments

Implemented and verified on 2026-09-04.

- Automated gate: `uv run pytest -q` — 9 passed.
- Python quality: Ruff check and format check passed; `uv pip check` reported compatible packages.
- Browser quality: TypeScript check and Vite production build passed; npm reported zero vulnerabilities.
- Security coverage includes unauthorized, forged-host, cross-origin, occupied-port, stale-lock, live-lock, and hostile-proxy cases.
- The approved laptop shell is option 2 at `.impeccable/mocks/shell-option-2.png`; the verified render is `.impeccable/review/desktop.png`.
