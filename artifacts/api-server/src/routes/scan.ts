import { Router } from "express";
import { runPremarketScan, scanAvailable } from "../lib/scan.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/scan/premarket", async (req, res) => {
  if (!scanAvailable()) {
    res.status(503).json({ error: "Market data providers not configured (FMP + Alpaca keys required)" });
    return;
  }
  try {
    const result = await runPremarketScan(req.query["refresh"] === "true");
    res.json(result);
  } catch (err) {
    logger.error({ err: String(err) }, "Pre-market scan failed");
    res.status(500).json({ error: "Scan failed" });
  }
});

router.get("/scan/scorecard", async (_req, res) => {
  try {
    const { getScorecard } = await import("../lib/scorecard.js");
    res.json(await getScorecard());
  } catch (err) {
    logger.error({ err: String(err) }, "Scorecard fetch failed");
    res.status(500).json({ error: "Scorecard unavailable" });
  }
});

router.get("/scan/universe-snapshot", async (req, res) => {
  const date = String(req.query["date"] ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date=YYYY-MM-DD required" });
    return;
  }
  try {
    const { getUniverseSnapshot } = await import("../lib/universeSnapshot.js");
    const snap = await getUniverseSnapshot(date);
    if (!snap) {
      res.status(404).json({ error: `No universe snapshot for ${date}` });
      return;
    }
    res.json(snap);
  } catch (err) {
    logger.error({ err: String(err) }, "Universe snapshot fetch failed");
    res.status(500).json({ error: "Universe snapshot unavailable" });
  }
});

export default router;
