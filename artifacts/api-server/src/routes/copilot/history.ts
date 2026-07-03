import { Router, type IRouter } from "express";
import { db, historyLogTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/history", async (_req, res) => {
  const rows = await db
    .select()
    .from(historyLogTable)
    .orderBy(desc(historyLogTable.createdAt))
    .limit(100);

  res.json(
    rows.map((r) => ({
      id: r.id,
      eventId: r.eventId ?? null,
      symbol: r.symbol ?? null,
      mode: r.mode,
      alertLevel: r.alertLevel ?? null,
      eventSnapshot: r.eventSnapshot,
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

export default router;
