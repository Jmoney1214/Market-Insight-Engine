# Brain Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only LLM analyst — CLI + `POST /brain/ask` — that reads the Supabase history and explains WHY a strategy went `no_edge` or a run broke, grounded in cited rows.

**Architecture:** One `diagnose(deps, question)` engine in the api-server: `intent → evidence builders (read Supabase via @supabase/supabase-js) → synthesizer (Claude, grounded on a pre-fetched evidence pack) → answer + citations`. Clients (Supabase, Anthropic) are dependency-injected so every unit tests with fakes, no network. Zero write-back.

**Tech Stack:** TypeScript (Express api-server) · `@supabase/supabase-js` (read-only, publishable key) · `@anthropic-ai/sdk` (`claude-opus-4-8`, adaptive thinking) · tests via `node:test` run with `npx tsx --test` (avoids the locally-broken vitest/rollup).

## Global Constraints

- **Read-only.** No write path in the module. Every Supabase call is `.select()`. Changes no strategy/confidence/gate/validation.
- **Grounding:** Claude sees ONLY the evidence pack; every causal claim cites a pack entity; if the pack is insufficient it says "insufficient evidence," never invents a cause.
- **Data access:** `@supabase/supabase-js` `createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)` — no `DATABASE_URL`. NOT `@supabase/ssr` (that's Next.js; this is Express/Node).
- **Model:** `claude-opus-4-8`, `thinking: {type: "adaptive"}`, `max_tokens: 16000`. Env: `ANTHROPIC_API_KEY`.
- **Env (gitignored, never commit):** `SUPABASE_URL=https://ganihlwaijdxpigssyab.supabase.co`, `SUPABASE_PUBLISHABLE_KEY=sb_publishable_…`, `ANTHROPIC_API_KEY=…`, optional `SUPABASE_ACCESS_TOKEN` (system logs).
- **DI:** evidence builders take the Supabase client as a parameter; the synthesizer takes an Anthropic client. Never construct clients inside the pure functions.
- **Shared branch** `claude/repository-analysis-synthesis-4dw5i1`: pull before first commit, push after each.
- **Toolchain:** pnpm 10 works now. Tests run `npx tsx --test <file>`.

---

### Task 0: Setup — deps, dir, env doc

**Files:**
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/src/lib/brain/` (dir), `artifacts/api-server/src/brain/` (dir)
- Modify: `artifacts/api-server/.gitignore` (or repo root) — ensure `.env` ignored

- [ ] **Step 1: Add the two runtime deps + a test/CLI script**

In `artifacts/api-server/package.json`, add to `dependencies`:
```json
    "@supabase/supabase-js": "^2.45.0",
    "@anthropic-ai/sdk": "^0.78.0",
```
Add to `devDependencies` (for the CLI + node:test runner): `"tsx": "catalog:"`.
Add to `scripts`:
```json
    "brain:test": "node --import tsx --test src/lib/brain/*.test.ts",
    "brain": "tsx src/brain/cli.ts"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes; `@supabase/supabase-js` and `@anthropic-ai/sdk` linked into api-server.

- [ ] **Step 3: Confirm `.env` is gitignored**

Run: `git check-ignore artifacts/api-server/.env && echo IGNORED`
Expected: `artifacts/api-server/.env` prints then `IGNORED`. If not, append `.env` to `artifacts/api-server/.gitignore`.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml artifacts/api-server/.gitignore
git commit -m "chore(brain): add supabase-js + anthropic-sdk deps and brain scripts"
```

---

### Task 1: Types + intent parser

**Files:**
- Create: `artifacts/api-server/src/lib/brain/types.ts`
- Create: `artifacts/api-server/src/lib/brain/intent.ts`
- Test: `artifacts/api-server/src/lib/brain/intent.test.ts`

**Interfaces:**
- Produces:
  - `type Subject = { kind: "strategy"; id: string } | { kind: "session"; date: string } | { kind: "system"; sinceHours: number }`
  - `type EvidencePack = { subject: Subject; facts: EvidenceFact[]; note?: string }`
  - `type EvidenceFact = { source: string; id: string; data: Record<string, unknown> }`
  - `type GroundedAnswer = { answer: string; citations: string[]; evidencePack: EvidencePack }`
  - `function parseIntent(question: string): Subject`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/brain/intent.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "./intent.ts";

test("routes a registered strategy name to a strategy subject", () => {
  assert.deepEqual(parseIntent("why did JUMPDAY_RIDER go no_edge?"), { kind: "strategy", id: "JUMPDAY_RIDER" });
  assert.deepEqual(parseIntent("how is largecap_scalper doing"), { kind: "strategy", id: "LARGECAP_SCALPER" });
});

test("routes a date to a session subject", () => {
  assert.deepEqual(parseIntent("what happened on 2026-07-06?"), { kind: "session", date: "2026-07-06" });
});

test("routes error/failure words to a system subject with a default window", () => {
  assert.deepEqual(parseIntent("why did the scan fail last night"), { kind: "system", sinceHours: 24 });
  assert.deepEqual(parseIntent("any errors today"), { kind: "system", sinceHours: 24 });
});

test("defaults an unmatched question to system (broadest, safest)", () => {
  assert.equal(parseIntent("what's going on").kind, "system");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/intent.test.ts`
Expected: FAIL — `./intent.ts` and `./types.ts` don't exist.

- [ ] **Step 3: Write types + intent**

Create `artifacts/api-server/src/lib/brain/types.ts`:
```ts
export type Subject =
  | { kind: "strategy"; id: string }
  | { kind: "session"; date: string }
  | { kind: "system"; sinceHours: number };

export type EvidenceFact = { source: string; id: string; data: Record<string, unknown> };
export type EvidencePack = { subject: Subject; facts: EvidenceFact[]; note?: string };
export type GroundedAnswer = { answer: string; citations: string[]; evidencePack: EvidencePack };
```

Create `artifacts/api-server/src/lib/brain/intent.ts`:
```ts
import type { Subject } from "./types.ts";

// The registered promotable hypotheses (mirror strategyLab). Extend as the
// registry grows; unknown names fall through to session/system routing.
const STRATEGIES = [
  "JUMPDAY_RIDER", "LARGECAP_SCALPER", "POST_EARNINGS_DRIFT", "RELATIVE_STRENGTH_MOMENTUM",
  "GAP_CONTINUATION", "GAP_FADE", "OPENING_RANGE_BREAKOUT", "OPENING_RANGE_FAILURE",
  "VOLATILITY_COMPRESSION_BREAKOUT",
];

export function parseIntent(question: string): Subject {
  const upper = question.toUpperCase();
  for (const s of STRATEGIES) {
    if (upper.includes(s)) return { kind: "strategy", id: s };
  }
  const date = question.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) return { kind: "session", date: date[1] };
  return { kind: "system", sinceHours: 24 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/intent.test.ts`
Expected: PASS (4 tests). Note: "why did the scan fail" has no strategy/date → falls to system ✓.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/brain/types.ts artifacts/api-server/src/lib/brain/intent.ts artifacts/api-server/src/lib/brain/intent.test.ts
git commit -m "feat(brain): types + intent parser (strategy/session/system routing)"
```

---

### Task 2: Read-only Supabase client + strategy evidence builder

**Files:**
- Create: `artifacts/api-server/src/lib/brain/supabaseClient.ts`
- Create: `artifacts/api-server/src/lib/brain/evidence.ts`
- Test: `artifacts/api-server/src/lib/brain/evidence.test.ts`

**Interfaces:**
- Consumes: `EvidencePack`, `EvidenceFact` (Task 1).
- Produces:
  - `type ReadClient = { from(table: string): { select(cols: string): Promise<{ data: any[] | null; error: unknown }> } }` (the minimal shape the builders use — the real `SupabaseClient` satisfies it, and a fake satisfies it in tests)
  - `function getReadClient(): SupabaseClient` (real, from env)
  - `async function strategyEvidence(db: ReadClient, strategyId: string): Promise<EvidencePack>`

- [ ] **Step 1: Write the failing test (fake DB, no network)**

Create `artifacts/api-server/src/lib/brain/evidence.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { strategyEvidence } from "./evidence.ts";

// Fake read client: returns fixed journal rows for the strategy query.
function fakeDb(rows: any[]) {
  return {
    from() {
      return { select: async () => ({ data: rows, error: null }) };
    },
  };
}

const rows = [
  { mode: "RESEARCH", manual_outcome: { strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: -1.02, action: "stop_hit", timeWindow: "morning", regime: null } },
  { mode: "RESEARCH", manual_outcome: { strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: 3.96, action: "closed", timeWindow: "morning", regime: null } },
];

test("strategyEvidence packs the scoreboard row + grouped trade facts, all cited", async () => {
  const pack = await strategyEvidence(fakeDb(rows), "JUMPDAY_RIDER");
  assert.deepEqual(pack.subject, { kind: "strategy", id: "JUMPDAY_RIDER" });
  // a scoreboard fact
  const board = pack.facts.find((f) => f.source === "scoreboard");
  assert.ok(board, "expected a scoreboard fact");
  assert.equal(board.data.sampleCount, 2);
  // per-trade facts carry R + action so the LLM can cite them
  const trades = pack.facts.filter((f) => f.source === "trade");
  assert.equal(trades.length, 2);
  assert.ok(trades.every((t) => typeof t.data.rMultiple === "number"));
});

test("strategyEvidence with no rows returns a note, not a crash", async () => {
  const pack = await strategyEvidence(fakeDb([]), "JUMPDAY_RIDER");
  assert.equal(pack.facts.filter((f) => f.source === "trade").length, 0);
  assert.match(pack.note ?? "", /no .*samples/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/evidence.test.ts`
Expected: FAIL — `./evidence.ts` not found.

- [ ] **Step 3: Write the client + strategy evidence**

Create `artifacts/api-server/src/lib/brain/supabaseClient.ts`:
```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Read-only client. The publishable key + RLS-disabled tables allow SELECTs from
// any environment without DATABASE_URL. The engine only ever reads.
export function getReadClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Minimal shape the evidence builders depend on — satisfied by SupabaseClient and by test fakes. */
export type ReadClient = {
  from(table: string): { select(cols: string): Promise<{ data: any[] | null; error: unknown }> };
};
```

Create `artifacts/api-server/src/lib/brain/evidence.ts`:
```ts
import {
  computeScoreboard,
  journalOutcomeToSample,
} from "../../../../../lib/copilot-core/src/index.ts";
import type { EvidenceFact, EvidencePack } from "./types.ts";
import type { ReadClient } from "./supabaseClient.ts";

/** Journal rows for a strategy -> scoreboard row + per-trade facts + regime/time
 * splits, each tagged with its source so the synthesizer can cite it. */
export async function strategyEvidence(db: ReadClient, strategyId: string): Promise<EvidencePack> {
  const { data, error } = await db
    .from("journal_entries")
    .select("mode, manual_outcome");
  if (error) throw new Error(`journal_entries read failed: ${String(error)}`);
  const rows = (data ?? []).filter((r) => (r.manual_outcome?.strategyName) === strategyId);

  const facts: EvidenceFact[] = [];
  const samples = rows
    .map((r) => journalOutcomeToSample({ mode: r.mode, manualOutcome: r.manual_outcome }))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const board = computeScoreboard(samples).find((s) => s.hypothesisName === strategyId);
  if (board) {
    facts.push({ source: "scoreboard", id: strategyId, data: {
      status: board.validationStatus, sampleCount: board.countableSampleCount, expectancyR: board.expectancyR } });
  }

  // group counts by timeWindow and exit-action for the "why" signal
  const byWindow: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  rows.forEach((r, i) => {
    const mo = r.manual_outcome ?? {};
    byWindow[mo.timeWindow ?? "unknown"] = (byWindow[mo.timeWindow ?? "unknown"] ?? 0) + 1;
    byAction[mo.action ?? "unknown"] = (byAction[mo.action ?? "unknown"] ?? 0) + 1;
    facts.push({ source: "trade", id: `${strategyId}#${i}`, data: {
      rMultiple: mo.rMultiple, action: mo.action, timeWindow: mo.timeWindow, regime: mo.regime, reportRef: mo.reportRef } });
  });
  facts.push({ source: "split", id: `${strategyId}:byTimeWindow`, data: byWindow });
  facts.push({ source: "split", id: `${strategyId}:byExitAction`, data: byAction });

  return {
    subject: { kind: "strategy", id: strategyId },
    facts,
    note: rows.length === 0 ? `no journal samples for ${strategyId}` : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/evidence.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/brain/supabaseClient.ts artifacts/api-server/src/lib/brain/evidence.ts artifacts/api-server/src/lib/brain/evidence.test.ts
git commit -m "feat(brain): read-only supabase client + strategy evidence builder"
```

---

### Task 3: Session + system evidence builders

**Files:**
- Modify: `artifacts/api-server/src/lib/brain/evidence.ts` (add two functions)
- Modify: `artifacts/api-server/src/lib/brain/evidence.test.ts` (add tests)

**Interfaces:**
- Produces:
  - `async function sessionEvidence(db: ReadClient, date: string): Promise<EvidencePack>`
  - `async function systemEvidence(db: ReadClient, sinceHours: number): Promise<EvidencePack>`

- [ ] **Step 1: Write the failing tests**

Append to `evidence.test.ts`:
```ts
import { sessionEvidence, systemEvidence } from "./evidence.ts";

function fakeTable(byTable: Record<string, any[]>) {
  return { from(t: string) { return { select: async () => ({ data: byTable[t] ?? [], error: null }) }; } };
}

test("sessionEvidence packs the scan_scorecard picks for the date", async () => {
  const db = fakeTable({ scan_scorecard: [
    { scan_date: "2026-07-06", symbol: "IREN", list: "intraday", gap_pct: 5.1, change_pct: 2.0, hit: true },
    { scan_date: "2026-07-06", symbol: "WULF", list: "intraday", gap_pct: 4.0, change_pct: -8.0, hit: false },
    { scan_date: "2026-07-02", symbol: "XXX", list: "jump", gap_pct: 1, change_pct: 1, hit: true },
  ] });
  const pack = await sessionEvidence(db, "2026-07-06");
  assert.deepEqual(pack.subject, { kind: "session", date: "2026-07-06" });
  assert.equal(pack.facts.filter((f) => f.source === "pick").length, 2); // only that date
});

test("systemEvidence reads history_log and notes when logs are thin", async () => {
  const db = fakeTable({ history_log: [] });
  const pack = await systemEvidence(db, 24);
  assert.equal(pack.subject.kind, "system");
  assert.match(pack.note ?? "", /no .*log/i);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/evidence.test.ts`
Expected: FAIL — `sessionEvidence`/`systemEvidence` not exported.

- [ ] **Step 3: Implement both**

Append to `evidence.ts`:
```ts
export async function sessionEvidence(db: ReadClient, date: string): Promise<EvidencePack> {
  const { data, error } = await db.from("scan_scorecard").select(
    "scan_date, symbol, list, score, gap_pct, price_at_scan, change_pct, range_pct, hit");
  if (error) throw new Error(`scan_scorecard read failed: ${String(error)}`);
  const picks = (data ?? []).filter((r) => r.scan_date === date);
  const facts: EvidenceFact[] = picks.map((p, i) => ({
    source: "pick", id: `${date}#${i}`, data: {
      symbol: p.symbol, list: p.list, gapPct: p.gap_pct, changePct: p.change_pct,
      rangePct: p.range_pct, hit: p.hit } }));
  const hits = picks.filter((p) => p.hit === true).length;
  facts.push({ source: "catchRate", id: date, data: { picks: picks.length, hits } });
  return { subject: { kind: "session", date }, facts,
    note: picks.length === 0 ? `no scorecard picks recorded for ${date}` : undefined };
}

export async function systemEvidence(db: ReadClient, sinceHours: number): Promise<EvidencePack> {
  // history_log is readable with the publishable key (no management token needed).
  // Postgres/API logs (via SUPABASE_ACCESS_TOKEN + management API) are a later add;
  // absence is reported, never fabricated.
  const { data, error } = await db.from("history_log").select("*");
  if (error) throw new Error(`history_log read failed: ${String(error)}`);
  const rows = data ?? [];
  const facts: EvidenceFact[] = rows.slice(0, 50).map((r, i) => ({ source: "log", id: `log#${i}`, data: r }));
  return { subject: { kind: "system", sinceHours }, facts,
    note: rows.length === 0
      ? "no history_log rows; Postgres/API logs need SUPABASE_ACCESS_TOKEN (not configured)"
      : undefined };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/evidence.test.ts`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/brain/evidence.ts artifacts/api-server/src/lib/brain/evidence.test.ts
git commit -m "feat(brain): session + system evidence builders"
```

---

### Task 4: Synthesizer (Claude, grounded)

**Files:**
- Create: `artifacts/api-server/src/lib/brain/synthesize.ts`
- Test: `artifacts/api-server/src/lib/brain/synthesize.test.ts`

**Interfaces:**
- Consumes: `EvidencePack`, `GroundedAnswer` (Task 1).
- Produces:
  - `type Completer = (system: string, user: string) => Promise<string>` (returns the model's text; injected so tests use a fake and prod uses the SDK)
  - `function anthropicCompleter(client: Anthropic): Completer`
  - `async function synthesize(complete: Completer, question: string, pack: EvidencePack): Promise<GroundedAnswer>`

- [ ] **Step 1: Write the failing test (fake completer, no network)**

Create `artifacts/api-server/src/lib/brain/synthesize.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { synthesize } from "./synthesize.ts";
import type { EvidencePack } from "./types.ts";

const pack: EvidencePack = { subject: { kind: "strategy", id: "JUMPDAY_RIDER" }, facts: [
  { source: "scoreboard", id: "JUMPDAY_RIDER", data: { status: "no_edge", sampleCount: 31, expectancyR: -0.29 } },
] };

test("synthesize returns the model's JSON answer + citations", async () => {
  const fake = async () => JSON.stringify({ answer: "no_edge because expectancy is -0.29R over 31 trades", citations: ["scoreboard:JUMPDAY_RIDER"] });
  const out = await synthesize(fake, "why no_edge?", pack);
  assert.match(out.answer, /-0.29R/);
  assert.deepEqual(out.citations, ["scoreboard:JUMPDAY_RIDER"]);
  assert.equal(out.evidencePack, pack);
});

test("non-JSON model output degrades to the raw text as the answer, empty citations", async () => {
  const fake = async () => "the rider just isn't working";
  const out = await synthesize(fake, "why?", pack);
  assert.match(out.answer, /isn.t working/);
  assert.deepEqual(out.citations, []);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/synthesize.test.ts`
Expected: FAIL — `./synthesize.ts` not found.

- [ ] **Step 3: Implement synthesizer**

Create `artifacts/api-server/src/lib/brain/synthesize.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import type { EvidencePack, GroundedAnswer } from "./types.ts";

export type Completer = (system: string, user: string) => Promise<string>;

const SYSTEM = [
  "You are a trading-system diagnostician. You are given a QUESTION and an EVIDENCE",
  "pack of facts pulled from the database. Explain the answer using ONLY those facts.",
  "Rules: (1) cite the exact fact ids you rely on (source:id). (2) If the evidence does",
  "not support a conclusion, say 'insufficient evidence to say why' and name what data",
  "would be needed. (3) Never invent numbers, trades, or causes not in the pack.",
  'Respond ONLY as JSON: {"answer": string, "citations": string[]} where each citation',
  'is a "source:id" from the evidence pack.',
].join(" ");

/** Wrap the Anthropic SDK as a Completer. claude-opus-4-8 + adaptive thinking. */
export function anthropicCompleter(client: Anthropic): Completer {
  return async (system, user) => {
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: user }],
    });
    // content is a discriminated union; take the first text block.
    const textBlock = res.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  };
}

export async function synthesize(complete: Completer, question: string, pack: EvidencePack): Promise<GroundedAnswer> {
  const user = `QUESTION: ${question}\n\nEVIDENCE (JSON):\n${JSON.stringify(pack, null, 2)}`;
  const raw = await complete(SYSTEM, user);
  try {
    const parsed = JSON.parse(raw) as { answer?: string; citations?: string[] };
    if (typeof parsed.answer === "string") {
      return { answer: parsed.answer, citations: Array.isArray(parsed.citations) ? parsed.citations : [], evidencePack: pack };
    }
  } catch {
    // fall through — model returned prose, not JSON
  }
  return { answer: raw.trim(), citations: [], evidencePack: pack };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/synthesize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/brain/synthesize.ts artifacts/api-server/src/lib/brain/synthesize.test.ts
git commit -m "feat(brain): grounded synthesizer (claude-opus-4-8, JSON answer + citations)"
```

---

### Task 5: diagnose orchestrator

**Files:**
- Create: `artifacts/api-server/src/lib/brain/diagnose.ts`
- Test: `artifacts/api-server/src/lib/brain/diagnose.test.ts`

**Interfaces:**
- Consumes: `parseIntent` (T1), `strategyEvidence`/`sessionEvidence`/`systemEvidence` (T2/T3), `synthesize`/`Completer` (T4), `ReadClient` (T2).
- Produces: `async function diagnose(deps: { db: ReadClient; complete: Completer }, question: string): Promise<GroundedAnswer>`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/brain/diagnose.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "./diagnose.ts";

const db = { from() { return { select: async () => ({ data: [
  { mode: "RESEARCH", manual_outcome: { strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED", rMultiple: -1, action: "stop_hit", timeWindow: "morning" } },
], error: null }) }; } };

test("diagnose routes a strategy question through evidence -> synthesize", async () => {
  const seen: string[] = [];
  const complete = async (_s: string, user: string) => { seen.push(user); return JSON.stringify({ answer: "ok", citations: ["scoreboard:JUMPDAY_RIDER"] }); };
  const out = await diagnose({ db, complete }, "why did JUMPDAY_RIDER go no_edge?");
  assert.equal(out.answer, "ok");
  assert.equal(out.evidencePack.subject.kind, "strategy");
  assert.match(seen[0], /EVIDENCE/); // the evidence pack was handed to the model
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/diagnose.test.ts`
Expected: FAIL — `./diagnose.ts` not found.

- [ ] **Step 3: Implement orchestrator**

Create `artifacts/api-server/src/lib/brain/diagnose.ts`:
```ts
import { parseIntent } from "./intent.ts";
import { strategyEvidence, sessionEvidence, systemEvidence } from "./evidence.ts";
import { synthesize, type Completer } from "./synthesize.ts";
import type { ReadClient } from "./supabaseClient.ts";
import type { EvidencePack, GroundedAnswer } from "./types.ts";

export async function diagnose(
  deps: { db: ReadClient; complete: Completer },
  question: string,
): Promise<GroundedAnswer> {
  const subject = parseIntent(question);
  let pack: EvidencePack;
  if (subject.kind === "strategy") pack = await strategyEvidence(deps.db, subject.id);
  else if (subject.kind === "session") pack = await sessionEvidence(deps.db, subject.date);
  else pack = await systemEvidence(deps.db, subject.sinceHours);
  return synthesize(deps.complete, question, pack);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test src/lib/brain/diagnose.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/brain/diagnose.ts artifacts/api-server/src/lib/brain/diagnose.test.ts
git commit -m "feat(brain): diagnose orchestrator (intent -> evidence -> synthesize)"
```

---

### Task 6: CLI + route + wiring

**Files:**
- Create: `artifacts/api-server/src/brain/cli.ts`
- Create: `artifacts/api-server/src/routes/brain.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (register the route)

**Interfaces:**
- Consumes: `diagnose`, `getReadClient`, `anthropicCompleter` (Tasks 2/4/5).

- [ ] **Step 1: Read the route-registration pattern**

Run: `sed -n '1,40p' artifacts/api-server/src/routes/index.ts`
Note how existing routers (scan, watchlist, copilot) are imported and `app.use`/`router.use`'d; mirror it exactly for `brain`.

- [ ] **Step 2: Write the CLI**

Create `artifacts/api-server/src/brain/cli.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { getReadClient } from "../lib/brain/supabaseClient.ts";
import { anthropicCompleter } from "../lib/brain/synthesize.ts";
import { diagnose } from "../lib/brain/diagnose.ts";

const question = process.argv.slice(2).join(" ").trim();
if (!question) { console.error('usage: brain "why did JUMPDAY_RIDER go no_edge?"'); process.exit(2); }

const db = getReadClient();
const complete = anthropicCompleter(new Anthropic());
const out = await diagnose({ db, complete }, question);
console.log("\n" + out.answer + "\n");
if (out.citations.length) console.log("cited:", out.citations.join(", "));
```

- [ ] **Step 3: Write the route**

Create `artifacts/api-server/src/routes/brain.ts`:
```ts
import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { getReadClient } from "../lib/brain/supabaseClient.js";
import { anthropicCompleter } from "../lib/brain/synthesize.js";
import { diagnose } from "../lib/brain/diagnose.js";

const router: IRouter = Router();

router.post("/ask", async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (!question) { res.status(400).json({ error: "question is required" }); return; }
  try {
    const out = await diagnose(
      { db: getReadClient(), complete: anthropicCompleter(new Anthropic()) },
      question,
    );
    res.json({ answer: out.answer, citations: out.citations });
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "brain/ask failed");
    res.status(502).json({ error: "diagnosis failed", detail: String(err) });
  }
});

export default router;
```
(Route imports use `.js` — the api-server compiles TS→JS; the brain lib imports inside `.ts` files use `.ts` for the tsx CLI. Both resolve because esbuild + tsx rewrite extensions. If the build complains, match the extension convention already used in `routes/copilot/event.ts`.)

- [ ] **Step 4: Register the route**

In `artifacts/api-server/src/routes/index.ts`, mirror the existing registrations, e.g.:
```ts
import brainRouter from "./brain.js";
// ...alongside the other app.use(...) lines:
app.use("/brain", brainRouter);
```

- [ ] **Step 5: Typecheck + smoke the CLI (needs env keys)**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: no errors.
Then, with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ANTHROPIC_API_KEY` exported:
Run: `pnpm --filter @workspace/api-server run brain "why did JUMPDAY_RIDER go no_edge?"`
Expected: a grounded paragraph citing `scoreboard:JUMPDAY_RIDER` and the −0.29R / 31-sample facts. If `ANTHROPIC_API_KEY` is unset, it errors clearly — surface it, don't fake output.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/brain/cli.ts artifacts/api-server/src/routes/brain.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(brain): CLI + POST /brain/ask route wired into the api-server"
```

---

## Self-Review

**Spec coverage:** §1 purpose → whole plan. §2 supabase-js + publishable key → Task 2 `getReadClient`. §3 architecture (intent/evidence/synthesize/diagnose + route + CLI) → Tasks 1-6. §4 components → Tasks 1-5. §5 system logs (history_log now, access-token later, degrade honestly) → Task 3 `systemEvidence`. §6 grounding spine (evidence-only, cite, "insufficient") → Task 4 SYSTEM prompt + tests. §7 error handling (empty→note, Claude down→raw text, DB unreachable→throw surfaced) → Tasks 2/3/4/6. §8 testing (evidence/intent/honesty/citation) → each task's tests. §9 security (key in env, server-side) → Task 0 + route. §10 lens-not-controller → read-only Global Constraint. **No gaps.**

**Placeholder scan:** no TBD/"handle errors"/"similar to". The one "read the pattern" step (Task 6 Step 1) names the exact file to mirror, not a vague instruction. Structured-output via `output_config.format` is deliberately deferred to a system-prompt JSON contract (concrete, model-agnostic) rather than guessing unverified SDK syntax.

**Type consistency:** `Subject`/`EvidencePack`/`EvidenceFact`/`GroundedAnswer` (T1) used unchanged in T2-T5. `ReadClient` (T2) consumed by T3/T5. `Completer` (T4) consumed by T5/T6. `parseIntent`/`strategyEvidence`/`sessionEvidence`/`systemEvidence`/`synthesize`/`anthropicCompleter`/`diagnose` names match across producer and consumer.
