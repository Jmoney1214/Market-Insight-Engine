# Design — Brain Diagnostics: read-only LLM "why did it fail" analyst over Supabase

**Date:** 2026-07-09
**Branch:** `claude/repository-analysis-synthesis-4dw5i1` (shared cloud session — pull before commit, push after)
**Status:** drafted from brainstorming (4 decisions locked) + the Supabase supabase-js wiring; pending review

---

## 1. Purpose

The scoreboard now says **`JUMPDAY_RIDER` = `no_edge` (the WHAT)**. This module answers
the **WHY**: a read-only LLM analyst you interrogate — "why did the rider go no_edge?",
"why did Tuesday's scan break?" — that reads the accumulated Supabase history, explains
grounded in the actual rows, and cites them.

**Locked decisions (from brainstorming):**
- **Authority:** *pure explainer, read-only.* Zero write-back. It never touches strategy,
  confidence, gates, or validation — it explains, the human decides. (Honors the standing
  boundary: LLM informs, never decides.)
- **Scope:** *both* trading-level ("why no edge") **and** system-level ("why a run broke"),
  one surface.
- **Interface:** *both* — one shared engine, exposed via a **CLI** and a **`POST /brain/ask`**
  api-server route.
- **Grounding:** *evidence-pack + synthesis* — deterministic queries build a structured
  evidence pack; Claude explains ONLY from it and cites rows. The LLM never queries the DB
  directly, so it cannot hallucinate data or write bad SQL.

**Non-goals:** no write-back, no auto-tuning, no new committee lens (this is periodic/on-
demand analysis, not a per-event real-time read), no text-to-SQL.

## 2. Data access — supabase-js + publishable key (resolves the local gap)

