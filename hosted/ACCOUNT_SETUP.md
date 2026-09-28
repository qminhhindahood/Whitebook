# Ticket 03 staging account setup

Ticket 03 has its own staging Worker and D1 database. The Worker is named
`whitebook-hosted-staging` and its staging site is
`https://whitebook.docai.dpdns.org/dashboard`.
No production route or paid binding is configured. The ticket 02 staging Worker
and D1 database remain separate.

The D1 migration `0002_learner_accounts.sql` adds Google-subject keyed learner
accounts, one-use OAuth flows, and revocable hashed sessions. A Google OAuth
web client is required before live sign-in. Configure its exact authorized
redirect URI as:

`https://whitebook.docai.dpdns.org/api/auth/google/callback`

From `hosted/`, add these Worker secrets using Wrangler's interactive input.
Do not put the client secret, session tokens, or OAuth codes in source, shell
arguments, screenshots, or issue comments:

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OWNER_GOOGLE_SUB
```

`OWNER_GOOGLE_SUB` is optional for a staging deployment with no owner account.
If set, it must be the intended owner's stable Google `sub`, never their email.
Changing a learner's nickname or Google email does not grant owner access.
The `APP_ORIGIN` variable in `wrangler.jsonc` must match the browser origin and
registered redirect URI exactly. Wrangler secret changes deploy a new Worker
version immediately.

After secrets are present, test two different Google accounts in independent
browsers. The first should see an empty workspace, and the same Google account
on the second browser should return to the same account ID and saved nickname.
The other Google account should have a different account ID and empty nickname.
Check Renew session, Sign out, and a private API read after sign-out. Confirm
that cross-origin or missing-CSRF mutation requests are rejected. The local
`hosted/test/accounts.test.ts` suite covers those API paths with a deterministic
Google-provider seam and also checks JWT signature, issuer, audience, expiry,
and nonce using a separate RSA test key. It does not replace the live Google
browser journey.

Local checks:

```powershell
npm ci
npm test
npm run typecheck
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler deploy --dry-run
```

The hosted API returns `Cache-Control: private, no-store` for account responses.
The `/app` HTML is also non-cacheable and has a restrictive content security
policy. Sign-out deletes the D1 session, clears the session and CSRF cookies,
and requests clearing the browser cache. Personal history resources belong to
later tickets; ticket 03 starts with an empty account and a private nickname
to verify identity continuity and isolation.
