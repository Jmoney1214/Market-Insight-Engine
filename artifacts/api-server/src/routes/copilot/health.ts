import { Router, type IRouter } from "express";
import { CopilotHealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = CopilotHealthCheckResponse.parse({
    status: "ok",
    service: "trading-desk-copilot",
  });
  res.json(data);
});

export default router;