The engine reads Supabase via **`@supabase/supabase-js`** (`createClient(SUPABASE_URL,
SUPABASE_PUBLISHABLE_KEY)`), NOT `@workspace/db`/`DATABASE_URL`. This reads from any
environment (local CLI, Express, cloud) with only the URL + publishable key in env — no
`DATABASE_URL` needed. RLS is disabled (user's standing choice), so the publishable key
reads all tables; the engine only ever SELECTs.

**Correction to the pasted quickstart:** that snippet is Next.js (`@supabase/ssr`,
`next/headers`, cookies, middleware, `page.tsx`). This repo is **Vite (findesk) + Express
(api-server) + Node (CLI)** — none of the SSR/cookie/middleware pieces apply. We install
**only `@supabase/supabase-js`** (not `@supabase/ssr`) in the api-server, and use the plain
client. Env var names follow this repo's Node convention, not `NEXT_PUBLIC_`:

```
# artifacts/api-server/.env  (gitignored — never commit the key)
SUPABASE_URL=https://ganihlwaijdxpigssyab.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # read-only diagnostics
SUPABASE_ACCESS_TOKEN=...                      # OPTIONAL — only for system logs (see §5)
```

findesk never gets a Supabase client — if a UI chat is added later it calls the
`/brain/ask` route, keeping the browser out of the DB.

## 3. Architecture

One core function in the api-server: `diagnose(question: string) → GroundedAnswer`.
Two thin wrappers call it — a CLI and a route. It has no write path.

```
artifacts/api-server/src/lib/brain/
  supabaseClient.ts   # createClient(url, publishableKey) — read-only singleton
  intent.ts           # question -> { subject: "strategy"|"session"|"system", id }
  evidence.ts         # evidence builders (deterministic, SELECT-only)
  synthesize.ts       # evidence pack + question -> Claude -> grounded answer
  diagnose.ts         # orchestrates intent -> evidence -> synthesize
artifacts/api-server/src/routes/brain.ts   # POST /brain/ask
artifacts/api-server/src/brain/cli.ts      # ask-brain "<question>"
```

## 4. Components (each independently testable)

1. **Intent** (`intent.ts`) — light classification of the question into a subject +
   identifier. Rule-first (regex for known strategy names / dates / "error|fail|broke"),
   LLM fallback only if ambiguous. Output: `{ subject, id }`.
2. **Evidence builders** (`evidence.ts`, deterministic, read-only) — the trustworthy core:
   - `strategyEvidence(strategyId)` → the scoreboard row (status/expectancy/n) **plus** that
     strategy's `journal_entries` grouped by **regime / timeWindow / exit-action**, win/loss
     splits, best/worst buckets, and the raw trade list.
   - `sessionEvidence(date)` → that date's `scan_scorecard`, board picks, catch-rate, and the
     matching `reports` row.
   - `systemEvidence(window)` → recent errors/failures (see §5).
   Each returns a typed `EvidencePack` (structured JSON, every fact tagged with its source
   table + id).
3. **Synthesizer** (`synthesize.ts`, Claude) — given the question + `EvidencePack`, returns a
   grounded answer. **Model `claude-opus-4-8`, adaptive thinking** (`thinking: {type:
   "adaptive"}`), **structured output** (`output_config.format` → `{ answer, citations[] }`),
   via the official **`@anthropic-ai/sdk`** (already vendored at `^0.78.0`). System prompt
   enforces §6. `ANTHROPIC_API_KEY` in env.
4. **diagnose** (`diagnose.ts`) — `intent → evidence → synthesize`, returns
   `{ answer, citations, evidencePack }`.
5. **Entry points** — CLI (`ask-brain "…"` prints the answer) + `POST /brain/ask
   { question } → { answer, citations }`.

## 5. System logs (the harder half)

Trading tables read with the publishable key. **Postgres/API/edge logs do NOT** — the data
API can't reach them. Options, in order of preference:
- **Supabase Management API** (`GET /v1/projects/{ref}/analytics/endpoints/logs.all`) with a
  `SUPABASE_ACCESS_TOKEN` — best-effort: if the token is absent, `systemEvidence` returns
  "logs unavailable (no access token)" rather than failing.
- The `history_log` / app-level error rows already in the DB (readable via the publishable
  key) — a Plane-agnostic first source of "what errored" without any new token.
So system diagnostics degrade honestly: they use whatever log source is reachable and say
which, never fabricating a failure cause.

## 6. The grounding spine (why it won't lie)

- Claude sees **only the evidence pack**, never the raw DB.
- **Every causal claim cites** a specific trade id / number / log line from the pack.
- If the pack doesn't support a conclusion → the answer is **"insufficient evidence to say
  why"** + what data *would* be needed. Never a manufactured cause.
- **Read-only by construction** — the client is created with the publishable key and the
  engine issues only SELECTs; there is no write path in the module.
- Output is explanation only — it changes no strategy, confidence, gate, or validation.

## 7. Error handling

- Empty/unknown subject → "no data for X; here's what exists" (lists known strategies/dates).
- Claude unavailable → return the **raw evidence pack** (structured data still answers most).
- Supabase unreachable → clear message, partial/empty evidence, no crash.
- System-log token absent → trading diagnostics still work; system half says "unavailable."

## 8. Testing

- **Evidence builders:** fixture rows → correct groupings/stats/buckets (deterministic).
- **Intent:** known strategy names/dates/error-words route to the right subject.
- **Honesty test:** feed a pack that does NOT support a strong claim → assert the synthesizer
  says "insufficient," invents no cause. (Prompt-level; assert via a stubbed provider.)
- **Citation test:** assert every entity id the answer references exists in the provided pack.
- **No-write test:** assert the module exposes no write method and the client is only ever
  used for `.select()`.

## 9. Security note

The publishable key + RLS-disabled means the key can read (and, in general, write) every
row — you chose to leave RLS off. This module only ever reads. The key lives in
`artifacts/api-server/.env` (gitignored) and is never committed. The `/brain/ask` route is
server-side, so the key never reaches a browser.

## 10. Relationship to the rest of the system

This is a **lens**, parallel to the deterministic committee and the (cloud) calibration
layer — it reads all three planes' data (journal/scoreboard = Plane A, agent_findings/
finding_grades = Plane B, logs = operational) but writes to none. It's the "ask the brain
why" surface on top of everything already stored.
