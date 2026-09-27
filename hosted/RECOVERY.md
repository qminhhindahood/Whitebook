# Account data and hosted recovery

## Learner account export

`GET /api/account/export` requires the current `__Host-wb_session` cookie. It downloads a private, uncached UTF-8 JSON file. The server takes the account ID from the session, never from a URL or request body. `POST /api/account/delete` requires the same session, same-origin `Origin`, CSRF header, `Content-Type: application/json`, and the exact body `{"confirmation":"DELETE MY ACCOUNT"}`. It removes all account-owned rows in one D1 batch, revokes every device session, clears browser cookies, and returns 204. Shared publication and Starter Deck content remains.

The export is a portable snapshot, **not** a database import or a way to resume a live editor lease. `schemaVersion: 1` fixes the shape below. The JSON contains:

```json
{
  "format": "whitebook-account-export",
  "schemaVersion": 1,
  "exportedAt": "2026-09-27T00:00:00.000Z",
  "account": {
    "id": "account-uuid",
    "provider": "google",
    "provider_subject": "stable-google-subject",
    "email": "learner@example.test",
    "display_name": "Learner",
    "nickname": "",
    "time_zone": "Asia/Bangkok",
    "created_at": 1780000000
  },
  "data": {
    "privateRevisionEntitlements": [],
    "satDates": [],
    "officialSatResults": [],
    "personalCards": [],
    "cardRatings": [],
    "starterCardRatings": [],
    "attempts": [],
    "guidedReviews": [],
    "studyNotes": [],
    "planVersions": [],
    "planTasks": [],
    "planTaskEvents": []
  }
}
```

Each array has objects with the allowlisted database field names from `src/accountData.ts`; all arrays are present even when empty. IDs retain relationships across arrays: `attempt_id`, `card_id`, `version_id`, and `task_id`. Dates ending in `_at` are Unix seconds for account/card/score records or Unix milliseconds for Attempt/review/plan records, as named; SAT and schedule dates are `YYYY-MM-DD`. Boolean database flags are numeric 0 or 1. Embedded JSON columns become objects or arrays: Attempt `config`, `questions`, `state`, `result`; plan `settings`, `source`, `action`, and `event`. Nullable values stay JSON `null`. Attempt `state` includes saved responses, and a completed `result` can contain accepted answers, so store the download privately. Session hashes, CSRF hashes, OAuth flows, editor lease hashes, and shared answer-key tables are excluded. A later export version must add a new explicit allowlist entry for each new account-owned table.

| Array | Object fields |
| --- | --- |
| `privateRevisionEntitlements` | `revision_id` |
| `satDates` | `test_date`, `is_primary`, `selected_at` |
| `officialSatResults` | `id`, `administration_date`, `total_score`, `reading_writing_score`, `math_score`, eight `band_*` fields, `created_at`, `updated_at` |
| `personalCards` | `id`, `deck`, `front`, `definition`, `vietnamese`, `part_of_speech`, `pronunciation`, `synonyms`, `example`, `archived_at`, `created_at`, `updated_at` |
| `cardRatings` | `id`, `card_id`, `rating`, `rating_zone`, `next_due`, `rated_at` |
| `starterCardRatings` | `id`, `deck_id`, `stable_id`, `rating`, `rating_zone`, `next_due`, `rated_at` |
| `attempts` | `id`, `revision_id`, `kind`, `status`, `config`, `questions`, `state`, `state_version`, `created_at_ms`, `started_at_ms`, `deadline_at_ms`, `completed_at_ms`, `result`, `answers_exposed_at_ms` |
| `guidedReviews` | `id`, `attempt_id`, `revision_id`, `question_id`, `prior_answer_exposure`, `retry_response`, `hint_used`, `revealed_at_ms`, `mistake_label`, `created_at_ms`, `updated_at_ms` |
| `studyNotes` | `id`, `revision_id`, `question_id`, `body`, `created_at_ms`, `updated_at_ms` |
| `planVersions` | `id`, `version`, `primary_date`, `settings`, `source`, `created_at_ms` |
| `planTasks` | `id`, `version_id`, `scheduled_date`, `kind`, `title`, `estimated_minutes`, `action`, `evidence_count`, `tentative`, `explanation`, `status`, `revision`, `updated_at_ms` |
| `planTaskEvents` | `id`, `version_id`, `task_id`, `event`, `created_at_ms` |

