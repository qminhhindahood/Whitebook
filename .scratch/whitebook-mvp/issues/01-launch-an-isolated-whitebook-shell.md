# 01 — Launch an isolated Whitebook shell

**What to build:** A one-action local launch experience that starts Whitebook, selects its own unused loopback port, prepares its private data store, opens the learner interface, and safely reuses an existing Whitebook instance without interfering with any other application.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] One root PowerShell launcher starts the FastAPI process and React/Vite interface and opens the Windows default browser.
- [ ] Whitebook binds only to `127.0.0.1` on an operating-system-assigned free port and rejects non-loopback and unauthorized requests.
- [ ] The first launch creates Whitebook's private runtime directories and a working SQLite database without exposing them through the static web interface.
- [ ] A per-launch capability token protects the localhost interface and is absent from logs and browser-visible page content.
- [ ] Launching while unrelated processes occupy ports leaves those processes untouched and starts Whitebook on a different port.
- [ ] Launching while a live Whitebook instance owns the data lock opens that instance instead of starting another.
- [ ] A stale lock is recovered only after its owning process is verified dead.
- [ ] The visible shell identifies itself as Whitebook and reports that the local application is ready.
- [ ] Automated tests exercise the launcher, port isolation, token enforcement, live-instance reuse, stale-lock recovery, and health interface through public seams.
