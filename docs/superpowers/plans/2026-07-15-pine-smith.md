# pine-smith Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Claude Code subagent (`pine-smith`) that generates, fixes, ports, and reviews TradingView Pine v6 — closing the compile loop live via the TradingView MCP — grounded in a shared, version-controlled knowledge pack that includes instrument-class awareness and backtestable-strategy patterns.

**Architecture:** A single self-contained agent definition (`.claude/agents/pine-smith.md`) plus a markdown knowledge pack under `tools/pine/reference/`. The agent carries the workflow; the pack carries the *rules* and is also read by the existing `pine-reviewer`. A small Node structural-validation test (`node --test`) guards the pack's integrity in CI; functional correctness is verified by live agentic acceptance runs against the TradingView MCP.

**Tech Stack:** Markdown (agent + knowledge pack), Node.js ESM + `node:test` (structural validation — matches existing `tools/research/*.mjs` convention), TradingView MCP `pine_*` / `data_get_*` tools (live compile + backtest read-back), Pine Script **v6**.

## Global Constraints

- **Pine version:** v6 only. No v7 exists (July 2026). Every generated/ported script targets v6 semantics (strict booleans, `1/2 = 0.5`).
- **Object limits (verbatim):** `max_lines_count`/`max_boxes_count`/`max_labels_count` default **50**, max **500**; `max_polylines_count` max **100**.
- **Grounding source of truth:** TradingView v6 reference manual + release notes. **Do NOT** wire in Hugging Face datasets/fine-tunes (v5, low quality).
- **`request.footprint()`** is **Premium-gated**; its accessor spellings are **unverified** — reference it as "verify in manual," never build features on it blindly.
- **Knowledge pack location:** `tools/pine/reference/`. **Agent location:** `.claude/agents/pine-smith.md`. Everything version-controlled.
- **Autonomy/safety:** default `pine_new` (never clobber saved scripts); `pine_save` only on explicit user OK; cap the fix loop at ~6 iterations; never claim a green compile that didn't happen.
- **Commits:** one commit per task, only when running the plan (do not auto-commit unrelated staged files — use explicit pathspecs).

---

### Task 1: Pack scaffold directory + structural validation test (failing first)

**Files:**
- Create: `tools/pine/reference/validate.test.mjs`
- Create: `tools/pine/reference/.gitkeep` (temporary, removed once files exist)

**Interfaces:**
- Produces: `EXPECTED_FILES` (array of pack-relative paths) and `AGENT_PATH` constant that later tasks must satisfy. The test is the executable definition of "the pack is complete."

- [ ] **Step 1: Write the failing test**

