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
  try {
    res.json({ windowDays: 30, agents: await computeAgentAccuracy() });
  } catch (err) {
    req.log.error({ err }, "Accuracy ranking failed");
    res.status(500).json({ error: "Accuracy ranking failed." });
  }
});

export default router;
