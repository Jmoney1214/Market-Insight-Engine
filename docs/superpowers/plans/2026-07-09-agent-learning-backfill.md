# Agent Learning Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade the historical replay trades from the committed harness into `journal_entries` (backtest tier) so the `memory` lens moves from `unproven` to a real measured status.

**Architecture:** The deterministic engine re-run (in `tools/research`, plain Node) emits true entry→stop R and writes `candidates.json`. A `scripts/` TS tool (runs under `tsx`, can import `@workspace/copilot-core`) maps each candidate to a `journal_entries` row, proves countability through the REAL `journalOutcomeToSample()`, runs a diff gate vs the committed `.md`, and prints a staging table — never auto-writing. The human confirms; the assistant writes rows via the Supabase connector; a verifier recomputes the scoreboard and renders the `memory` lens flip.

**Tech Stack:** Node ESM + `node:test` (tools/research); TypeScript + `tsx` + `node --import tsx --test` (scripts); `@workspace/copilot-core` (`journalOutcomeToSample`, `computeScoreboard`), `@workspace/copilot-committee` (`memoryAgent`); Supabase MCP connector for all DB I/O.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-09-agent-learning-backfill-design.md` — this plan implements it verbatim.
- **Evidence tier default = `backtest`:** every row `mode: "RESEARCH"` (kind `backtest`, ceiling `backtested_only`). `paper`/`REPLAY` only via explicit per-date human reclassification at staging. NEVER a field default.
- **strategyName ∈ {`JUMPDAY_RIDER`, `LARGECAP_SCALPER`}** only (registered `9673617`). Any other class is dropped before staging.
- **action ∈ SCOREABLE_ACTIONS** = `closed | manually_tracked | target_hit | stop_hit`. Map engine reason: `stop`→`stop_hit`, `target`→`target_hit`, `eod`/`data-end`→`closed`. No invented strings.
- **outcomeConfidence = `MANUAL_CONFIRMED`** only after the human reviews the staging table. The script never auto-writes.
- **R is true entry→stop**, not `$/250`: `rMultiple = (exit − entry) / (entry − stop)`. Carry `pnlDollars` too (diverges by commission).
- **Provenance stamp** in every `manual_outcome`: `{source:"replay_rerun", configHash, gitSha, reportRef}`.
- **Idempotency key** = `(symbol, session date, strategy, entryHm)`. `event_timestamp` stored UTC-with-offset for DST-safe dedup.
- **Diff gate halts** on any trade added/removed vs the committed `.md`; never force the old count of 26.
- **DB I/O via the Supabase connector only** (project `ganihlwaijdxpigssyab`). Never handle `DATABASE_URL` or keys. Re-run needs `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY`/`FMP_API_KEY` in env as normal harness operation — if unset, stop and tell the user.
- **Shared branch** `claude/repository-analysis-synthesis-4dw5i1`: `git pull --ff-only` before the first commit and push promptly after each.

---

### Task 0: Setup — wire `scripts/` for the backfill

**Files:**
- Modify: `scripts/package.json`
- Modify: `tools/research/.gitignore`
- Create: `scripts/src/backfill/` (dir), `tools/research/backfill/` (dir)

**Interfaces:**
- Produces: a `scripts/` package that can `import` from `@workspace/copilot-core` and `@workspace/copilot-committee` under `tsx`, and a `node --import tsx --test` test runner.

- [ ] **Step 1: Add workspace deps + a test script to `scripts/package.json`**

Add to `dependencies` (create the block; keep existing `devDependencies`):
```json
  "dependencies": {
    "@workspace/copilot-core": "workspace:*",
    "@workspace/copilot-committee": "workspace:*"
  },
```
Add to `scripts`:
```json
    "test": "node --import tsx --test src/**/*.test.ts",
    "backfill": "tsx src/backfill/run.ts",
    "backfill:verify": "tsx src/backfill/verify.ts"
```

- [ ] **Step 2: Install so the workspace links resolve**

Run: `pnpm install`
Expected: completes; `scripts` now has `@workspace/copilot-core` linked.

- [ ] **Step 3: Ignore scratch artifacts**

Append to `tools/research/.gitignore`:
```
backfill/candidates.json
backfill/insert-plan.json
backfill/journal-rows.json
```

- [ ] **Step 4: Prove the import resolves under tsx**

Create `scripts/src/backfill/_smoke.ts`:
```ts
import { computeScoreboard } from "@workspace/copilot-core";
import { memoryAgent } from "@workspace/copilot-committee";
console.log("imports OK", typeof computeScoreboard, typeof memoryAgent);
```
Run: `pnpm --filter @workspace/scripts exec tsx src/backfill/_smoke.ts`
Expected: `imports OK function function`
Then delete it: `rm scripts/src/backfill/_smoke.ts`

- [ ] **Step 5: Commit**

```bash
git add scripts/package.json pnpm-lock.yaml tools/research/.gitignore
git commit -m "chore: wire scripts package for the learning backfill tool"
```

---

### Task 1: Engine emits `stop` + `rMultiple` (additive, Pine parity untouched)

**Files:**
- Modify: `tools/research/lib/engine.mjs:132-137` (the `record` closure)
- Test: `tools/research/test/engine.rmultiple.test.mjs`

**Interfaces:**
- Produces: each object in `runEngine(...).trades` gains `stop: number` and `rMultiple: number | null` (null only if `entry <= stop`, which the entry guard already prevents).

- [ ] **Step 1: Write the failing test**

Create `tools/research/test/engine.rmultiple.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runEngine } from "../lib/engine.mjs";