```javascript
// tools/pine/reference/validate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));          // tools/pine/reference
const REPO = join(HERE, '..', '..', '..');                    // repo root
const AGENT_PATH = join(REPO, '.claude', 'agents', 'pine-smith.md');

const EXPECTED_FILES = [
  'README.md',
  'pine-v6-core.md',
  'pine-v6-2026-features.md',
  'pine-object-limits.md',
  'pine-correctness-checklist.md',
  'instrument-classes.md',
  'strategy-backtest.md',
  'troubleshooting.md',
  'patterns/orb-v6.md',
  'patterns/vwap-ema-scalp-v6.md',
  'sources.md',
  'research-2026-07-15.md',
];

const read = (p) => readFileSync(join(HERE, p), 'utf8');

test('all pack files exist', () => {
  for (const f of EXPECTED_FILES) assert.ok(existsSync(join(HERE, f)), `missing ${f}`);
});

test('agent definition exists with required frontmatter', () => {
  assert.ok(existsSync(AGENT_PATH), 'missing .claude/agents/pine-smith.md');
  const src = readFileSync(AGENT_PATH, 'utf8');
  assert.match(src, /name:\s*pine-smith/);
  assert.match(src, /description:/);
  assert.match(src, /pine_smart_compile/, 'agent must have pine compile MCP tools');
  assert.match(src, /pine_get_errors/);
  assert.match(src, /data_get_strategy_results/, 'agent must read backtest results');
});

test('README links to every pack file', () => {
  const readme = read('README.md');
  for (const f of EXPECTED_FILES.filter((x) => x !== 'README.md')) {
    assert.ok(readme.includes(f), `README missing link to ${f}`);
  }
});

test('object-limits file states the caps verbatim', () => {
  const s = read('pine-object-limits.md');
  assert.match(s, /max_boxes_count/);
  assert.match(s, /\b500\b/);
  assert.match(s, /Too many drawings/i);
});

test('instrument-classes covers all six archetypes', () => {
  const s = read('instrument-classes.md').toLowerCase();
  for (const kw of ['nvda', 'penny', 'mid-cap', 'futures', 'crypto', 'forex']) {
    assert.ok(s.includes(kw), `instrument-classes missing ${kw}`);
  }
  assert.ok(s.includes('syminfo.mintick'), 'must reference syminfo.mintick');
});

test('strategy-backtest covers orders + realism + read-back', () => {
  const s = read('strategy-backtest.md');
  for (const kw of ['strategy.entry', 'strategy.exit', 'commission', 'slippage', 'data_get_trades']) {
    assert.ok(s.includes(kw), `strategy-backtest missing ${kw}`);
  }
});

test('correctness checklist has the core rules and is referenced by pine-reviewer', () => {
  const s = read('pine-correctness-checklist.md').toLowerCase();
  for (const kw of ['repaint', 'na', 'session', 'lookahead']) {
    assert.ok(s.includes(kw), `checklist missing ${kw}`);
  }
  const reviewer = readFileSync(join(REPO, '.claude', 'agents', 'pine-reviewer.md'), 'utf8');
  assert.match(reviewer, /tools\/pine\/reference\/pine-correctness-checklist\.md/, 'pine-reviewer must reference shared checklist');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/pine/reference/validate.test.mjs`
Expected: FAIL — every assertion fails ("missing README.md", etc.) because nothing exists yet.

- [ ] **Step 3: Commit the failing test + scaffold**

```bash
touch tools/pine/reference/.gitkeep
git add tools/pine/reference/validate.test.mjs tools/pine/reference/.gitkeep
git commit -m "test: pine-smith knowledge-pack structural validation (failing)"
```

---

### Task 2: Shared correctness checklist + wire pine-reviewer

**Files:**
- Create: `tools/pine/reference/pine-correctness-checklist.md`
- Modify: `.claude/agents/pine-reviewer.md` (add a line pointing to the shared checklist)

**Interfaces:**
- Produces: the canonical rule list both `pine-reviewer` and `pine-smith` cite. Path is load-bearing: `tools/pine/reference/pine-correctness-checklist.md`.

- [ ] **Step 1: Read the existing reviewer to extract its rules**

Run: `cat .claude/agents/pine-reviewer.md`
Note the specific checks it already enforces (na-poisoning, repainting, session/extended-hours, fill-relative exits, v5 leftovers) so the extracted file is a faithful superset, not a divergent copy.

- [ ] **Step 2: Author `pine-correctness-checklist.md`**

Required sections (each a `## ` heading) with concrete, testable checks:
- `## Repainting` — no `request.security(..., lookahead=barmerge.lookahead_on)` for signals; no using `[0]` of a higher-TF series that finalizes late; historical vs realtime bar divergence.
- `## na-poisoning` — guard `na` before arithmetic; `nz()` where a running value seeds; `var` init values; `ta.*` warm-up bars.
- `## Session / RTH / extended hours` — use IANA tz session strings (`"0930-0945", "America/New_York"`), not fixed UTC offsets; handle ETH vs RTH; new-day detection via `ta.change(time("D"))`.
- `## Fill-relative exits` — stops/targets computed off fill price / `strategy.position_avg_price`, not off `close`.
- `## Lookahead & future leaks` — `barmerge.lookahead_off`; no `calc_on_every_tick` assumptions baked into signals.
- `## v6 compliance` — strict booleans, `1/2 = 0.5`, no v5 leftovers.
- `## Object limits` — cross-reference `pine-object-limits.md`.

