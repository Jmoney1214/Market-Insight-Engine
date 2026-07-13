import { Router, type IRouter } from "express";
import {
  KronosForecastIngest,
  getCalibration,
  getGatedForecast,
  ingestForecast,
} from "../lib/kronosStore.js";

const router: IRouter = Router();

/**
 * Forecast ingest from the Mac-side Kronos forecaster. Accepts one forecast
 * or a batch; strictly validated against the waiting-table contract;
 * idempotent on (run_id, symbol, anchor_ts, horizon_bars).
 */
router.post("/kronos/forecasts", async (req, res) => {
  const body = Array.isArray(req.body) ? req.body : [req.body];
  const results: Array<{ ok: boolean; error?: string }> = [];
  for (const item of body) {
    const parsed = KronosForecastIngest.safeParse(item);
    if (!parsed.success) {
      results.push({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    results.push({ ok: await ingestForecast(parsed.data) });
  }
  const stored = results.filter((r) => r.ok).length;
  res.status(stored > 0 ? 200 : 400).json({ stored, rejected: results.length - stored, results });
});

/** Rolling calibration report — always visible (the gate's own dashboard). */
router.get("/kronos/calibration", async (req, res) => {
  try {
    const modelVersion = typeof req.query["model"] === "string" ? req.query["model"] : undefined;
    res.json(await getCalibration(modelVersion));
  } catch (err) {
    req.log.error({ err }, "Kronos calibration failed");
    res.status(500).json({ error: "Calibration report failed." });
  }
});

/**
 * Latest forecast for a symbol — HARD-GATED: the forecast field is null with
 * gated:true until the rolling calibration passes. The Desk never renders an
 * uncalibrated Kronos.
 */
router.get("/kronos/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }
  try {
    res.json(await getGatedForecast(symbol));
  } catch (err) {
    req.log.error({ err, symbol }, "Kronos forecast fetch failed");
    res.status(500).json({ error: "Forecast fetch failed." });
  }
});

export default router;
