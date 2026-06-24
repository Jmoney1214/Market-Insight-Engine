import { Router, type IRouter } from "express";
import { db, strategyRegistryTable, validationStateTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/strategies", async (_req, res) => {
  const rows = await db
    .select()
    .from(strategyRegistryTable)
    .orderBy(desc(strategyRegistryTable.updatedAt));

  res.json(
    rows.map((r) => ({
      id: r.id,
      hypothesisName: r.hypothesisName,
      primaryEdgeType: r.primaryEdgeType,
      universe: r.universe ?? null,
      holdingPeriod: r.holdingPeriod ?? null,
      minimumSampleCount: r.minimumSampleCount,
      validationStatus: r.validationStatus,
      definition: r.definition ?? {},
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

router.get("/validation", async (_req, res) => {
  const rows = await db
    .select()
    .from(validationStateTable)
    .orderBy(desc(validationStateTable.updatedAt));

  res.json(
    rows.map((r) => ({
      id: r.id,
      strategyName: r.strategyName,
      validationStatus: r.validationStatus,
      sampleCount: r.sampleCount,
      metrics: r.metrics ?? {},
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

export default router;
