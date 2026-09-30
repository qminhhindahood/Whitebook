# Secure Desmos setup for Whitebook

The current live Worker is `whitebook-hosted-staging`, serving `https://whitebook.docai.dpdns.org`, configured in `hosted/wrangler.jsonc`. The authenticated calculator-config route reads `DESMOS_API_KEY`; the owner has uploaded it and the live route now returns `configured: true`. The commands below are retained for future key replacement.

Run these commands yourself in PowerShell:

```powershell
Set-Location -LiteralPath 'D:\Notion\worktrees\whitebook-hosted-redesign\hosted'
npx --no-install wrangler whoami
npx --no-install wrangler secret put DESMOS_API_KEY --name whitebook-hosted-staging --config wrangler.jsonc
```

Confirm that `whoami` shows the intended Cloudflare account. If signed out, run `npx --no-install wrangler login` and complete Cloudflare sign-in, then repeat `whoami`.

Paste the registered Desmos key only into Wrangler's interactive secret prompt, then press Enter. Do not place its value in the command, chat, a tracked file, or Wrangler `vars`. The CLI command syntax was checked against this project's installed Wrangler.

**Activation:** `wrangler secret put` creates a new Worker version and immediately deploys it. This activates the binding on the live Worker; it does not build or upload the pending local UI edits. If activation should wait, use `npx --no-install wrangler versions secret put DESMOS_API_KEY --name whitebook-hosted-staging --config wrangler.jsonc` instead; it creates a version for later deployment. [Cloudflare's secret configuration documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

After activation:

1. Reload Whitebook while signed in; open a Math Attempt.
2. Confirm `/api/math/calculator-config` returns HTTP 200 and `configured: true`. Do not copy the full script URL into reports because it includes the client-visible Desmos API key.
3. Open Calculator and verify the Desmos graphing interface, an expression and graph, and preserved calculator state across save/reload/resume.
4. Check 1440×900 and 1366×768, then 390px and 320px widths. Confirm calculator controls, close button, question image, typed response, Reference Sheet, and footer remain reachable.
5. Start a disposable Section Exam; verify fullscreen and calculator readiness before timing starts. Save/exit, reload and resume the same Attempt, then finish both Modules.

The browser integration necessarily sends the Desmos API key to Desmos in the calculator script URL. Use the registered Desmos key for this site, never a Cloudflare credential or another provider's server secret.

The integration was checked against [Desmos API v1.12](https://www.desmos.com/api/v1.12/docs/index.html#document-calculator): it loads the keyed calculator script, constructs `GraphingCalculator` in a sized container, uses the default automatic resizing, and saves/restores the opaque calculator state with `getState()` / `setState()`. Registered keys are managed at [Desmos My API](https://www.desmos.com/my-api).

## Activation verified

The owner has uploaded the key. The live route returns `configured: true`. The bridge syntax repair and sandbox-frame CSP repair are deployed in version `f5e665d3-4006-4877-9fbb-32625de1556a`. Actual Desmos graphing, five readiness checks, desktop/mobile resizing and Reference Sheet loading passed live. Verification evidence and the limits of the read-only live check are recorded in `docs/practice-journey-verification.md`.
