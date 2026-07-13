import { Router, type IRouter } from "express";
import { getBacktestStatus, startResearchBacktest } from "../lib/backtestStore.js";

const router: IRouter = Router();

/**
 * Launches a point-in-time research backtest over the recorded scan history.
 * Body: { days?: 1-30, symbolsPerDay?: 1-10, mode?: FAST|STANDARD|DEEP }.
 * Returns the batch id immediately; poll the GET endpoint for progress.
 * Everything the batch writes is labeled backtest_* and excluded from live
 * accuracy, memory reinforcement, and episodic memory by construction.
 */
router.post("/research/backtest", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const modeRaw = String(body["mode"] ?? "STANDARD").toUpperCase();
  if (!["FAST", "STANDARD", "DEEP"].includes(modeRaw)) {
    res.status(400).json({ error: "mode must be FAST, STANDARD, or DEEP" });
    return;
  }
  try {
    const started = await startResearchBacktest({
      days: Number(body["days"]) || undefined,
      symbolsPerDay: Number(body["symbolsPerDay"]) || undefined,
      mode: modeRaw as "FAST" | "STANDARD" | "DEEP",
    });
    if (started.total === 0) {
      res.status(404).json({ error: "No graded scan history to backtest — the scorecard is empty." });
      return;
    }
    res.status(202).json(started);
  } catch (err) {
    req.log.error({ err }, "Backtest launch failed");
    res.status(500).json({ error: "Backtest launch failed." });
  }
});

/** Progress + per-candidate results (+ contamination note) for one batch. */
router.get("/research/backtest/:batchId", async (req, res) => {
  const batchId = String(req.params.batchId ?? "").trim();
  if (!/^backtest_[a-z0-9]{8}$/.test(batchId)) {
    res.status(400).json({ error: "Invalid batch id" });
    return;
  }
  try {
    const status = await getBacktestStatus(batchId);
    if (!status) {
      res.status(404).json({ error: `No backtest batch ${batchId}.` });
      return;
    }
    res.json({ batchId, ...status });
  } catch (err) {
    req.log.error({ err, batchId }, "Backtest status failed");
    res.status(500).json({ error: "Backtest status failed." });
  }
});

export default router;
