# Ticket 16 release go/no-go for owner decision

**Verdict: NO-GO for production cutover.** This records evidence for the owner; it does not authorize or perform a launch.

## Evidence and decision

The staging bundle audit found 2,341 files, 262,822,186 total bytes, a largest file of 2,137,223 bytes, and no PDF files. The count uses 11.71% of the 20,000-file allowance (17,659 files remain). The largest asset uses 8.15% of the 25 MiB single-file allowance. Direct source PDF/answer paths, encoded traversal variants, anonymous attempt and visual routes, the deployment version host, and an invalid Host header were checked; the audit found no reachable PDF or answer fields. The active learner response and error checks also found no accepted answers or credentials. Details and probe results are in [ticket-16-asset-audit.json](ticket-16-asset-audit.json).

The 24-learner run is a release blocker: 2,160 of 4,618 requests returned generic 503 `service_unavailable`; only 3 of 23 created exams completed. Client p95/p99 latency was 7.46/7.48 seconds. No HTTP 1102 was observed, but Worker CPU percentiles were not captured. The indicative Free-plan projection is below the published daily limits, but it is not a verified capacity pass and omits retries and ordinary navigation. The Attempt screenshots also show clipped question content. The complete signed-in journey, including SAT dates, official scores, cards, guided review, notes, and plan generation, remains unverified. See [ticket-16-staging-journey.md](ticket-16-staging-journey.md).

## Backup and restore

Ticket 15 provides the encrypted daily D1 export, 30-daily/12-monthly retention, missed-export alert, and disposable local restore-drill tooling in `hosted/RECOVERY.md`. On 2026-09-27, `python -m unittest test.test_recovery -v` passed all 3 tests, including a synthetic encrypted export with manifest and asset hashes, local D1 import, and a signed-in Attempt plus Study Note journey. A restore from the latest real staging export was not run: no owner-controlled encrypted export/work directory and separate age identity were available or verified. The production backup runner, encryption key custody, alert destination, and live restore drill remain launch gates. The owner must complete this drill before launch.

The staging Free-plan configuration contains only the Worker, D1, and static assets; no paid fallback or paid overage was enabled. Current staging D1 size after cleanup is 3,338,240 bytes (0.67% of a 500,000,000-byte budget). Peak during the load run was 3,624,960 bytes. A retained daily growth rate was not established.

## Measured and projected Free-plan budget

Projection scenario: 100 learners per day completing two 67-minute Section Exams each (200 Attempts). For invocation estimates, use the observed 200.78 requests per created Attempt plus 89.33 heartbeats per 67-minute Attempt at the redesigned 45-second interval: approximately 58,023 daily invocations, leaving about 41,977 of 100,000 (41.98%).

For D1 rows, the latest rolling 24-hour Wrangler Insights snapshot (2026-09-27 12:12 UTC) reported 56,010 rows read and 344 written across 55 query patterns. Scale those totals by 200/23, conservatively attributing the entire rolling window to the 23 created Attempts, then add two reads and one write per projected heartbeat. This gives approximately 522,777 rows read (4,477,223 headroom of 5,000,000; 89.54%) and 20,858 rows written (79,142 headroom of 100,000; 79.14%). Insights is delayed and includes earlier rehearsal and other staging activity; this model is directional only. The 24-user exercise failed and did not measure 200 successful timed Attempts. Worker CPU allowance is 10 ms per invocation; 0 observed 1102 errors is insufficient to claim CPU headroom because CPU p95/p99 were not recorded.

The deployment asset count/size is comfortably below its measured caps. Storage is below its cap now, but no daily retention/growth rate has been measured. Therefore this projection cannot replace a successful post-fix concurrency exercise that records CPU, D1 usage, and retained database growth.

## Production values and outstanding owner gates

The owner's latest correction is that the domain is still the staging Workers host: `APP_ORIGIN=https://whitebook-ticket-03-staging.anothermiralph.workers.dev`. The previously supplied `https://whitebook.dev` is not verified as the current configured domain; confirm the production hostname and set its `APP_ORIGIN` explicitly during owner-approved cutover. No production callback, hostname, secrets, Worker, or D1 values were changed or read. Never put secret values in this document.

Before cutover, the owner must verify the production Google OAuth callback against the chosen hostname (`<APP_ORIGIN>/api/auth/google/callback`), set `OWNER_GOOGLE_SUB` and OAuth credentials in the secret store, confirm production Worker/D1 names and custom hostname/DNS/TLS, select the owner-operated backup runner and encrypted store/key custody/alert recipient, pass a live export restore drill, and approve cutover. Public sign-up remains closed.

## Rollback path

Before a production release, record the prior Worker Version ID and verify the backup is fresh. If the new Worker is unhealthy, roll its code/assets back with Wrangler using the production Worker name and saved prior version ID:

```powershell
wrangler rollback <previous-version-id> --name <production-worker-name> --yes
```

Wrangler's rollback command restores a Worker version; it does not roll back D1 data. Keep schema/data changes backward-compatible and use the documented recovery procedure for a separately approved D1 restore. This ticket did not deploy to production, run a production rollback, or authorize a cutover.

## Verification

On 2026-09-27, hosted tests passed (16 files, 116 tests) and the hosted TypeScript check passed. The web TypeScript check passed. The web suite's first run, executed alongside the other checks, had one calculator-readiness test fail while the UI was in the temporary read-only/takeover state; a standalone rerun passed all 26 files and 141 tests. The recovery suite passed all 3 tests, including its synthetic disposable restore drill. The load and audit scripts passed Node syntax checks, both evidence JSON files parse, and the per-file byte sum equals the recorded 262,822,186-byte total. This verification does not change the NO-GO staging result above.