Each check as a one-line imperative + a one-line "how to spot it." Must contain the literal words `repaint`, `na`, `session`, `lookahead` (test asserts these).

- [ ] **Step 3: Wire pine-reviewer to the shared file**

Add to `.claude/agents/pine-reviewer.md` (near its review criteria):
```markdown
Authoritative rule source: read `tools/pine/reference/pine-correctness-checklist.md` and apply every check there. That file is shared with pine-smith so both agents enforce identical rules.
```

- [ ] **Step 4: Run the checklist test**

Run: `node --test tools/pine/reference/validate.test.mjs --test-name-pattern "correctness checklist"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/pine/reference/pine-correctness-checklist.md .claude/agents/pine-reviewer.md
git commit -m "feat: shared pine correctness checklist, wired into pine-reviewer"
```

---

### Task 3: Pine v6 core + 2026 features + object limits + troubleshooting

**Files:**
- Create: `tools/pine/reference/pine-v6-core.md`
- Create: `tools/pine/reference/pine-v6-2026-features.md`
- Create: `tools/pine/reference/pine-object-limits.md`
- Create: `tools/pine/reference/troubleshooting.md`

**Interfaces:**
- Consumes: research facts from Task 7's `research-2026-07-15.md` (author in parallel; facts below are self-contained so ordering doesn't block).

- [ ] **Step 1: Author `pine-v6-core.md`**
Sections: `## Declaration` (`indicator()` vs `strategy()` params), `## Types & series` (series vs simple/input/const, `var`/`varip`), `## v6 semantics` (strict bool — no implicit int/float→bool; `1/2 = 0.5`; `dynamic_requests`), `## Common built-ins` (`ta.*`, `math.*`, `request.security` safe form, `time()`/session strings, `syminfo.*`), `## Plotting` (`plot`, `line`/`box`/`label`, `linestyle`).

- [ ] **Step 2: Author `pine-v6-2026-features.md`**
List, each with a one-line "when to use" + "status" flag:
- `request.footprint()` + `footprint`/`volume_row` types; accessors `buy_volume/sell_volume/delta/poc/vah/val` — **Status: Premium-gated; current-timeframe only (no TF arg); accessor spellings VERIFY in v6 manual before coding.**
- Multiline strings `"""…"""` (Apr 2026). UDT-aware `array.sort(sort_field=…)` (Apr 2026). `plot(linestyle=…)` (Sep 2025). `time(timeframe_bars_back=…)` (Oct 2025). Max string length 40,960 (Aug 2025). `syminfo.isin`, `syminfo.current_contract`, tick-level `bid`/`ask`.

