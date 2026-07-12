import { Router, type IRouter } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { desc, like, sql } from "drizzle-orm";
import { db, agentFindingsTable, findingGradesTable } from "@workspace/db";
import { anthropicCompleter } from "../lib/brain/synthesize.js";
import { fetchAlpacaIntradayInput } from "../lib/alpacaData.js";
import { runScoutWorker, type ScoutInput } from "../lib/crew/scoutWorker.js";

const router: IRouter = Router();

async function fetchScoutInput(symbol: string): Promise<ScoutInput> {
  const input = await fetchAlpacaIntradayInput(symbol, "LIVE");
  const lastBar = input.bars[input.bars.length - 1];
  const anchorPrice = input.quote?.last ?? lastBar.c;
  const anchorTs = new Date((input.quote?.quoteTime ?? lastBar.t) * 1000);
  const priorClose = input.priorClose ?? null;
  const spentMovePct =
    priorClose !== null && priorClose > 0 ? ((anchorPrice - priorClose) / priorClose) * 100 : null;
  return { symbol: input.symbol, anchorPrice, anchorTs, priorClose, spentMovePct, news: input.news ?? [] };
}

/** This writer's recent graded record, as short prompt lines (read-before-verdict). */
async function readScoutMemory(): Promise<string[]> {
  const rows = await db
    .select({
      ticker: agentFindingsTable.ticker,
      verdict: agentFindingsTable.verdict,
      confidence: agentFindingsTable.confidence,
      grade: findingGradesTable.grade,
      score: findingGradesTable.score,
    })
    .from(agentFindingsTable)
    .leftJoin(findingGradesTable, sql`${findingGradesTable.findingId} = ${agentFindingsTable.id}`)
    .where(like(agentFindingsTable.agentName, "catalyst-scout%"))
    .orderBy(desc(agentFindingsTable.id))
    .limit(15);
  return rows.map(
    (r) =>
      `${r.ticker ?? "?"} ${r.verdict}@${r.confidence} -> ${r.grade ? `${r.grade} (${r.score ?? "?"})` : "ungraded"}`,
  );
}

async function insertFindings(rows: (typeof agentFindingsTable.$inferInsert)[]): Promise<number[]> {
  const inserted = await db
    .insert(agentFindingsTable)
    .values(rows)
    .returning({ id: agentFindingsTable.id });
  return inserted.map((r) => r.id);
}

// POST /crew/scout/run — run the in-product catalyst-scout worker.
// Body: { symbols: string[], windowEnd?: ISO string (default: next 16:00 ET is the
// caller's job to compute; fallback anchor+2h), dryRun?: boolean }.
// Guarded by CREW_TRIGGER_TOKEN when set (x-crew-token header). Stateless by
// design: drive it from an external cron (same philosophy as the scorecard
// forward-capture trigger) so agent runs never depend on host uptime.
router.post("/scout/run", async (req, res) => {
  const requiredToken = process.env.CREW_TRIGGER_TOKEN;
  if (requiredToken && req.get("x-crew-token") !== requiredToken) {
    res.status(401).json({ error: "bad or missing x-crew-token" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "ANTHROPIC_API_KEY not configured - the crew worker needs a model" });
    return;
  }
  const symbols: string[] = Array.isArray(req.body?.symbols)
    ? req.body.symbols.map((s: unknown) => String(s).toUpperCase()).slice(0, 15)
    : [];
  if (symbols.length === 0) {
    res.status(400).json({ error: "symbols[] required (max 15)" });
    return;
  }
  const windowEnd = req.body?.windowEnd
    ? new Date(String(req.body.windowEnd))
    : new Date(Date.now() + 2 * 60 * 60 * 1000);
  if (Number.isNaN(windowEnd.getTime()) || windowEnd.getTime() <= Date.now()) {
    res.status(400).json({ error: "windowEnd must be a future ISO timestamp" });
    return;
  }

  try {
    const result = await runScoutWorker(
      {
        complete: anthropicCompleter(new Anthropic()),
        fetchInput: fetchScoutInput,
        readMemory: readScoutMemory,
        insertFindings,
      },
      { symbols, windowEnd, dryRun: req.body?.dryRun === true },
    );
    res.json({
      runId: result.runId,
      inserted: result.insertedIds,
      findings: result.findings.map((f) => ({
        ticker: f.ticker,
        verdict: f.verdict,
        confidence: f.confidence,
        evidence: f.evidence,
      })),
      skipped: result.skipped,
      memoryLines: result.memoryLines,
    });
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "crew/scout/run failed");
    res.status(502).json({ error: "scout run failed", detail: String(err) });
  }
});

export default router;
