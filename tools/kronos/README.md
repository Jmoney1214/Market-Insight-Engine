# Kronos Forecaster + Calibrator

The Forecaster runs on the Mac (MPS); everything else runs in the api-server.

## Pipeline

1. **Premarket batch** (`forecast_batch.py`, ~08:00 ET): pulls Alpaca SIP 5-min
   bars for the morning-scan candidates, samples N independent Kronos paths
   per symbol, computes `p_up` / quantile paths / dispersion plus the exact
   `input_bars_hash`, and POSTs to `POST /api/kronos/forecasts`.
2. **Calibrator sweep** (api-server, hourly after close): grades every
   forecast whose window has closed against the realized session close —
   direction hit + Brier score land on the forecast row.
3. **THE HARD GATE** (`GET /api/kronos/:symbol`): the forecast field stays
   `null` with `gated: true` until the rolling 90-day calibration passes
   (≥30 graded forecasts, Brier ≤ 0.25, hit rate ≥ 0.5). The Desk never
   renders an uncalibrated Kronos. `GET /api/kronos/calibration` shows the
   report at any time.

## One-time Mac setup

```
cd ~/kronos && pip install -r requirements.txt && pip install requests pandas numpy
```

## Run the premarket batch

```
cd ~/Market-Insight-Engine/tools/kronos
KRONOS_REPO=~/kronos MIE_API_URL=http://localhost:3001 python3 forecast_batch.py
```

Override the symbol set with `KRONOS_SYMBOLS=RGTI,IONQ,SOUN` when needed;
otherwise it uses the morning scan's premarket picks. Schedule with cron:

```
0 8 * * 1-5 cd ~/Market-Insight-Engine/tools/kronos && KRONOS_REPO=~/kronos python3 forecast_batch.py >> /tmp/kronos_batch.log 2>&1
```
