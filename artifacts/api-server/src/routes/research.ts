import { Router, type IRouter } from "express";
import { runResearch } from "../lib/researchRunner.js";

const router: IRouter = Router();

/**
 * Runs the Wave 2 research layer live for one symbol and returns the
 * CandidatePacket with every referenced record. Read-only: computes and
 * returns; persistence of packets is a later wave. Degrades honestly —
 * missing SEC_USER_AGENT or AI integration yields UNKNOWN checks and a
 * PARTIAL/BLOCKED outcome, never invented research.
 */
router.get("/research/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }
  const modeRaw = String(req.query["mode"] ?? "STANDARD").toUpperCase();
  if (!["FAST", "STANDARD", "DEEP"].includes(modeRaw)) {
    res.status(400).json({ error: "mode must be FAST, STANDARD, or DEEP" });
    return;
  }

  try {
    const result = await runResearch(symbol, modeRaw as "FAST" | "STANDARD" | "DEEP");
    res.json(result);
  } catch (err) {
    req.log.error({ err, symbol }, "Research run failed");
    res.status(500).json({ error: "Research run failed." });
  }
});

export default router;
