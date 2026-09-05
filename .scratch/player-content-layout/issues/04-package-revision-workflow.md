# 04 — Publish revised mappings for an existing Test Package

**What to build:** An existing package can receive converted content through a supported revision workflow. Original packages, accepted answers, and historical Attempts remain intact.

**Blocked by:** 1.

**Owner:** Bank/backend agent.

**Status:** resolved

- [x] `POST /api/test-packages/{id}/revision` opens an editable revision draft carrying the package's own Source PDF, Answer CSV, and answer manifest (`PackageAuthoring.start_package_revision`); the Library card exposes it as "Revise content".
- [x] Publishing a revision draft resolves the family from the revised package, increments to the next revision, and no longer collides with `UNIQUE(pdf_sha256, csv_sha256)` — the constraint was removed via the schema v3 migration in `storage.migrate_database`.
- [x] Revisions must keep the package's Source PDF and Answer CSV (`revision_mismatch` guard); accepted answers are copied from the manifest and grading is unchanged.
- [x] Presentations are accepted for Math multiple-choice, Reading and Writing multiple-choice, and student-produced responses with per-type validation (`question_presentation.py`, `set_question_presentation`).
- [x] The original package keeps its revision, content, and attempts; deleting a package removes its revision drafts.
- Tests: `tests/test_package_revision_api.py` (revision publish, gate, 404, delete cleanup; answers untouched; both revisions coexist). The live scratch instance republished fixtures as revisions 2 and 3 through this exact workflow.
