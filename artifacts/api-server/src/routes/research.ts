import { Router, type IRouter } from "express";
import { runResearch } from "../lib/researchRunner.js";
import { persistLeadRun } from "../lib/researchStore.js";
import { judgeLeadRun } from "../lib/judgeStore.js";
import { recordResearchEpisode } from "../lib/memoryStore.js";

const router: IRouter = Router();

/**
 * Runs the Wave 2 research layer live for one symbol, persists the packet +
 * every referenced record into the Supabase brain (content-addressed,
 * append-only), and returns the full result. Degrades honestly — missing
 * SEC_USER_AGENT or AI integration yields UNKNOWN checks and a
 * PARTIAL/BLOCKED outcome, never invented research; a storage failure is
 * reported via `persisted: false`, never a lost response.
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

  // ?resume=<runId> replays a crashed run's completed steps (shape-hash-guarded).
  const resumeRaw = String(req.query["resume"] ?? "").trim();
  const resumeRunId = /^[A-Za-z0-9_-]{1,64}$/.test(resumeRaw) ? resumeRaw : null;

  try {
    const result = await runResearch(symbol, modeRaw as "FAST" | "STANDARD" | "DEEP", resumeRunId);
    const persisted = await persistLeadRun(result);
    const grades = await judgeLeadRun(result);
    // Episodic memory: the desk's research diary (best-effort, never blocks).
    await recordResearchEpisode(result).catch(() => {});
    res.json({ persisted, grades, ...result });
  } catch (err) {
    req.log.error({ err, symbol }, "Research run failed");
    res.status(500).json({ error: "Research run failed." });
  }
});

export default router;
