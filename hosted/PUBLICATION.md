# Curated Library publication (ticket 04)

The owner prepares a reviewed bundle outside this repository. `manifest.json`,
`presentations.json`, `answers.json`, and `assets/<revisionId>/<questionId>/<name>`
are the only inputs. The manifest has `version: 1`, a stable `releaseId`,
`kind: "curated"`, SHA-256 hashes of the two JSON files, and an `assets` array.
Each asset entry has `revisionId`, `questionId`, `name`, `sha256`, and `byteSize`.
The five package records in `presentations.json` use the exact source title and
revision set from the account learning spec. Each question carries an explicit
`reviewStatus` (`reviewed_text` or `image_fallback`) and a version 1 presentation.
`sourceQuestionId` records its identity in the owner-reviewed source;
`questionId` is the immutable published identity used by learner reads.
`answers.json` has one `{revisionId, questionId, acceptedAnswers}` row per
question. Asset blocks refer to `/content/<revisionId>/<questionId>/<name>`.
Only PNG, WebP, and JPEG question visuals are accepted. Raw PDF files, region
blocks, source paths, extra fields, missing answers, and unlisted visuals fail
validation. The importer never copies `answers.json` into web assets.

From `hosted/`, on an owner-controlled machine:

1. Run `npm run build` and `npx wrangler d1 migrations apply DB --remote` on a
   dedicated staging deployment. Review the bundle before continuing.
2. Run `python scripts/prepare-publication.py <bundle-directory> .publication/release`.
   Use an empty output directory. The command verifies hashes and completeness
   before it writes `publication.sql` and `assets/content/...`.
3. Copy `.publication/release/assets/content` into `dist/content`, then deploy
   the staging Worker. Confirm the new assets exist via the Worker route only;
   without a release entitlement, that route returns an unavailable response.
4. Execute `.publication/release/publication.sql` against the staging D1 using
   `wrangler d1 execute DB --remote --file <absolute-sql-path>`. The final SQL
   statement moves the single active release pointer after all rows have been
   inserted. Retry the same SQL after an interruption. Query
   `SELECT release_id FROM active_publication WHERE slot = 1` and verify it
   equals the intended release ID before treating publication as complete.
5. Sign in with a fresh Google Learner Account and inspect `/api/library`, a
   question in each section, and an Image Fallback visual. Inspect network
   responses for PDF bytes/URLs, original paths, and accepted answers. Test a
   second account and a direct, unentitled visual URL.

The SQL file includes the server-held answer key. Keep `.publication/` private;
it is ignored by Git and must never be placed under `dist/`. The release pointer
can be restored to a prior imported release without editing immutable question
or answer rows. Activation also records a release in the same database statement,
so previously active curated revisions remain readable while interrupted imports
stay invisible. Active Attempts must reference their revision ID when ticket 05
adds hosted Attempt storage. This ticket does not activate an unprovided bundle
or deploy production.
