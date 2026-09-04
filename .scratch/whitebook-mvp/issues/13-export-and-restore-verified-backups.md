# 13 — Export and restore verified backups

**What to build:** A local backup workflow that exports all durable learning data into one portable archive and restores it only after complete compatibility and integrity validation.

**Blocked by:** 12 — Manage Library and History lifecycle.

**Status:** ready-for-agent

- [ ] Export produces one ZIP containing Test Packages, copied PDFs, Answer Manifests, Attempts, Results, and non-secret settings.
- [ ] The archive excludes the Desmos key, diagnostic logs, transient caches, and process-lock data.
- [ ] Backup metadata records a compatible format version and hashes every durable payload.
- [ ] Restore validates archive structure, compatibility, paths, and every hash before changing current data.
- [ ] A failed validation or interrupted restore leaves the current library unchanged.
- [ ] A successful restore applies database and files atomically enough to avoid mixed old/new state.
- [ ] Restored Test Packages retain immutable revisions and restored Attempts remain tied to the correct revision.
- [ ] The interface reports export location and clear restore success or failure without exposing private content in logs.
- [ ] Round-trip, corruption, traversal, incompatible-version, interrupted-restore, and secret-exclusion tests use the public Backup interface.
