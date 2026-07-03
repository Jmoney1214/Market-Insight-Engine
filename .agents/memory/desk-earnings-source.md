---
name: Desk earnings-date sourcing
description: Which keyless earnings-calendar sources actually work for the post-earnings-drift signal
---

# Earnings-date sourcing for POST_EARNINGS_DRIFT

Rule: source the most recent PAST earnings date from Nasdaq's keyless `api.nasdaq.com/api/company/{SYM}/earnings-surprise` endpoint (lists the last ~4 ACTUAL report dates: `earningsSurpriseTable.rows[].dateReported` as `M/D/YYYY`, plus the same dates as epoch seconds in `data.chart[].x`). Yahoo's `quoteSummary?modules=calendarEvents` is crumb/cookie-gated, frequently fails, and usually only exposes the NEXT (future) report date — keep it only as a fallback.

**Why:** the crumb-based Yahoo source left the drift detector dormant almost always; Nasdaq works from this environment with a plain custom User-Agent + `Accept: application/json` (no browser spoofing needed) and returns 200 with `data:null` + "No record found" for ETFs/non-reporters — a clean dormant path.

**How to apply:** any earnings-date consumer should take max(report dates ≤ now) and return null otherwise so detectors stay dormant rather than guessing. Date-level (UTC-midnight) precision is fine: midnight of the report day always precedes that day's session open, which is all the drift recency window needs. No Replit integration/connector exists for earnings calendars (checked July 2026).
