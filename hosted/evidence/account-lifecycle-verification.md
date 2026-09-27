# Account lifecycle verification — 2026-09-27

Branch: `feat/hosted-account-lifecycle` from `origin/main` at `6db4723`.

| Check | Result |
| --- | --- |
| `cd hosted; npm test` | 16 files, 116 tests passed |
| `cd web; npm test` | 26 files, 141 tests passed |
| `cd hosted; npm run typecheck` | Passed |
| `cd web; npm run typecheck` | Passed |
| `cd hosted; npm run build` | Passed; owner-held reference sheet was staged locally, outside the commit |
| `cd hosted; python -m unittest test.test_recovery -v` | 3 tests passed after the build |
| `git diff --cached --check` | Passed |

The D1 integration test seeds two learners in every current account-owned table. It asserts the export contains only the requesting learner's data, excludes session/editor hashes and shared answer keys, and that deletion revokes both of that learner's sessions while the other learner and shared publication survive. A Worker error-path test checks that database exceptions are not returned or logged.

The recovery test creates a synthetic signed-in learner with a completed Attempt, a Study Note, and a protected publication visual. It exports a disposable local D1 using Wrangler, builds an age-encrypted archive through the backup path, checks daily freshness and retention, decrypts into another disposable local D1, and requests account, library, visual, Attempt, History, and note data through the restored Worker. No production database, credentials, or deployment were used.

One earlier full web run failed an existing PracticeArea timing assertion while questions were still loading. The isolated file passed, and the subsequent full web run passed all 141 tests.

Operational launch dependency: select and configure an owner-controlled daily runner, off-host encrypted storage, age key custody, SMTP alert destination, and a real monthly restore learner. The repository provides the commands and tests but has not activated a production schedule.
