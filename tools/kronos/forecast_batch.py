#!/usr/bin/env python3
"""
Kronos Forecaster - premarket batch (runs on the Mac, MPS).

Pulls Alpaca SIP bars for the morning-scan candidates (or an explicit symbol
list), samples N independent Kronos paths per symbol, and POSTs forecasts to
the desk API, which stores them in the waiting kronos_forecasts table. The
Kronos Calibrator grades every forecast after its window closes, and the Desk
renders Kronos output ONLY after rolling calibration passes - this script
never bypasses that gate; it only produces gradable forecasts.

Environment (all already in the Market-Insight-Engine .env):
  ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY   Alpaca market data (SIP)
  MIE_API_URL      default http://localhost:3001
  MIE_API_TOKEN    optional agent token header
  KRONOS_REPO      path to the Kronos fork checkout (default ~/kronos)
  KRONOS_SYMBOLS   optional comma list; default = /api/scan/premarket picks
  KRONOS_SAMPLES   sampled paths per symbol (default 30)
  KRONOS_HORIZON   forecast horizon in bars (default 24 x 5min = 2 hours)

Usage (premarket, e.g. 08:00 ET via launchd/cron):
  cd ~/Market-Insight-Engine/tools/kronos && python3 forecast_batch.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

KRONOS_REPO = os.path.expanduser(os.environ.get("KRONOS_REPO", "~/kronos"))
sys.path.append(KRONOS_REPO)
from model import Kronos, KronosTokenizer, KronosPredictor  # noqa: E402

MIE_API_URL = os.environ.get("MIE_API_URL", "http://localhost:3001").rstrip("/")
MIE_API_TOKEN = os.environ.get("MIE_API_TOKEN", "")
ALPACA_KEY = os.environ["ALPACA_API_KEY_ID"]
ALPACA_SECRET = os.environ["ALPACA_API_SECRET_KEY"]

BAR_TIMEFRAME = "5Min"
LOOKBACK_BARS = 400          # model context (max_context=512)
HORIZON_BARS = int(os.environ.get("KRONOS_HORIZON", "24"))   # 24 x 5min = 2h
SAMPLE_COUNT = int(os.environ.get("KRONOS_SAMPLES", "30"))
MODEL_VERSION = "kronos-small-fork-1"


def api_headers() -> dict:
    headers = {"content-type": "application/json"}
    if MIE_API_TOKEN:
        headers["x-agent-token"] = MIE_API_TOKEN
    return headers


def scan_candidates() -> list[str]:
    explicit = os.environ.get("KRONOS_SYMBOLS", "").strip()
    if explicit:
        return [s.strip().upper() for s in explicit.split(",") if s.strip()]
    resp = requests.get(f"{MIE_API_URL}/api/scan/premarket", headers=api_headers(), timeout=30)
    resp.raise_for_status()
    data = resp.json()
    picks = data.get("picks") or data.get("candidates") or []
    symbols = []
    for p in picks:
        sym = p.get("symbol") or p.get("ticker") if isinstance(p, dict) else None
        if sym:
            symbols.append(str(sym).upper())
    return symbols[:12]


def fetch_bars(symbol: str) -> pd.DataFrame | None:
    start = (datetime.now(timezone.utc) - timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
    resp = requests.get(
        f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
        params={"timeframe": BAR_TIMEFRAME, "feed": "sip", "adjustment": "split",
                "start": start, "limit": 10000},
        headers={"APCA-API-KEY-ID": ALPACA_KEY, "APCA-API-SECRET-KEY": ALPACA_SECRET},
        timeout=30,
    )
    resp.raise_for_status()
    bars = resp.json().get("bars") or []
    if len(bars) < LOOKBACK_BARS + 10:
        return None
    df = pd.DataFrame(
        {
            "timestamps": pd.to_datetime([b["t"] for b in bars]),
            "open": [b["o"] for b in bars],
            "high": [b["h"] for b in bars],
            "low": [b["l"] for b in bars],
            "close": [b["c"] for b in bars],
            "volume": [b["v"] for b in bars],
            "amount": [b["v"] * b["c"] for b in bars],
        }
    )
    return df.tail(LOOKBACK_BARS).reset_index(drop=True)


def bars_hash(df: pd.DataFrame) -> str:
    payload = json.dumps(
        [[str(t), o, h, l, c, v] for t, o, h, l, c, v in zip(
            df["timestamps"], df["open"], df["high"], df["low"], df["close"], df["volume"])],
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def forecast_symbol(predictor: KronosPredictor, symbol: str, run_id: str) -> dict | None:
    df = fetch_bars(symbol)
    if df is None:
        print(f"  {symbol}: not enough bars, skipped")
        return None

    anchor_ts = df["timestamps"].iloc[-1].to_pydatetime().replace(tzinfo=timezone.utc)
    anchor_price = float(df["close"].iloc[-1])
    x_df = df[["open", "high", "low", "close", "volume", "amount"]]
    x_ts = df["timestamps"]
    step = pd.Timedelta(minutes=5)
    y_ts = pd.Series([x_ts.iloc[-1] + step * (i + 1) for i in range(HORIZON_BARS)])

    # N independent sampled paths (T>0): the fork's predict() with
    # sample_count>1 averages internally, so sample one path per call.
    close_paths = []
    for _ in range(SAMPLE_COUNT):
        pred = predictor.predict(df=x_df, x_timestamp=x_ts, y_timestamp=y_ts,
                                 pred_len=HORIZON_BARS, T=1.0, top_p=0.9,
                                 sample_count=1, verbose=False)
        close_paths.append(pred["close"].to_numpy())
    paths = np.stack(close_paths)  # [samples, horizon]

    terminal = paths[:, -1]
    p_up = float((terminal > anchor_price).mean())
    q05, q50, q95 = (np.quantile(paths, q, axis=0) for q in (0.05, 0.50, 0.95))
    dispersion_pct = float((q95[-1] - q05[-1]) / anchor_price * 100)

    window_end = anchor_ts + timedelta(minutes=5 * HORIZON_BARS)
    return {
        "run_id": run_id,
        "model_version": MODEL_VERSION,
        "symbol": symbol,
        "anchor_ts": anchor_ts.isoformat(),
        "anchor_price": anchor_price,
        "session": "PRE" if anchor_ts.astimezone(timezone.utc).hour < 14 else "RTH",
        "bar_timeframe": BAR_TIMEFRAME,
        "horizon_bars": HORIZON_BARS,
        "window_end_ts": window_end.isoformat(),
        "n_samples": SAMPLE_COUNT,
        "p_up": p_up,
        "quantile_paths": {"q05": q05.tolist(), "q50": q50.tolist(), "q95": q95.tolist()},
        "dispersion_pct": dispersion_pct,
        "quality_flags": {"bars": int(len(df)), "gap_free": bool(df["close"].notna().all())},
        "sampler_params": {"T": 1.0, "top_p": 0.9},
        "input_start_ts": df["timestamps"].iloc[0].to_pydatetime().replace(tzinfo=timezone.utc).isoformat(),
        "input_end_ts": anchor_ts.isoformat(),
        "input_bars_hash": bars_hash(df),
    }


def main() -> None:
    symbols = scan_candidates()
    if not symbols:
        print("No candidates to forecast.")
        return
    print(f"Kronos premarket batch over {len(symbols)} symbols: {', '.join(symbols)}")

    tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
    model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
    predictor = KronosPredictor(model, tokenizer, device="mps", max_context=512)

    run_id = f"kronos_{uuid.uuid4().hex[:8]}"
    forecasts = []
    for symbol in symbols:
        try:
            fc = forecast_symbol(predictor, symbol, run_id)
            if fc:
                forecasts.append(fc)
                print(f"  {symbol}: p_up={fc['p_up']:.2f} dispersion={fc['dispersion_pct']:.1f}%")
        except Exception as err:  # one bad symbol never kills the batch
            print(f"  {symbol}: failed ({err})")

    if not forecasts:
        print("No forecasts produced.")
        return
    resp = requests.post(f"{MIE_API_URL}/api/kronos/forecasts", json=forecasts,
                         headers=api_headers(), timeout=60)
    print(f"Ingest: {resp.status_code} {resp.text[:300]}")


if __name__ == "__main__":
    main()
