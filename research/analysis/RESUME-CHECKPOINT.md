# Resume checkpoint — enhancement work

**Saved:** end of session 2026-07-06 (first live-scan Monday). **Resume via**
`claude --teleport session_01E1m84ErGptibGL3vgH99BU` from a local clone, or a
fresh session reading this file. **main @ `6e46af0`**, working branch
`claude/repository-analysis-synthesis-4dw5i1` reset onto it, tree clean.

## The plan (audit + external-repo analysis converged on this order)

Two independent analyses — the 9-seam adversarial audit (`seam-audit-report.md`)
and the external trading-skill-repo comparison (`external-repo-analysis.md`) —
agreed on the same priority chain. Backtest truth must come before measured-edge
work, because the memory loop consumes backtest numbers.

| Step | What | Status |
|---|---|---|
| Batch 1 | Backtest truth: cache-key (C1), gap-through stops (H5), EOD slippage | ✅ merged #22 |
| Step 3 | **Wire the memory loop** — measured edge → live events; memoryAgent DEGRADED→real; L4 unlocks on `paper_validated` | ✅ merged #23 |
| **Step 4** | **Deterministic regime** — `lib/copilot-core/src/regime.ts` from bars (OPENING_DRIVE / ORB_WINDOW / TREND_DAY / RANGE_DAY / CHOP / LOW_VOL_AFTERNOON / POWER_HOUR / NEWS_SPIKE); flip `regimeAgent` DEGRADED→real | ⏭️ NEXT (task #20) |
| Step 5 | **Regime-weighted credibility** — replace trigger-count `0.35·primary + 0.1·refinement` (triggers.ts:670) with `measuredEdge·0.45 + regimeFit·0.20 + triggerStack·0.20 + participation·0.10 + rr·0.05`. Gated behind steps 3+4 (both prerequisites now: 3 done, 4 next) | ⏭️ task #21 |

Also queued: **remaining audit batches 2–3** (task #22) — live↔harness
reunification (H1 no eligible pipeline in scan.ts, H2 $150 ceiling, H3 dollarVol
base, H4 partial-bar contamination) and the accountability loop (H7 scorecard
union-of-boards, H8 scale-to-zero, H9 grading starvation, H10 partial snapshots,
H11 JSON error middleware, holiday calendar). Cap each batch with a twin-contract
test so scan.ts / engine.mjs / Pine drift can't silently return.

## Standing facts (don't re-derive)

- **Data contract (hard):** Alpaca SIP = only bar source (feed=sip,
  adjustment=split). FMP = screener/earnings/enrichment only. No Yahoo (one
  env-gated exception). Credentials env-only, never committed.
- **Safety (permanent):** no execution, no order code; deterministic core is the
  source of truth; LLMs may polish 3 prose fields only; guardrails re-validate.
- **Two sessions, one branch:** the local teleported terminal (TradingView MCP)
  pushes parity work to this same branch. Always `git pull` before pushing; merge
  green PRs and reset the branch onto main afterward.
- **Merge flow:** draft PR → ready → Gemini review (bot sunsets 2026-07-17;
  pine-reviewer + code-review skills are the replacement) → address → squash-merge
  → reset branch onto origin/main + force-with-lease.

## Live tooling built this session (in tools/research/, all gitignore scratch)

- `pipeline.mjs` — full PIT backtest (needs a completed RTH session; pre-open use
  `scratch/today_board.mjs`).
- `scratch/today_board.mjs` / `today_board_nasdaq.mjs` — the 8:30 categorized
  board via the repo `scanDay` (NASDAQ variant reuses cached bars).
- `scratch/midday_screen.mjs` — repo classifier re-anchored to current intraday.
- `scratch/pullback_check.mjs` / `today_triggers.mjs` — did a name actually fire
  the rider trigger.
- `crosscheck.mjs` — Alpaca↔FMP data verifier (house rule 6).
- Pine scripts now draw big BUY/EXIT labels + stop/target lines (visual only).

## July 6 result (reference)

Board was crypto-miner + semi heavy (all riders). Rider had a **losing day
despite the stocks rising**: only IREN triggered-and-rode (+$95); CIFR/AXTI/
WULF/AMKR/HUT/APLD/AMD all stopped out on the whipsaw (~−$1,400 net). Lesson
confirmed: the prettiest gaps (IREN, WULF) are the worst entries; quiet CIFR/AXTI
are the real riders. User traded HIMS/WEN/FRMI instead — all outside the
gap-up-long envelope (HIMS is NYSE + didn't gap; WEN fell; FRMI cheap/caution).

## Replit (user-side, unconfirmed)

Pull main, `pnpm --filter @workspace/findesk run build`, restart both workflows.
Committee runs deterministically with no keys; enable an Anthropic AI integration
+ `COPILOT_LLM_PROVIDER=anthropic` for prose polish. Model ids in
committeeProvider.ts are a generation old (bump `claude-sonnet-4-6`→current) —
noted, not yet done.
