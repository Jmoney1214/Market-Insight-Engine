import { Router, type IRouter } from "express";
import { STRATEGY_REGISTRY } from "@workspace/copilot-core/runtime";
import { ListStrategiesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// The registry is deterministic source-of-truth code, not DB-seeded data. It
// lists both promotable primary-edge hypotheses and non-promotable
// entry-refinement features so the UI can render them distinctly.
router.get("/strategies", (_req, res) => {
  res.json(ListStrategiesResponse.parse(STRATEGY_REGISTRY));
});

export default router;
