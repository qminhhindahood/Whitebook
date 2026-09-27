# Curated Library publication (ticket 04)

The five reviewed revisions are exported from the isolated migration copy described in
`docs/region-reference-reduction/region-migration-results.json` in the separate
region-reduction worktree. Its active source database was not modified. The revisions
are August R&W 7, September R&W 7, August Math 7, Hardest SAT Math Questions 12,
and September Math 6. They contain 1,152 questions, no PDF region blocks, and
2,272 visual references to 2,168 hash-checked PNGs. The export and prepared import
are private owner artifacts; neither belongs in `dist/` or Git.

## Prepare the private bundle

On an owner-controlled machine, from the repository root:

```powershell
python hosted/scripts/export-reviewed-copy.py <isolated-data-root> <region-migration-results.json> hosted/.publication/bundle
python hosted/scripts/prepare-publication.py hosted/.publication/bundle hosted/.publication/prepared
```

Use new, empty output directories. Both commands accept `--check-only` to validate
without writing output. The exporter opens `whitebook.sqlite3` read-only, checks
the five revision identities, question order, unchanged answer-row hashes, zero
regions, source audit, image links, dimensions, bytes, and SHA-256 values. It
exports only derived PNGs and learner presentation metadata to the bundle, with
accepted answers in a separate `answers.json`. The version 2 manifest binds the
presentation, answers, and review audit by SHA-256. The importer rechecks every
asset and the audit inventory before writing SQL and protected static assets.

`hosted/.publication/prepared/publication.sql` contains the answer key. Keep the
entire `.publication/` directory private. Never copy the bundle JSON or SQL into
`dist/`; copy only `prepared/assets/content/*` to `dist/content/` after a build.

## Activate in staging

1. From `hosted/`, run `npm run build` and `npx wrangler d1 migrations apply DB
   --remote` against a dedicated staging Worker/D1.
2. Copy `prepared/assets/content/*` into `dist/content/`, then deploy the staging
   Worker. Confirm an unentitled direct content URL is unavailable.
3. Execute the prepared SQL in staging with `wrangler d1 execute DB --remote
   --file <absolute-publication-sql-path>`.
4. Query `SELECT release_id FROM active_publication WHERE slot = 1`. It must be
   `reviewed-five-20260927`. Sign in with a fresh Google Learner Account and
   inspect all five library entries, Reading and Writing text, Math typeset
   choices, and Image Fallback visuals. Check responses for PDF URLs/bytes,
   source paths, and accepted answers. Check a second account and an unentitled
   visual URL.

The SQL inserts immutable rows with `INSERT OR IGNORE`, then moves the single
active pointer in its final guarded statement. An interrupted import leaves the
previous active release visible. Retrying the same SQL is safe; a conflicting
revision or answer row fails the final guard and cannot activate. Prior revision
rows remain readable for references from Attempts. The importer does not edit the
active source database.

## Local verification on 2026-09-27

The real bundle exported and imported into a disposable local D1 copy. The copy
had five revisions, 1,152 questions, 1,152 answer rows, and 2,272 protected
visual paths. A local authenticated LearnerSession browsed the five revisions and
opened representative August R&W Image Fallback, September R&W selectable text,
and Math image and KaTeX questions. A second local account listed the same five
revisions. Direct requests returned 401 for an anonymous visual, 404 for an
unlisted visual and a raw static path, and 200 for a listed, entitled visual.
This is a local browser check; it does not replace staging Google OAuth
verification or deploy production.
