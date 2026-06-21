import { Router } from "express";
import { db, watchlistTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AddToWatchlistBody, RemoveFromWatchlistParams } from "@workspace/api-zod";

const router = Router();

router.get("/watchlist", async (req, res) => {
  const items = await db
    .select()
    .from(watchlistTable)
    .orderBy(watchlistTable.addedAt);

  res.json(
    items.map((item) => ({
      ...item,
      addedAt: item.addedAt.toISOString(),
    }))
  );
});

router.post("/watchlist", async (req, res) => {
  const parsed = AddToWatchlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: ticker is required" });
    return;
  }

  const ticker = parsed.data.ticker.toUpperCase().trim();

  const [existing] = await db
    .select()
    .from(watchlistTable)
    .where(eq(watchlistTable.ticker, ticker));

  if (existing) {
    res.status(201).json({ ...existing, addedAt: existing.addedAt.toISOString() });
    return;
  }

  const [inserted] = await db
    .insert(watchlistTable)
    .values({ ticker, notes: parsed.data.notes ?? null })
    .returning();

  res.status(201).json({ ...inserted, addedAt: inserted.addedAt.toISOString() });
});

router.delete("/watchlist/:ticker", async (req, res) => {
  const parsed = RemoveFromWatchlistParams.safeParse({ ticker: req.params.ticker });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ticker" });
    return;
  }

  await db
    .delete(watchlistTable)
    .where(eq(watchlistTable.ticker, parsed.data.ticker.toUpperCase()));

  res.status(204).send();
});

export default router;
