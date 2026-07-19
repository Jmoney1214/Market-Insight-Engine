// artifacts/api-server/src/routes/universe.ts
import { Router, type IRouter } from "express";
import { getEligibleUniverse, getSymbolMeta } from "../lib/universe/universeStore.js";

const router: IRouter = Router();

/** Eligible-universe summary + a sample (inspection / health). */
router.get("/universe", async (_req, res) => {
  const rows = await getEligibleUniverse();
  res.json({
    eligibleCount: rows.length,
    lowFloatCount: rows.filter((r) => r.lowFloat).length,
    sample: rows.slice(0, 25).map((r) => ({ symbol: r.symbol, price: r.lastPrice, floatBucket: r.floatBucket, exchange: r.exchange })),
  });
});

/** One symbol's full metadata + eligibility. */
router.get("/universe/:symbol", async (req, res) => {
  const meta = await getSymbolMeta(String(req.params.symbol ?? "").toUpperCase());
  if (!meta) { res.status(404).json({ error: "unknown symbol" }); return; }
  res.json(meta);
});

export default router;
