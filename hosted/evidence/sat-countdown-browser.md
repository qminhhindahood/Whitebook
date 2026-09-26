# Ticket 07 — SAT Weekend countdown browser check (local workerd + local D1)

Date: 2026-09-26 · Environment: `wrangler dev --local` (port 8799) against the built
`hosted/dist` bundle, migrations 0001–0003 applied to local D1, and a seeded
`learner_accounts` + `learner_sessions` row. No Google OAuth was configured, so the
session cookie was inserted directly; the sign-in itself is ticket 03's verified scope.

## Journey performed

1. Signed-out `/dashboard` renders the sign-in card (Google unconfigured locally, as expected).
2. After inserting the seeded session cookie, the dashboard renders the new
   "SAT test date" section: 14 catalog dates, all Saturdays, each labeled
   Confirmed or Anticipated, with the College Board source and last-checked
   2026-09-26. No School Day entry and no time-of-day claim appear anywhere.
3. Keyboard: Space toggled the 7 November 2026 checkbox on and off (native
   checkbox/radio controls; focus outlines styled in account.css).
4. Selected 3 October 2026 + 5 December 2026, marked 3 October primary, saved:
   response "Saved to your account."; countdown readout became
   **"7 calendar days until Saturday, 3 October 2026"** in the saved zone
   (Asia/Bangkok, UTC+7 — calendar-day difference, no 8 a.m. claim).
5. Reloaded the page: selections, primary, saved time zone, and countdown all
   came back from the server — persistence to the Learner Account verified.
   (Two independent sessions against the same account are covered by
   `hosted/test/satDates.test.ts`.)

## Captures

- `sat-countdown-desktop.png` — 1280px dashboard after save (compact countdown + selection list).
- `sat-countdown-narrow.png` — 390px phone layout: rows wrap, "Primary target"
  drops below each date, no horizontal overflow.

## Contrast (WCAG 2.1 ratios, computed 2026-09-26)

| Element | Foreground / background | Ratio | AA (4.5:1) |
| --- | --- | --- | --- |
| Confirmed pill | #2056AA on #E3ECFB | 5.94 | pass |
| Anticipated pill | #8A5A00 on #FDF3E0 | 5.38 | pass |
| Countdown text | #182538 on #FFFFFF | 15.43 | pass |
| Section body text | #52647A on #FFFFFF | 6.06 | pass |
| Body text on page background | #52647A on #F5F7FB | 5.65 | pass |
| Primary button | #FFFFFF on #2056AA | 7.06 | pass |

## Honesty note

The countdown "7 days" value and Test-day/past-date states at zone boundaries are
proven deterministically by `web/src/account/satCountdown.test.ts` and
`SatWeekend.test.tsx` (fake clock + a saved zone that disagrees with the device
zone); the browser check confirms real rendering and persistence, not boundary dates.