## Daily owner backup

Run this on an owner-controlled machine with local `python`, `age`, Node/npm, `hosted/node_modules` (`npm ci`), Wrangler authentication, and an encrypted local disk. The backup store must be outside Cloudflare and outside the repository; the temporary work directory must be on the encrypted owner disk and separate from the store. The private age identity and any future personal-key encryption secret belong in **separate** key storage, never in the archive, repo, or backup store. Keep an immutable copy of **every** publication bundle still recorded in `publication_releases`, at `<bundles>/<release-id>/manifest.json` with its associated JSON and `assets/` files. This includes earlier releases referenced by Attempts. The tool checks each manifest hash and every published asset hash against the SQL snapshot before encryption.

From `hosted/`, with a Wrangler config that binds the intended production D1:

```powershell
python scripts/recovery.py backup --database <production-d1-name> `
  --config <absolute-production-wrangler-config> `
  --bundles <absolute-owner-publication-archive> `
  --store <absolute-owner-encrypted-backup-store> `
  --work-dir <absolute-owner-encrypted-temporary-directory> `
  --recipient <age-public-recipient>
```

The command exports the **complete** remote D1 as SQL with `wrangler d1 export --remote`, checks SQL importability and publication consistency, encrypts SQL plus matching bundles into one `.age` archive, and removes plaintext temporary files. It keeps the newest 30 daily archives in `daily/` and one encrypted snapshot per month for the newest 12 months in `monthly/`. The monthly copy is made from that month's first successful daily export. No remote write or Worker deployment occurs.

Schedule `backup` at least every 24 hours on the selected owner runner. Schedule this independent freshness check more often than daily (for example every six hours):

```powershell
python scripts/recovery.py check --store <absolute-owner-encrypted-backup-store> --max-age-hours 25
```

An absent or stale daily archive exits 2. Set `WHITEBOOK_ALERT_SMTP_HOST`, `WHITEBOOK_ALERT_FROM`, and `WHITEBOOK_ALERT_TO` on the owner runner for an email alert on export or freshness failure. Optional `WHITEBOOK_ALERT_SMTP_PORT` defaults to 465; `WHITEBOOK_ALERT_SMTP_USER` and `WHITEBOOK_ALERT_SMTP_PASSWORD` enable SMTP authentication. Keep credentials in the runner's secret store. The runner must also alert on a missed scheduled **check** invocation, since a powered-off machine cannot send its own email. Keep a private daily completion record and investigate any failed run before sign-up continues. The runner machine and notification destination remain an operational launch dependency until selected and exercised.

## Disposable restore drill

Run before sign-up and monthly. Choose an encrypted archive and a test learner in it with a completed Attempt and Study Note. Build the hosted frontend first (`npm run build`; the owner reference sheet is needed). Provide the private age identity from separate key storage:

```powershell
python scripts/recovery.py restore-drill --archive <absolute-daily-or-monthly-age-file> `
  --identity <absolute-age-private-identity> `
  --work-dir <absolute-owner-encrypted-temporary-directory> `
  --account-id <test-learner-account-id>
```

The script verifies the archive and all retained publication bundles, stages their derived visuals in disposable static assets, writes a temporary Wrangler config with a synthetic D1 ID, imports SQL with `wrangler d1 execute --local --persist-to`, inserts one temporary local session, and starts `wrangler dev --local` on loopback. It checks `/api/account/me`, `/api/library`, a protected publication visual, `/api/attempts`, the completed Attempt's History review, and a Study Note through `/api/account/export`. It then stops the local Worker and removes the disposable state. Record archive timestamp, release IDs, learner test ID, command result, and date in the private recovery log; never record responses, answers, tokens, keys, or archive contents. A failed drill blocks launch until resolved. It never points at production D1.

For a recent incident, [D1 Free Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) offers a seven-day window, but restoring it overwrites the target database. Use it only through an incident decision. [Cloudflare's D1 export/import commands](https://developers.cloudflare.com/d1/best-practices/import-export-data/) support the SQL archive and disposable local import used here. During release rollback, Worker code/assets and D1 state are separate; do not assume rolling back code rolls back data.
