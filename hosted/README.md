# Ticket 02: protected staging question

This is a **staging-only** Worker and D1 fixture. It serves one synthetic, reviewed Question Presentation at `/api/staging/questions/v1/fixture-1` and one derived SVG at `/content/v1/fixture-1/triangle.svg`. The accepted answer is seeded in the separate `answer_keys` table and has no response route. The learner-facing build contains only `staging.html`, its JS/CSS, and that SVG; it does not contain the local authoring app or a Source PDF.

Every request runs the Worker first. Only `/staging`, its exact Vite assets, the session endpoint, the fixture endpoint, and the allowlisted visual path can return content. The visual path requires a short-lived HttpOnly, Secure, SameSite cookie backed by a hashed D1 session. The access code is a staging secret; it is never committed or embedded in the frontend. This is a test authorization path for ticket 02, not the Google Learner Account work in ticket 03.

## Local verification

From `hosted/`:

```powershell
npm ci
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler dev --local --port 8787 --var STAGING_ACCESS_CODE:local-test-code
```

In another terminal:

```powershell
$env:WHITEBOOK_STAGING_ACCESS_CODE = 'local-test-code'
npm run probe
```

Open `http://127.0.0.1:8787/staging` and enter the same local test code. `web/src/QuestionContent.tsx` and `AnswerChoices` render the fixture on desktop and narrow screens. The staging Vite alias removes the PDF renderer from this build; the local authoring build still uses it.

The probe checks direct, malformed, preview-style Host, alternate Host, and PDF paths without a session; confirms the answer key and Source PDF fields are absent from the API payload; verifies the visual hash; then sends simultaneous question and visual reads from 30 clients. It records Worker request count, protected visual requests, D1 `rows_read`/`rows_written` metadata, wall latency, asset count, and bytes. See [local probe results](evidence/local-probe.json). `requestCpuMs` is null because local workerd traces expose elapsed duration rather than Cloudflare's billed CPU time.

## Remote staging

The dedicated `whitebook-ticket-02-staging` D1 database was created in APAC and migrated. The Worker is deployed at [the staging URL](https://whitebook-ticket-02-staging.anothermiralph.workers.dev/staging). No production route or paid binding is configured. The high-entropy `STAGING_ACCESS_CODE` is a Worker secret; the local probe copy is in the ignored `hosted/.staging-access-code` file and is not in Git.

To repeat the remote probe from `hosted/`:

```powershell
$env:WHITEBOOK_STAGING_URL = 'https://whitebook-ticket-02-staging.anothermiralph.workers.dev'
$env:WHITEBOOK_STAGING_ACCESS_CODE = Get-Content -LiteralPath '.staging-access-code' -Raw
npm run probe
```

[Remote probe results](evidence/remote-probe.json) include the Cloudflare GraphQL Workers invocation CPU quantiles. The highest second-bucket p99 was 3.495 ms across 73 requests, with zero invocation errors; this is below the [10 ms Workers Free CPU limit](https://developers.cloudflare.com/workers/platform/limits/). Cloudflare reports CPU quantiles in microseconds. The version URL for each deployed version was also checked without authorization; the protected visual returned 404 on both. The remote browser control timed out, so the desktop and narrow visual checks remain the local screenshots in `evidence/`.

To redeploy, run `npm run build`, `npx wrangler d1 migrations apply DB --remote`, and `npx wrangler deploy` from this directory. `wrangler secret put` creates a new deployed version; reapply `STAGING_ACCESS_CODE` after rotating it. The APAC location is a placement hint, not a residency guarantee.

The probe compares the build with the current [Workers Free request, CPU, static file, and file-size limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 Free daily row limits](https://developers.cloudflare.com/d1/platform/pricing/). The recorded traffic is a small viability probe, not the whole-day load rehearsal in ticket 16. Static asset requests are protected by `run_worker_first`; Cloudflare documents that quota exhaustion returns 429 instead of exposing those assets through a fallback. [Static Assets behavior](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
