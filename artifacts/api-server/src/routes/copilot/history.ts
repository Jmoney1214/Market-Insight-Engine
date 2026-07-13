import { Router, type IRouter } from "express";
import { db, historyLogTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { hasTrustedEventProvenance } from "../../lib/sourcePolicy.js";

const router: IRouter = Router();

router.get("/history", async (_req, res) => {
  const rows = await db
    .select()
    .from(historyLogTable)
    .orderBy(desc(historyLogTable.createdAt))
    .limit(100);

  res.json(
    rows.flatMap((row) => {
      if (!hasTrustedEventProvenance(row.eventSnapshot)) return [];
      return [{
        id: row.id,
        eventId: row.eventId ?? null,
        symbol: row.symbol ?? null,
        mode: row.mode,
        alertLevel: row.alertLevel ?? null,
        eventSnapshot: row.eventSnapshot,
        createdAt: row.createdAt.toISOString(),
      }];
    }),
  );
});

export default router;
