import { Router, type IRouter } from "express";
import {
  computeAgentCalibration,
  type CalibrationFinding,
} from "@workspace/copilot-core";
import { getReadClient } from "../lib/brain/supabaseClient.js";

const router: IRouter = Router();

// Findings stamped with these gitShas were written by the scheduled routine
// (quant-research bridge / committee scan), not by interactive subagents.
// Their track records must not blend (see agentCalibration honesty invariants).
// Once routines stamp provenance.source as "<agent>/routine" this fold is a
// no-op for new rows; it exists to classify the historical record correctly.
const ROUTINE_GIT_SHAS = new Set(["0e0d9e2"]);

/**
 * GET /calibration — the computed per-(agent, writer) calibration report the
 * chief-analyst consumes instead of re-deriving weights in prose. Read-only:
 * agent_findings + finding_grades via the RLS-enforced publishable key.
 */
router.get("/calibration", async (req, res) => {
  try {
    const db = getReadClient();
    const { data, error } = await db
      .from("agent_findings")
      .select("id,agent_name,verdict,confidence,provenance,finding_grades(grade,score)");
    if (error) throw new Error(`agent_findings read failed: ${JSON.stringify(error)}`);

    const findings: CalibrationFinding[] = (data ?? []).map((r: any) => ({
      id: r.id,
      agentName: r.agent_name,
      verdict: r.verdict,
      confidence: typeof r.confidence === "number" ? r.confidence : 0,
      provenanceSource: r.provenance?.source ?? "unknown",
      gitSha: r.provenance?.gitSha ?? "unknown",
      grades: (r.finding_grades ?? []).map((g: any) => ({ grade: g.grade, score: g.score })),
    }));

    const report = computeAgentCalibration(findings, {
      classifyWriter: (f) =>
        ROUTINE_GIT_SHAS.has(f.gitSha) ? `${f.provenanceSource}/routine` : f.provenanceSource,
    });
    res.json(report);
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "calibration failed");
    res.status(502).json({ error: "calibration unavailable", detail: String(err) });
  }
});

export default router;
