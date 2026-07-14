import { Router, type IRouter } from "express";
import { retrieveMemories, getDecisionMemory } from "../lib/memoryStore.js";

const router: IRouter = Router();

/**
 * FinMem retrieval for one symbol: compound-ranked memories (recency decay +
 * importance + embedding similarity when configured) under per-layer token
 * budgets, plus the rendered decision-memory lines. Read-only.
 */
router.get("/memory/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    res.status(400).json({ error: "Invalid symbol" });
    return;
  }
  const query = String(req.query["q"] ?? `recent research and outcomes for ${symbol}`);

  try {
    const [memories, decisionMemory] = await Promise.all([
      retrieveMemories({ symbol, query }),
      getDecisionMemory(symbol),
    ]);
    res.json({
      symbol,
      decisionMemory,
      memories: memories.map((m) => ({
        memoryId: m.item.memoryId,
        layer: m.item.layer,
        kind: m.item.kind,
        content: m.item.content,
        importance: m.item.importance,
        score: m.score,
        createdAt: m.item.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err, symbol }, "Memory retrieval failed");
    res.status(500).json({ error: "Memory retrieval failed." });
  }
});

export default router;