- [ ] **Step 3: Author `pine-object-limits.md`**
Must contain (test asserts `max_boxes_count`, `500`, `Too many drawings`):
- The caps table (verbatim from Global Constraints).
- Why it's a **runtime** (not compile) error; the exact "Too many drawings, cannot clean oldest" wording.
- Mitigations: raise caps to 500; **recycle a fixed pool** of box/line objects (don't `box.new()` every bar); cap sessions/rows drawn; bound lookback; the `max_bars_back` interaction that blocks GC.

- [ ] **Step 4: Author `troubleshooting.md`**
- `## "Script could not be translated from: |B|…|E|"` — the `|B|…|E|` payload is a **compiled/serialized blob**, not source → a stale/corrupted stored compile or engine-version desync. Fixes in order: re-open source in Pine Editor and re-save/recompile; remove & re-add the indicator fresh; hard-refresh (Cmd+Shift+R); "Convert code to v6"; re-add from original publication. **This is the ORB Matrix diagnosis.**
- `## Indicator not drawing / frozen` — errored study freezes last graphics; check `hasError`/status.

- [ ] **Step 5: Commit**

```bash
git add tools/pine/reference/pine-v6-core.md tools/pine/reference/pine-v6-2026-features.md tools/pine/reference/pine-object-limits.md tools/pine/reference/troubleshooting.md
git commit -m "feat: pine v6 core, 2026 features, object limits, troubleshooting refs"
```

---

### Task 4: instrument-classes.md (NVDA ≠ penny stock)

**Files:**
- Create: `tools/pine/reference/instrument-classes.md`

**Interfaces:**
- Produces: the archetype→defaults mapping the agent uses at runtime to pick stop basis, order type, slippage/commission, timeframe guardrails.

- [ ] **Step 1: Author the file**
Must contain (test asserts): `nvda`, `penny`, `mid-cap`, `futures`, `crypto`, `forex`, and `syminfo.mintick`.
Required content:
- `## How to classify` — read `chart_get_state` + `symbol_info` + `quote_get`; branch on `syminfo.type`, exchange, and current price; ask the user if there is no chart context.
- `## Archetypes` — a table with columns **Class | Examples | Behavior | Pine defaults**, one row each:
  - Mega/large-cap liquid (NVDA/AAPL/SPY/QQQ): tight spread, `mintick` 0.01, small %/day → ATR/point stops, sec–min OK, low slippage (~1 tick) + small per-share commission.
  - Mid-cap ($10–100): moderate → ATR stops, minute charts, moderate slippage.
  - Low-priced/small-cap mover/penny (<$5–10; OI $9, ELVA $11): wide relative spread, thin/gappy, 10–100% moves, whole/half-$ magnets, LULD halt risk, market orders slip → **percent/wide-ATR stops, no sub-minute scalps, high slippage+commission in backtest, size down, RVOL filter, limit orders, gap handling.**
  - Futures (ES/NQ/CL): `syminfo.pointvalue`, ~23h, RTH vs ETH → tick stops, per-contract commission, session-aware.
  - Crypto (BTC/ETH): 24/7, no sessions → percent stops, no session gate.
  - Forex (EURUSD): pips, session overlaps → pip stops, London/NY logic.
- `## Runtime application` — the 4-step flow from spec §4 (classify → select defaults → write `syminfo.*`-adaptive Pine, e.g. percent stop when `close < 5` else ATR → state assumptions in hand-off) with a short Pine snippet showing an instrument-adaptive stop.

- [ ] **Step 2: Run the instrument test**

Run: `node --test tools/pine/reference/validate.test.mjs --test-name-pattern "instrument-classes"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tools/pine/reference/instrument-classes.md
git commit -m "feat: instrument-class awareness reference (NVDA vs penny defaults)"
```

---

### Task 5: strategy-backtest.md (buy/sell orders + realism + read-back)

**Files:**
- Create: `tools/pine/reference/strategy-backtest.md`

- [ ] **Step 1: Author the file**
Must contain (test asserts): `strategy.entry`, `strategy.exit`, `commission`, `slippage`, `data_get_trades`.
Required sections:
- `## strategy() declaration` — `initial_capital`, `default_qty_type`/`default_qty_value`, `commission_type`/`commission_value`, `slippage`, `pyramiding`, `process_orders_on_close`, `calc_on_every_tick` — **set per instrument class (link instrument-classes.md).**
- `## Orders` — `strategy.entry` (long/short, `limit`/`stop`), `strategy.exit` (`stop`/`limit`/`trail_points`/`trail_offset`, OCO brackets), `strategy.close`, `strategy.cancel`, named IDs, `strategy.position_size`/`strategy.position_avg_price`.
- `## Anti-cheat` — `barmerge.lookahead_off`, no future-peek `request.security`, fill-relative exits, repaint checks (link checklist).
- `## Reading results back` — after clean compile, call `data_get_strategy_results`, `data_get_trades`, `data_get_equity`; report net / profit factor / win rate / trades / max DD + the trade list.
- `## Node parity (Port mode)` — generate the `strategy()` twin from `tools/research/lib/engine.mjs`, run the Node harness via Bash, diff trades vs Strategy-Tester trades within tolerance (pine-twin-writer discipline).
- Include a **complete minimal `strategy()` example** with entry+bracket-exit that a reader could paste.

- [ ] **Step 2: Run the strategy test**

Run: `node --test tools/pine/reference/validate.test.mjs --test-name-pattern "strategy-backtest"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tools/pine/reference/strategy-backtest.md
git commit -m "feat: backtestable strategy() reference with order + parity patterns"
```

---

### Task 6: Reference patterns (ORB v6 + VWAP/EMA scalp)

**Files:**
- Create: `tools/pine/reference/patterns/orb-v6.md`
- Create: `tools/pine/reference/patterns/vwap-ema-scalp-v6.md`

- [ ] **Step 1: Author `patterns/orb-v6.md`**
A complete, object-limit-safe v6 ORB reference: `## Session detection` (`time(timeframe.period, "0930-0945", "America/New_York")`), `## Opening range` (`var orHigh/orLow` rolled inside window, frozen at close), `## Break / retest / confirm` (state machine), `## Levels without object blowup` (create line/box once per session, `line.set_xy2` to extend — don't `line.new()` per bar), `## Alerts` (`alertcondition` + dynamic `alert()`), plus a note referencing the MIT v6 ORB repo (`Mrshahidali420/ORB-Multi-Model-Indicator`). Include a full compiling code block.

- [ ] **Step 2: Author `patterns/vwap-ema-scalp-v6.md`**
A liquid-name intraday starter (session VWAP + 1σ bands + EMA9 + volume filter), with an instrument-class note (this pattern suits mega/large-cap, NOT thin pennies). Full compiling code block.

- [ ] **Step 3: Commit**

```bash
git add tools/pine/reference/patterns/orb-v6.md tools/pine/reference/patterns/vwap-ema-scalp-v6.md
git commit -m "feat: v6 ORB + VWAP/EMA scalp reference patterns"
```

---

### Task 7: Research report, sources, README index (makes structural test green)

**Files:**
- Create: `tools/pine/reference/research-2026-07-15.md`
- Create: `tools/pine/reference/sources.md`
- Create: `tools/pine/reference/README.md`
- Delete: `tools/pine/reference/.gitkeep`

- [ ] **Step 1: Save the research verbatim**
Paste the Pine-2026 research report (from the brainstorming subagent) into `research-2026-07-15.md`, keeping its verification flags. Put its URL list into `sources.md`.

- [ ] **Step 2: Author `README.md` index**
An index that **links to every other pack file** (test asserts each filename appears): one line per file describing its purpose, a "shared with pine-reviewer" note on the checklist, and a "how to keep current" note (update on each Pine release-notes change).

- [ ] **Step 3: Remove scaffold + run the FULL structural test**

```bash
git rm tools/pine/reference/.gitkeep
node --test tools/pine/reference/validate.test.mjs
```
Expected: ALL tests PASS except the `pine-smith` agent frontmatter test (Task 8).

- [ ] **Step 4: Commit**

```bash
git add tools/pine/reference/research-2026-07-15.md tools/pine/reference/sources.md tools/pine/reference/README.md
git commit -m "docs: pine research report, sources, and pack README index"
```

---

### Task 8: The pine-smith agent definition

**Files:**
- Create: `.claude/agents/pine-smith.md`

**Interfaces:**
- Consumes: every file in `tools/pine/reference/` (the agent's system prompt directs it to read the relevant ones per mode).

- [ ] **Step 1: Write the agent frontmatter + system prompt**
Frontmatter (must satisfy Task 1's test — includes `name: pine-smith`, a `description`, and tools `pine_smart_compile`, `pine_get_errors`, `data_get_strategy_results`):
```markdown
---
name: pine-smith
description: Generates, fixes/migrates, ports, and reviews TradingView Pine v6. Closes the compile loop live via the TradingView MCP (write → inject → compile → read errors → self-fix), adapts every script to the instrument class of the ticker, and produces backtestable strategy() scripts with real buy/sell orders. Use for any new/broken Pine indicator or strategy.
tools: Read, Glob, Grep, Edit, Write, Bash, pine_new, pine_open, pine_set_source, pine_smart_compile, pine_compile, pine_check, pine_analyze, pine_get_errors, pine_get_console, pine_get_source, pine_save, pine_list_scripts, chart_get_state, symbol_info, quote_get, data_get_strategy_results, data_get_trades, data_get_equity, chart_manage_indicator, capture_screenshot
model: opus
---
```
System-prompt body (the workflow from spec §6/§7/§8): the four modes; **always classify the instrument first** (read `tools/pine/reference/instrument-classes.md`); ground every script in the pack; the closed loop with a **~6-iteration cap**; self-review against `pine-correctness-checklist.md`; for strategies read results via `data_get_strategy_results`/`data_get_trades`; safety rules (default `pine_new`, no `pine_save` without OK, never fake a green compile); the structured hand-off format.

- [ ] **Step 2: Run the FULL structural test — now fully green**

Run: `node --test tools/pine/reference/validate.test.mjs`
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/pine-smith.md
git commit -m "feat: pine-smith agent definition"
```

---

### Task 9: Live acceptance runs (agentic verification via TradingView MCP)

**Files:** none created — this task exercises the agent end-to-end. Record outcomes in `docs/superpowers/plans/2026-07-15-pine-smith-acceptance.md`.

> These are **live-MCP** checks (require the TradingView desktop session), not unit tests. Run each by dispatching `pine-smith`; a check passes only on the stated observable outcome.

- [ ] **Step 1 — Generate:** Ask pine-smith for "an opening-range breakout with retest confirmation." PASS if it reaches a clean `pine_smart_compile` (empty `pine_get_errors`) and its self-review flags no repaint/na/session issues.
- [ ] **Step 2 — Fix (Leviathan):** Point it at the Leviathan object-limit runtime crash. PASS if the fixed script sets caps to 500 + bounds drawings and runs without the "too many drawings" error on a 15s chart.
- [ ] **Step 3 — Instrument awareness:** Ask for "VWAP mean-reversion" once with NVDA as the chart symbol and once with a sub-$5 mover. PASS if the two outputs differ in stop basis, slippage/commission, and timeframe guardrail — traceable to `instrument-classes.md`.
- [ ] **Step 4 — Backtestable strategy:** Ask for a `strategy()` version of Step 1. PASS if it runs in the Strategy Tester and pine-smith reports metrics read back via `data_get_strategy_results`/`data_get_trades`.
- [ ] **Step 5 — Port + parity:** Ask it to port one `tools/research` engine to a Pine `strategy()` twin. PASS if trades diff within tolerance against the Node harness (`node tools/research/...`).
- [ ] **Step 6:** Write the acceptance results file and commit.

```bash
git add docs/superpowers/plans/2026-07-15-pine-smith-acceptance.md
git commit -m "docs: pine-smith live acceptance results"
```

---

## Self-Review

**1. Spec coverage:**
- §1 purpose / 4 decisions → Task 8 (agent), whole plan.
- §2 storage inventory → Tasks 1–8 create every listed file; Task 1 test asserts the set.
- §3 knowledge contents → Tasks 2–7 (one file group per task).
- §4 instrument-class awareness → Task 4 + Task 9 Step 3.
- §5 backtestable strategies → Task 5 + Task 9 Step 4.
- §6 closed loop / §7 communication / §8 safety → Task 8 system prompt + Task 9 acceptance.
- §9 YAGNI → Global Constraints (no HF, no footprint-feature-building).
- §10 acceptance tests → Task 9 Steps 1–5 (1:1 mapping).
No gaps.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases." Prose tasks specify exact required sections + the literal facts/keywords each must contain, which the Task 1 test enforces mechanically.

**3. Type consistency:** `EXPECTED_FILES` in Task 1 exactly matches the files created in Tasks 2–8. Agent tool names in Task 8 frontmatter match those asserted in Task 1 (`pine_smart_compile`, `pine_get_errors`, `data_get_strategy_results`) and used in Task 5/9 (`data_get_trades`). Checklist path string is identical in Task 2 file, Task 2 reviewer edit, and Task 1 assertion (`tools/pine/reference/pine-correctness-checklist.md`).
