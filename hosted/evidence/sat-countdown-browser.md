# Ticket 07 — SAT Weekend countdown verification

Date: 2026-09-26 · Local only; no deployment or production data was used.

## Behavior

- The Dashboard countdown follows the selected Primary SAT Target and displays
  live days, hours, minutes, and seconds to **8:00 a.m. GMT+7
  (Asia/Bangkok)** on that date on every device.
- The 8:00 a.m. value is a dashboard countdown convention, not a claim about
  the SAT's actual start time. At the cutoff the banner changes to **Test day**;
  after the Bangkok calendar date passes it prompts for a later target.
- Dates are formatted as dates, independently of the browser's local time zone.
  No time zone is captured or persisted with the account.

## Local API and persistence check

The local Worker ran on port 8810 with migrations 0001–0003 applied to an
isolated local D1 database at `hosted/.wrangler/state-sat07-qa`. A synthetic
learner account and session were inserted into that database; Google OAuth was
not involved.

1. `GET /api/account/sat-dates` returned the 14-entry SAT Weekend catalog and
   an empty selection for the synthetic learner.
2. `POST /api/account/sat-dates`, with the local same-origin and CSRF headers,
   saved 3 October 2026 and 5 December 2026 with 3 October as primary and
   returned HTTP 200.
3. A subsequent `GET` returned both selections and the same primary target,
   verifying persistence through the local Workerd/D1 path. The write uses one
   D1 batch; a regression test verifies the previous selection survives a
   failed batch.

This API check did not use or contact a production account. Full worker/browser
authentication remains outside this Ticket 07 check.

## Captures and responsive layout

`sat-countdown-desktop.png` and `sat-countdown-narrow.png` are visual captures
of the Dashboard rendered with a mocked account API response. They verify the
banner, four live units, date-selection list, and responsive wrapping; they are
not evidence of browser-to-D1 persistence. The local API check above verifies
the latter independently. The narrow capture is 390px wide and has no
horizontal overflow.

## Catalog source spot-check

The 14 entries match the College Board's [SAT test dates and deadlines](https://satsuite.collegeboard.org/sat/dates-deadlines): six confirmed 2026–27
SAT Weekend dates and eight anticipated 2027–28 dates. All are Saturdays; the
separate SAT School Day schedule is excluded. The catalog records the source
URL and last-checked date, 2026-09-26.

## Contrast (WCAG 2.1)

Ratios were computed against the rendered colors on 2026-09-26.

| Element | Foreground / background | Ratio | AA (4.5:1) |
| --- | --- | ---: | --- |
| Countdown date and unit labels | #FFFFFF on #3F51C5 | 6.57 | pass |
| Countdown note | #EEF1FC on #3F51C5 | 5.83 | pass |
| Countdown digits | #3343AB on #FFFFFF | 8.29 | pass |
| Confirmed pill | #2056AA on #E3ECFB | 5.94 | pass |
| Anticipated pill | #8A5A00 on #FDF3E0 | 5.38 | pass |
| Primary button | #FFFFFF on #2056AA | 7.06 | pass |

## Deterministic boundary coverage

`web/src/account/satCountdown.test.ts` and `SatWeekend.test.tsx` use a fake
clock to cover the exact 8:00 a.m. GMT+7 cutoff, countdown units, Test day,
Passed, no-target, and saved/device-zone disagreement (the fixed GMT+7 result
is the same regardless of device zone). They also cover the 25-hour DST day
in the browser's unrelated zone to ensure it does not affect the target.