// Minimal 5-min RTH day that gaps up, triggers the rider once, then gets stopped.
// prevClose 100; open 102 (gap +2% > threshold). A 9-EMA pullback-reclaim fires,
// then a later bar trades down through the stop.
function bar(hm, o, h, l, c, v = 1e6) { return { hm, o, h, l, c, v }; }

test("rider trade carries stop and true entry->stop rMultiple", () => {
  const bars = [];
  // pre-open ignored; build RTH bars 09:30..10:05 climbing, pull back, reclaim, then drop
  bars.push(bar("09:30", 102, 103, 101.5, 102.5));
  for (let i = 0; i < 6; i++) bars.push(bar(`09:${35 + i * 5}`.slice(0,5), 102.5 + i*0.3, 103.5 + i*0.3, 102 + i*0.3, 103 + i*0.3));
  // signal bar ~09:45: dips to touch EMA9 then closes up above vwap
  bars.push(bar("09:45", 104, 104.5, 103.2, 104.3));
  // entry next bar open, then a bar that trades through the stop
  bars.push(bar("09:50", 104.4, 104.6, 100.0, 100.2));
  bars.push(bar("15:50", 100.2, 100.3, 100.0, 100.1));
  const res = runEngine("rider", bars, 100);
  const t = res.trades.find((x) => x.reason === "stop");
  assert.ok(t, "expected a stopped trade");
  assert.equal(typeof t.stop, "number");
  // realized R = (exit - entry) / (entry - stop); a stop fill must be <= 0R
  assert.ok(t.rMultiple <= 0, `expected non-positive R on a stop, got ${t.rMultiple}`);
  assert.ok(Math.abs(t.rMultiple - (t.exit - t.entry) / (t.entry - t.stop)) < 1e-6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/research/test/engine.rmultiple.test.mjs`
Expected: FAIL — `t.stop` is `undefined` (engine doesn't emit it yet).

- [ ] **Step 3: Modify the `record` closure to emit `stop` + `rMultiple`**

In `tools/research/lib/engine.mjs`, replace the `record` closure (lines 132-137):
```js
  const record = (exit, exitHm, reason) => {
    const pnl = (exit - pos.entry) * pos.qty - (pos.entry + exit) * pos.qty * commPct;
    // True realized R off the ACTUAL fill: (exit - entry) / (entry - stop).
    // entry - stop > 0 is guaranteed by the entry guard at line ~146. Additive
    // output only — no rule change, so the Pine twin + parity contract are untouched.
    const rMultiple = pos.entry > pos.stop ? round((exit - pos.entry) / (pos.entry - pos.stop), 2) : null;
    dayPnl += pnl; nT++;
    trades.push({ entryHm: pos.entryHm, exitHm, entry: round(pos.entry), exit: round(exit),
      stop: round(pos.stop), qty: pos.qty, pnl: round(pnl), rMultiple, reason });
    pos = null;
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/research/test/engine.rmultiple.test.mjs`
Expected: PASS. Also run the existing suite: `node --test tools/research/test/` — Expected: all PASS (change is additive).

- [ ] **Step 5: Commit**

```bash
git add tools/research/lib/engine.mjs tools/research/test/engine.rmultiple.test.mjs
git commit -m "feat(engine): emit stop + true entry->stop rMultiple per trade

Additive output only — no rule change. Pine twin and Pine<->Node parity
contract are untouched (verdicts already exclude qty/PnL per sizing-base)."
```

---

### Task 2: Sample mapper — candidate → journal row, proven countable

**Files:**
- Create: `scripts/src/backfill/mapper.ts`
- Test: `scripts/src/backfill/mapper.test.ts`

**Interfaces:**
- Consumes: a `Candidate` (from Task 5's `candidates.json`).
- Produces:
  - `type Candidate = { symbol: string; date: string; cls: "rider"|"scalper"|string; entryHm: string; entry: number; exit: number; stop: number; pnl: number; rMultiple: number|null; reason: string; configHash: string; gitSha: string; reportRef: string }`
  - `type StagedRow = { mode: "RESEARCH"; symbol: string; eventTimestampUtc: string; notes: string; manualOutcome: Record<string, unknown>; dedupKey: string; countable: boolean; dropReason: string | null }`
  - `function toStagedRow(c: Candidate): StagedRow`
  - `function actionFromReason(reason: string): "stop_hit"|"target_hit"|"closed"`
  - `function timeWindowFromHm(hm: string): string`

- [ ] **Step 1: Write the failing test**

Create `scripts/src/backfill/mapper.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toStagedRow, actionFromReason, timeWindowFromHm } from "./mapper.ts";

const base = {
  symbol: "MSTR", date: "2026-07-02", cls: "rider", entryHm: "10:10",
  entry: 400, exit: 390, stop: 395, pnl: -239, rMultiple: -2, reason: "stop",
  configHash: "62eae2594331", gitSha: "9673617", reportRef: "research/reports/2026-07-02_2026-07-02.md",
};

test("action mapping is exact and whitelist-only", () => {
  assert.equal(actionFromReason("stop"), "stop_hit");
  assert.equal(actionFromReason("target"), "target_hit");
  assert.equal(actionFromReason("eod"), "closed");
  assert.equal(actionFromReason("data-end"), "closed");
});

test("time window buckets from entry hm", () => {
  assert.equal(timeWindowFromHm("09:45"), "open");
  assert.equal(timeWindowFromHm("10:10"), "morning");
  assert.equal(timeWindowFromHm("15:10"), "power_hour");
});

test("rider candidate maps to a COUNTABLE JUMPDAY_RIDER row with provenance", () => {
  const r = toStagedRow(base);
  assert.equal(r.mode, "RESEARCH");
  assert.equal(r.countable, true);
  assert.equal(r.dropReason, null);
  assert.equal(r.manualOutcome.strategyName, "JUMPDAY_RIDER");
  assert.equal(r.manualOutcome.action, "stop_hit");
  assert.equal(r.manualOutcome.outcomeConfidence, "MANUAL_CONFIRMED");
  assert.equal(r.manualOutcome.source, "replay_rerun");
  assert.equal(r.manualOutcome.gitSha, "9673617");
  assert.equal(r.dedupKey, "MSTR|2026-07-02|JUMPDAY_RIDER|10:10");
});

test("unknown class is dropped, never journaled", () => {
  const r = toStagedRow({ ...base, cls: "caution" });
  assert.equal(r.countable, false);
  assert.ok((r.dropReason ?? "").length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/mapper.test.ts`
Expected: FAIL — `./mapper.ts` does not exist.

- [ ] **Step 3: Write the mapper**

Create `scripts/src/backfill/mapper.ts`:
```ts
import { journalOutcomeToSample } from "@workspace/copilot-core";

export type Candidate = {
  symbol: string; date: string; cls: string; entryHm: string;
  entry: number; exit: number; stop: number; pnl: number;
  rMultiple: number | null; reason: string;
  configHash: string; gitSha: string; reportRef: string;
};

export type StagedRow = {
  mode: "RESEARCH"; symbol: string; eventTimestampUtc: string; notes: string;
  manualOutcome: Record<string, unknown>; dedupKey: string;
  countable: boolean; dropReason: string | null;
};

const CLASS_TO_HYPOTHESIS: Record<string, string> = {
  rider: "JUMPDAY_RIDER",
  scalper: "LARGECAP_SCALPER",
};

export function actionFromReason(reason: string): "stop_hit" | "target_hit" | "closed" {
  if (reason === "stop") return "stop_hit";
  if (reason === "target") return "target_hit";
  return "closed"; // eod, data-end
}

export function timeWindowFromHm(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const mins = h * 60 + m;
  if (mins < 600) return "open";        // 09:30-10:00
  if (mins < 660) return "morning";     // 10:00-11:00
  if (mins < 840) return "midday";      // 11:00-14:00
  if (mins < 900) return "afternoon";   // 14:00-15:00
  return "power_hour";                  // 15:00-16:00
}

/** ET session date + entry time -> a UTC ISO string. ET is UTC-4 (EDT) or UTC-5
 * (EST); we store with the correct offset so the dedup compare is DST-safe.
 * The offset is derived from the date's standard US DST rules. */
function etToUtcIso(dateISO: string, hm: string): string {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  // US DST 2007+: 2nd Sunday March .. 1st Sunday November = EDT (-4), else EST (-5).
  const secondSundayMarch = nthSunday(y, 3, 2);
  const firstSundayNov = nthSunday(y, 11, 1);
  const asDay = Date.UTC(y, mo - 1, d) / 86400000;
  const isEdt = asDay >= secondSundayMarch && asDay < firstSundayNov;
  const offset = isEdt ? 4 : 5;
  return new Date(Date.UTC(y, mo - 1, d, h + offset, mi)).toISOString();
}
function nthSunday(year: number, month1: number, n: number): number {
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const firstSundayDate = 1 + ((7 - first.getUTCDay()) % 7);
  return Date.UTC(year, month1 - 1, firstSundayDate + (n - 1) * 7) / 86400000;
}

export function toStagedRow(c: Candidate): StagedRow {
  const strategyName = CLASS_TO_HYPOTHESIS[c.cls];
  const dedupKey = `${c.symbol}|${c.date}|${strategyName ?? c.cls}|${c.entryHm}`;
  const base = {
    mode: "RESEARCH" as const,
    symbol: c.symbol,
    eventTimestampUtc: etToUtcIso(c.date, c.entryHm),
    notes: `${c.symbol} ${c.cls} ${c.entryHm}->${"exit"} ${c.reason} (${c.pnl >= 0 ? "+" : ""}${c.pnl})`,
    dedupKey,
  };
  if (!strategyName) {
    return { ...base, manualOutcome: {}, countable: false,
      dropReason: `class "${c.cls}" is not a registered promotable hypothesis` };
  }
  const manualOutcome = {
    strategyName,
    outcomeConfidence: "MANUAL_CONFIRMED",
    rMultiple: c.rMultiple,
    pnlDollars: c.pnl,
    action: actionFromReason(c.reason),
    regime: null,
    timeWindow: timeWindowFromHm(c.entryHm),
    source: "replay_rerun",
    configHash: c.configHash,
    gitSha: c.gitSha,
    reportRef: c.reportRef,
  };
  // Prove countability through the REAL production mapper — never a silent drop.
  const sample = journalOutcomeToSample({ mode: "RESEARCH", manualOutcome });
  return { ...base, manualOutcome, countable: sample !== null,
    dropReason: sample === null ? "journalOutcomeToSample rejected the row" : null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/mapper.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/src/backfill/mapper.ts scripts/src/backfill/mapper.test.ts
git commit -m "feat(backfill): candidate->journal-row mapper, countability via real journalOutcomeToSample"
```

---

### Task 3: Report `.md` parser (diff-gate reference)

**Files:**
- Create: `scripts/src/backfill/parseReports.ts`
- Test: `scripts/src/backfill/parseReports.test.ts`

**Interfaces:**
- Produces: `type MdTrade = { symbol: string; cls: string; entryHm: string; reason: string; pnl: number }` and `function parseTradedRows(md: string): MdTrade[]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/src/backfill/parseReports.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTradedRows } from "./parseReports.ts";

const MD = `
| Sym | Class | Gap 8:30 | PM $ | Outcome | Trades | P&L |
| MSTR | rider | +6.92% | $132.1M | traded | 10:10->10:25 stop -$239 | -$239 |
| AMAT | scalper | +0.93% | $163.4M | declined: gap +0.93% < 1.5% | - | - |
| ABVX | rider | +4.76% | $20.9M | traded | 09:50->15:50 eod +$230 | +$230 |
`;

test("parses only traded rows with symbol/class/entryHm/reason/pnl", () => {
  const rows = parseTradedRows(MD);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { symbol: "MSTR", cls: "rider", entryHm: "10:10", reason: "stop", pnl: -239 });
  assert.deepEqual(rows[1], { symbol: "ABVX", cls: "rider", entryHm: "09:50", reason: "eod", pnl: 230 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/parseReports.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser**

Create `scripts/src/backfill/parseReports.ts`:
```ts
export type MdTrade = { symbol: string; cls: string; entryHm: string; reason: string; pnl: number };

// A traded row: | SYM | class | ... | traded | HH:MM->HH:MM <reason> <±$n> | ±$n |
const ROW = /^\|\s*([A-Z]{1,6})\s*\|\s*(rider|scalper|caution|avoid)\s*\|.*\btraded\b.*\|\s*(\d{2}:\d{2})->\d{2}:\d{2}\s+(stop|target|eod|data-end)\b[^|]*\|\s*([+-]?\$?[\d,]+)\s*\|/;

export function parseTradedRows(md: string): MdTrade[] {
  const out: MdTrade[] = [];
  for (const line of md.split("\n")) {
    const m = ROW.exec(line.trim());
    if (!m) continue;
    const pnl = Number(m[5].replace(/[$,]/g, ""));
    out.push({ symbol: m[1], cls: m[2], entryHm: m[3], reason: m[4], pnl });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/parseReports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/src/backfill/parseReports.ts scripts/src/backfill/parseReports.test.ts
git commit -m "feat(backfill): parse traded rows from committed .md reports (diff reference)"
```

---

### Task 4: Diff gate

**Files:**
- Create: `scripts/src/backfill/diff.ts`
- Test: `scripts/src/backfill/diff.test.ts`

**Interfaces:**
- Consumes: `Candidate[]` (Task 2), `MdTrade[]` per date (Task 3).
- Produces: `function diffTradeSets(rerun: {symbol:string;date:string;entryHm:string}[], reference: {symbol:string;date:string;entryHm:string}[]): { matched: string[]; added: string[]; removed: string[] }` keyed on `symbol|date|entryHm`.

- [ ] **Step 1: Write the failing test**

Create `scripts/src/backfill/diff.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTradeSets } from "./diff.ts";

const k = (symbol: string, entryHm: string) => ({ symbol, date: "2026-07-02", entryHm });

test("same trade set = all matched, no add/remove", () => {
  const r = diffTradeSets([k("MSTR","10:10"), k("ABVX","09:50")], [k("ABVX","09:50"), k("MSTR","10:10")]);
  assert.deepEqual(r.added, []); assert.deepEqual(r.removed, []);
  assert.equal(r.matched.length, 2);
});

test("a trade that now appears is flagged as added; one that vanished as removed", () => {
  const r = diffTradeSets([k("MSTR","10:10"), k("NEW","10:00")], [k("MSTR","10:10"), k("GONE","11:00")]);
  assert.deepEqual(r.added, ["NEW|2026-07-02|10:00"]);
  assert.deepEqual(r.removed, ["GONE|2026-07-02|11:00"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the diff gate**

Create `scripts/src/backfill/diff.ts`:
```ts
type Trade = { symbol: string; date: string; entryHm: string };
const key = (t: Trade) => `${t.symbol}|${t.date}|${t.entryHm}`;

export function diffTradeSets(rerun: Trade[], reference: Trade[]) {
  const rerunKeys = new Set(rerun.map(key));
  const refKeys = new Set(reference.map(key));
  const matched = [...rerunKeys].filter((k) => refKeys.has(k));
  const added = [...rerunKeys].filter((k) => !refKeys.has(k)).sort();
  const removed = [...refKeys].filter((k) => !rerunKeys.has(k)).sort();
  return { matched, added, removed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/src/backfill/diff.ts scripts/src/backfill/diff.test.ts
git commit -m "feat(backfill): diff gate on (symbol,date,entryHm) — halt on add/remove"
```

---

### Task 5: Extractor — re-run the engine, write `candidates.json`

**Files:**
- Create: `tools/research/backfill/extract.mjs`

**Interfaces:**
- Produces: `tools/research/backfill/candidates.json` — an array of `Candidate` (Task 2 shape). Reuses `scanDay` / `runEngine` / `alpacaBars` from `tools/research/lib`.

- [ ] **Step 1: Read the existing pipeline to mirror its board+engine wiring**

Run: `sed -n '1,60p' tools/research/pipeline.mjs`
Note the exact imports and the `scanDay`→eligible→`runEngine` sequence; reuse them verbatim below (do not invent a new board).

- [ ] **Step 2: Write the extractor**

Create `tools/research/backfill/extract.mjs`:
```js
// Re-run the CURRENT deterministic engine over the report dates and emit
// per-trade candidates with true entry->stop R and a provenance stamp.
// tools/research is outside the workspace, so this stays plain Node and hands
// off to the scripts/ mapper via candidates.json. Alpaca keys required.
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { requireCreds, alpacaBars } from "../lib/data.mjs";
import { etWindow, etHm, daysBefore } from "../lib/dates.mjs";
import { scanDay } from "../lib/engine.mjs";
import { runEngine } from "../lib/engine.mjs";

const DATES = process.argv.slice(2);
if (DATES.length === 0) { console.error("usage: node backfill/extract.mjs <YYYY-MM-DD> [more dates]"); process.exit(2); }
requireCreds(); // stops with a clear message if ALPACA/FMP keys are unset

const gitSha = execSync("git rev-parse --short HEAD").toString().trim();
const CONFIG_HASH = "engine@" + gitSha; // engine config identity for this run

const candidates = [];
for (const day of DATES) {
  const reportRef = `research/reports/${day}_${day}.md`;
  // Daily bars for prevClose + intraday 5m for the session (mirror pipeline.mjs).
  const dailies = await alpacaBars(["__UNIVERSE__"], "1Day", `${daysBefore(day, 320)}T00:00:00Z`, `${day}T23:59:59Z`, `bf_dailies_${day}`);
  const w = etWindow(day, "04:00", "20:00");
  const pm = await alpacaBars(["__UNIVERSE__"], "5Min", w.start, w.end, `bf_pm_${day}`);
  const dayBarsMap = new Map();
  for (const [s, bars] of pm) dayBarsMap.set(s, bars.map((b) => ({ ...b, hm: etHm(b.t) })));
  const board = scanDay({ day, dailies, dayBarsMap, earnSet: new Set() });
  for (const pick of board.eligible) {
    const cls = pick.cls; // "rider" | "scalper" | ...
    const dayBars = dayBarsMap.get(pick.sym);
    const prevClose = pick.prevClose;
    if (!dayBars || prevClose == null) continue;
    const res = runEngine(cls, dayBars, prevClose);
    for (const t of res.trades) {
      candidates.push({
        symbol: pick.sym, date: day, cls, entryHm: t.entryHm,
        entry: t.entry, exit: t.exit, stop: t.stop, pnl: t.pnl,
        rMultiple: t.rMultiple, reason: t.reason,
        configHash: CONFIG_HASH, gitSha, reportRef,
      });
    }
  }
}
writeFileSync(new URL("./candidates.json", import.meta.url), JSON.stringify(candidates, null, 2));
console.log(`wrote ${candidates.length} candidate trades across ${DATES.length} date(s)`);
```

> NOTE: `scanDay` field names (`board.eligible`, `pick.sym`, `pick.cls`, `pick.prevClose`) must match `tools/research/lib/engine.mjs`. Step 1 is where you confirm them; adjust the destructuring to the real names if they differ. Do not proceed to Step 3 until `scanDay`'s shape is confirmed.

- [ ] **Step 3: Run the extractor on one date (integration)**

Run (keys must be in env):
```bash
node tools/research/backfill/extract.mjs 2026-07-02
```
Expected: `wrote N candidate trades across 1 date(s)` and a `candidates.json` whose rows each have `stop`, `rMultiple`, `configHash`, `gitSha`, `reportRef`. If keys are unset, `requireCreds()` stops with a clear message — surface it, do not fake data.

- [ ] **Step 4: Commit (code only — candidates.json is gitignored)**

```bash
git add tools/research/backfill/extract.mjs
git commit -m "feat(backfill): extractor re-runs current engine -> candidates.json with true R + provenance"
```

---

### Task 6: Orchestrator + staging (no DB writes)

**Files:**
- Create: `scripts/src/backfill/run.ts`

**Interfaces:**
- Consumes: `candidates.json` (Task 5), `toStagedRow` (Task 2), `parseTradedRows` (Task 3), `diffTradeSets` (Task 4), the committed `.md` reports.
- Produces: prints a staging table; writes `tools/research/backfill/insert-plan.json` (array of `StagedRow` for countable, non-dropped rows). Exits non-zero and writes nothing on a diff-gate divergence.

- [ ] **Step 1: Write the orchestrator**

Create `scripts/src/backfill/run.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { toStagedRow, type Candidate } from "./mapper.ts";
import { parseTradedRows } from "./parseReports.ts";
import { diffTradeSets } from "./diff.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const BF = resolve(ROOT, "tools/research/backfill");
const candidates: Candidate[] = JSON.parse(readFileSync(resolve(BF, "candidates.json"), "utf8"));

// 1) Diff gate per date: re-run vs committed .md trade set.
const byDate = new Map<string, Candidate[]>();
for (const c of candidates) (byDate.get(c.date) ?? byDate.set(c.date, []).get(c.date)!).push(c);
let divergence = false;
for (const [date, cs] of byDate) {
  const md = readFileSync(resolve(ROOT, `research/reports/${date}_${date}.md`), "utf8");
  const ref = parseTradedRows(md).map((t) => ({ symbol: t.symbol, date, entryHm: t.entryHm }));
  const rerun = cs.map((c) => ({ symbol: c.symbol, date, entryHm: c.entryHm }));
  const d = diffTradeSets(rerun, ref);
  if (d.added.length || d.removed.length) {
    divergence = true;
    console.error(`\nDIFF-GATE HALT for ${date}:`);
    if (d.added.length) console.error(`  APPEARED (in re-run, not in .md): ${d.added.join(", ")}`);
    if (d.removed.length) console.error(`  VANISHED (in .md, not in re-run): ${d.removed.join(", ")}`);
    console.error(`  -> explain each (gap-through fill / slippage) before staging. No rows written.`);
  }
}
if (divergence) process.exit(1);

// 2) Map + pre-validate; print the staging table.
const staged = candidates.map(toStagedRow);
const countable = staged.filter((r) => r.countable);
const dropped = staged.filter((r) => !r.countable);
const pad = (s: string, n: number) => s.padEnd(n);
console.log("\nSTAGING — replay backfill (tier: RESEARCH/backtest)\n");
console.log(pad("SYMBOL", 8) + pad("DATE", 12) + pad("STRATEGY", 16) + pad("R", 8) + pad("$P&L", 9) + pad("ACTION", 10) + "COUNTABLE");
for (const r of staged) {
  const mo = r.manualOutcome as Record<string, unknown>;
  console.log(
    pad(r.symbol, 8) + pad(r.dedupKey.split("|")[1], 12) +
    pad(String(mo.strategyName ?? "-"), 16) + pad(String(mo.rMultiple ?? "-"), 8) +
    pad(String(mo.pnlDollars ?? "-"), 9) + pad(String(mo.action ?? "-"), 10) +
    (r.countable ? "yes" : `NO (${r.dropReason})`));
}
console.log(`\n${countable.length} countable, ${dropped.length} dropped. Tier default = RESEARCH/backtest.`);
console.log("Review the rows above. Nothing is written until a human says 'write it'.");
writeFileSync(resolve(BF, "insert-plan.json"), JSON.stringify(countable, null, 2));
console.log(`insert-plan.json written (${countable.length} rows) — the writer consumes this on explicit go.`);
```

- [ ] **Step 2: Run the orchestrator (after Task 5 produced candidates.json)**

Run: `pnpm --filter @workspace/scripts run backfill`
Expected: either a `DIFF-GATE HALT` (stop, explain, do not proceed) OR a staging table + `insert-plan.json written (N rows)`. It writes no DB rows.

- [ ] **Step 3: Commit**

```bash
git add scripts/src/backfill/run.ts
git commit -m "feat(backfill): orchestrator — diff gate, map+prevalidate, staging table, insert-plan.json (no DB writes)"
```

---

### Task 7: Human confirmation + write via the Supabase connector (assistant step)

**Files:** none (data operation via connector). Input: `tools/research/backfill/insert-plan.json`.

**Interfaces:**
- Consumes: `insert-plan.json` (Task 6).
- Produces: rows in `journal_entries` (Supabase project `ganihlwaijdxpigssyab`), idempotent on `(symbol, session date, strategy, entryHm)`.

- [ ] **Step 1: Present the staging table to the human and get explicit "write it"**

The Task 6 table IS the `MANUAL_CONFIRMED` act. Do not proceed without an explicit go. If the human reclassifies specific dates to `paper`, change those rows' `mode` to `"REPLAY"` in `insert-plan.json` first (the §3.1 escape hatch) and note it.

- [ ] **Step 2: Read existing dedup keys (idempotency)**

Via the Supabase connector, run:
```sql
SELECT symbol,
       to_char(event_timestamp AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d,
       manual_outcome->>'strategyName' AS strat,
       to_char(event_timestamp AT TIME ZONE 'America/New_York', 'HH24:MI') AS hm
FROM journal_entries
WHERE manual_outcome->>'source' = 'replay_rerun';
```
Build the set of existing `symbol|d|strat|hm` keys. Any `insert-plan.json` row whose `dedupKey` is already present is skipped.

- [ ] **Step 3: Insert only the new rows**

For each not-yet-present row, via the connector:
```sql
INSERT INTO journal_entries (mode, symbol, event_timestamp, manual_outcome, notes)
VALUES ('RESEARCH', $symbol, $eventTimestampUtc::timestamptz, $manualOutcome::jsonb, $notes);
```
(Escape values from the row; `manual_outcome` is the row's `manualOutcome` JSON.) Insert in one batched statement where practical.

- [ ] **Step 4: Confirm the write count**

```sql
SELECT count(*) FROM journal_entries WHERE manual_outcome->>'source' = 'replay_rerun';
```
Expected: equals the number of countable rows staged (minus any skipped duplicates / minus the 1 pre-existing AAPL stub, which has no `source`). Report the exact number and any skips.

- [ ] **Step 5: Record evidence (no code commit — this is data)**

Capture the before/after counts in the eventual PR description.

---

### Task 8: Verifier — recompute the scoreboard, render the `memory` lens flip

**Files:**
- Create: `scripts/src/backfill/verify.ts`
- Test: `scripts/src/backfill/verify.test.ts`

**Interfaces:**
- Consumes: `journal-rows.json` (exported by the assistant via connector), `computeScoreboard` + `journalOutcomeToSample` (`@workspace/copilot-core`), `memoryAgent` (`@workspace/copilot-committee`).
- Produces: `function scoreboardFromRows(rows: {mode:string; manual_outcome:unknown}[]): ReturnType<typeof computeScoreboard>` and a printed per-hypothesis table + the `memory` lens output for `JUMPDAY_RIDER`.

- [ ] **Step 1: Write the failing test**

Create `scripts/src/backfill/verify.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreboardFromRows } from "./verify.ts";

function row(r: number) {
  return { mode: "RESEARCH", manual_outcome: {
    strategyName: "JUMPDAY_RIDER", outcomeConfidence: "MANUAL_CONFIRMED",
    rMultiple: r, action: r >= 0 ? "target_hit" : "stop_hit" } };
}

test("seeded losing rows move JUMPDAY_RIDER off unproven with negative expectancy", () => {
  const rows = Array.from({ length: 20 }, () => row(-1));
  const board = scoreboardFromRows(rows);
  const rider = board.find((s) => s.hypothesisName === "JUMPDAY_RIDER")!;
  assert.notEqual(rider.validationStatus, "unproven");
  assert.ok((rider.expectancyR ?? 0) < 0);
  assert.equal(rider.countableSampleCount, 20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the verifier**

Create `scripts/src/backfill/verify.ts`:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeScoreboard, journalOutcomeToSample, buildCopilotEvent } from "@workspace/copilot-core";
import { memoryAgent } from "@workspace/copilot-committee";

type Row = { mode: string; manual_outcome: unknown };

export function scoreboardFromRows(rows: Row[]) {
  const samples = rows
    .map((r) => journalOutcomeToSample({ mode: r.mode, manualOutcome: r.manual_outcome }))
    .filter((s): s is NonNullable<typeof s> => s !== null);
  return computeScoreboard(samples);
}

// Run directly: reads journal-rows.json exported via the connector.
if (import.meta.filename === process.argv[1]) {
  const path = resolve(import.meta.dirname, "../../../tools/research/backfill/journal-rows.json");
  const rows: Row[] = JSON.parse(readFileSync(path, "utf8"));
  const board = scoreboardFromRows(rows);
  console.log("\nSCOREBOARD (measured from journal):\n");
  for (const s of board) {
    console.log(`${s.hypothesisName.padEnd(28)} ${s.validationStatus.padEnd(22)} ` +
      `n=${s.countableSampleCount} expR=${s.expectancyR ?? "-"}`);
  }
  // Render the memory lens for the rider by feeding the resolved snapshot into a
  // minimal event — the same fields validationResolver would inject live.
  const rider = board.find((s) => s.hypothesisName === "JUMPDAY_RIDER");
  if (rider) {
    const ev = buildCopilotEvent({
      symbol: "DEMO", mode: "RESEARCH", dataSource: "backfill-verify", bars: [],
      validation: { status: rider.validationStatus, sampleCount: rider.countableSampleCount, expectancyR: rider.expectancyR },
    });
    const read = memoryAgent(ev);
    console.log(`\nMEMORY LENS (JUMPDAY_RIDER): ${read.status} — "${read.headline}"`);
    for (const w of read.warnings) console.log(`  ! ${w}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/scripts exec node --import tsx --test src/backfill/verify.test.ts`
Expected: PASS.

- [ ] **Step 5: After Task 7, export journal rows via the connector and run the live verifier**

Assistant exports via connector to `tools/research/backfill/journal-rows.json`:
```sql
SELECT mode, manual_outcome FROM journal_entries WHERE manual_outcome->>'source' = 'replay_rerun';
```
Then run: `pnpm --filter @workspace/scripts run backfill:verify`
Expected: the scoreboard table shows `JUMPDAY_RIDER` at `no_edge` or `insufficient_sample` (per §8), `n` = the written count, and the memory lens prints a measured (non-`unproven`) read. This is the payoff — the read→learn path moving on real data.

- [ ] **Step 6: Commit**

```bash
git add scripts/src/backfill/verify.ts scripts/src/backfill/verify.test.ts
git commit -m "feat(backfill): verifier — recompute scoreboard + render memory lens flip on real journal data"
```

---

## Self-Review

**Spec coverage:** §2 re-run/true-R → Tasks 1,5. §3 payload/mappings/provenance → Task 2. §3.1 backtest tier + escape hatch → Global Constraints + Task 2 (`mode:"RESEARCH"`) + Task 7 Step 1. §4 components 1-7 → Tasks 1-8. §5 data flow → Tasks 5→6→7→8. §6 error handling (keys, diff, non-countable, collision) → Task 5 Step 3, Task 6 Step 1, Task 2 (`dropReason`), Task 7 Step 2. §7 testing → each task's tests + Task 8. §8 expected reading → Task 8 Step 5. §9 commit/coordination → per-task commits + Global Constraints. **No gaps.**

**Placeholder scan:** the only "confirm the real shape" is Task 5 Step 1 (`scanDay` field names) — deliberate, because `scanDay`'s output shape must be read from source, not guessed; the step names exactly what to confirm and blocks progress until it is. No `TBD`/`add error handling`/`similar to`.

**Type consistency:** `Candidate` (Task 2) is produced by Task 5 and consumed by Tasks 6/8. `StagedRow` (Task 2) consumed by Task 6. `toStagedRow` / `actionFromReason` / `timeWindowFromHm` (Task 2), `parseTradedRows` (Task 3), `diffTradeSets` (Task 4), `scoreboardFromRows` (Task 8) — names match across producer/consumer.
