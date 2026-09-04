# 14 — Add privacy-safe diagnostics and hardening

**What to build:** Local diagnostics and security hardening that make startup, import, loading, and calculator failures understandable without exposing questions, responses, secrets, or unrelated local resources.

**Blocked by:** 02 — Create and validate an Import Draft; 05 — Take and score one Practice Module; 10 — Gate Math on Desmos and Reference readiness.

**Status:** ready-for-agent

- [ ] Small rotating logs capture startup, import stage, loading stage, and error metadata without Source PDF content, answers, learner responses, or the Desmos key.
- [ ] Settings exposes Open Logs Folder without exposing arbitrary filesystem browsing through the web interface.
- [ ] Generated storage names and validated resolved paths prevent path traversal and accidental access outside Whitebook's data directory.
- [ ] PDF and CSV extension, magic/type, size, page-count, and parseability checks are enforced consistently.
- [ ] The local interface enforces loopback-only access, same-origin requests, the per-launch capability token, and a restrictive browser content policy.
- [ ] PDF actions, attachments, embedded scripts, external links, and unintended network loading cannot escape the visual rendering path.
- [ ] Error notifications remain actionable while redacting sensitive paths and values where they are not needed by the learner.
- [ ] Security tests cover unauthorized requests, cross-origin requests, traversal payloads, malformed uploads, input limits, content-policy violations, and log redaction.
- [ ] Diagnostic behavior remains local with no telemetry, crash uploads, or remote reporting.
