# Scorecard forward-capture — external cron

`scan_scorecard` is a forward-measurement table: it records the scanner's morning
picks and grades them after the close against the real SIP session bar. Capture is
driven by a single idempotent endpoint so it does not depend on the server process
being alive at any exact minute.

## Endpoint

`POST /api/scan/scorecard/run` — self-selects by the NY clock:
- weekday 08:15–09:30 ET → records the morning picks → `{ "action": "recorded", "date": "YYYY-MM-DD", "recorded": N }`
- otherwise → grades pending picks vs the SIP session bar → `{ "action": "graded", "graded": N }`
- `503` if FMP/Alpaca keys are unconfigured; `500 { error }` on a real failure (surfaced, not hidden).

Idempotent: re-hitting in-window never duplicates (unique `scanDate,symbol,list`);
grading only touches ungraded rows.

## Schedule (America/New_York, weekdays)

Point any external scheduler at the endpoint twice per trading day:
- **~08:20 ET** — records that morning's picks (must land inside 08:15–09:30).
- **~16:20 ET** — grades the day (session bar is final after 16:15).

Examples: a Replit Scheduled Deployment, cron-job.org, or a GitHub Actions `schedule`
cron issuing `curl -X POST https://<host>/api/scan/scorecard/run`. Because the endpoint
self-selects and is idempotent, extra hits (e.g. hourly) are harmless.

## Verify

`curl -X POST https://<host>/api/scan/scorecard/run` on a weekday morning should return
`{"action":"recorded","recorded":N}` with N > 0. Then the brain's session question for
that date (`pnpm run brain "what happened on YYYY-MM-DD?"`) returns the real picks.
