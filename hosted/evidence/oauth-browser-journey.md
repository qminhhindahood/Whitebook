# Ticket 03 Google sign-in browser journey

- Environment: ticket 03 staging Worker (`https://whitebook-ticket-03-staging.anothermiralph.workers.dev`)
- Run date: 2026-09-26
- Result: pass

## Journey

1. Open `/dashboard` while signed out. Whitebook shows the Google sign-in entry point (`oauth-sign-in.png`). The staging OAuth start endpoint redirected to Google with the configured client.
2. Complete Google sign-in and return to `/dashboard`. The Dashboard shows the learner welcome, empty study activity, and account controls. The capture also shows the successful “Session renewed.” status (`oauth-dashboard.png`).
3. Choose **Sign out**. Whitebook returns to its signed-out state and displays “Signed out of this browser.” (`oauth-signed-out.png`).

An initial authorization attempt expired with `invalid_login_state`; restarting sign-in from Whitebook created a fresh attempt and completed successfully.

The OAuth interaction and final signed-in/signed-out screenshots were completed in the staging browser. The browser automation profile restarted during the run, so the user supplied the two final-state screenshots. No OAuth codes, state values, cookies, or session tokens are recorded here. The Dashboard screenshot is retained as supplied and includes the account email shown by the staging UI.
