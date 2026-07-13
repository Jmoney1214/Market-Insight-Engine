import { Router, type IRouter } from "express";
import { db, journalEntriesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  computeScoreboard,
  journalOutcomeToSample,
  type TradeSample,
} from "@workspace/copilot-core/runtime";
import { GetScoreboardResponse, ListValidationStatesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// The scoreboard is computed on the fly from journaled outcomes every request.
// There is no persisted validation state to drift out of sync. Only whitelist-
// validated, confirmed primary-edge outcomes ever become samples.
async function loadSamples(): Promise<TradeSample[]> {
  const rows = await db
    .select()
    .from(journalEntriesTable)
    .orderBy(desc(journalEntriesTable.createdAt))
    .limit(2000);

  const samples: TradeSample[] = [];
  for (const row of rows) {
    const sample = journalOutcomeToSample({
      mode: row.mode,
      manualOutcome: row.manualOutcome,
    });
    if (sample) samples.push(sample);
  }
  return samples;
}

router.get("/scoreboard", async (_req, res) => {
  const scores = computeScoreboard(await loadSamples());
  res.json(GetScoreboardResponse.parse(scores));
});

// Deprecated compatibility adapter: projects the edge scoreboard into the legacy
// ValidationState shape so existing consumers keep working. Prefer /scoreboard.
router.get("/validation", async (_req, res) => {
  const scores = computeScoreboard(await loadSamples());
  const updatedAt = new Date().toISOString();
  const projected = scores.map((score, index) => ({
    id: index + 1,
    strategyName: score.hypothesisName,
    validationStatus: score.validationStatus,
    sampleCount: score.countableSampleCount,
    metrics: {
      expectancyR: score.expectancyR,
      profitFactor: score.profitFactor,
      winRate: score.winRate,
      maxDrawdownR: score.maxDrawdownR,
    },
    updatedAt,
  }));
  res.json(ListValidationStatesResponse.parse(projected));
});

export default router;
