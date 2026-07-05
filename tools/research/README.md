# Research harnesses (offline backtesting)

Node scripts that test strategy hypotheses against real Alpaca SIP bars.
They power the findings in [`../../research/findings.md`](../../research/findings.md)
and are the working tools of the `backtest-runner` and `replay-grader`
subagents (`.claude/agents/`).

| Script | What it does |
|---|---|
| `class_backtest.mjs` | Per-symbol engine backtests (rider / scalper / ORB) with class thresholds; exports `run(symbol, cfg)` and `features(symbol)` |
| `pipeline.mjs` | Full-pipeline PIT backtest: 8:30 ET scanner replay → class badges → badge-matched engine, day by day (edit `DAYS`) |

## Rules of the house

- **Credentials from env only**: `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`,
  `FMP_API_KEY`. Never commit keys.
- Point-in-time discipline, pessimistic fills (stop-before-target, costs
  modeled), train/validate splits — see `research/findings.md` for the
  standing rules and validated class boundaries.
- Bars cache to `cache/` (gitignored); delete it to force refetch.

## Run

```sh
ALPACA_API_KEY_ID=... ALPACA_API_SECRET_KEY=... FMP_API_KEY=... \
  node tools/research/pipeline.mjs
```
