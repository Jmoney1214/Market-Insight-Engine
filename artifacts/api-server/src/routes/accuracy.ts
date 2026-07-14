import { Router, type IRouter } from "express";
import { computeAgentAccuracy } from "../lib/accuracyStore.js";

const router: IRouter = Router();

/**
 * Agent Accuracy Ranker (ContestTrade predict-then-top-k): rolling 30-day
 * source-faithfulness, false-catalyst rate, and Brier calibration per
 * research agent — ranked by accuracy, never profitability. Agents under the
 * minimum sample count report ranked:false rather than an extrapolated score.
 */
router.get("/research/accuracy", async (req, res) => {
  const raw = String(req.query["source"] ?? "live");
  const source = raw === "backtest" || raw === "all" ? raw : "live";
  try {
    res.json({
      windowDays: 30,
      source,
      // Backtest-sourced grades ran LLM judges over historical events the
      // models may remember — treat those scores as contamination-prone.
      contaminationWarning: source === "live" ? null : "backtest grades include LLM look-ahead risk",
      agents: await computeAgentAccuracy({ source }),
    });
  } catch (err) {
    req.log.error({ err }, "Accuracy ranking failed");
    res.status(500).json({ error: "Accuracy ranking failed." });
  }
});

export default router;
