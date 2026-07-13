import { Router, type IRouter, type RequestHandler } from "express";

const router: IRouter = Router();

const brainAuthNotReady: RequestHandler = (_req, res) => {
  res.status(503).json({
    error: "Historical brain access is unavailable until verified replay authorization is installed.",
    code: "BRAIN_AUTH_NOT_READY",
  });
};

// Task 4 replaces this temporary fail-closed boundary with verified replay
// scope plus canonical case-revision and evidence-hash resolution. Until then,
// these routes must not import or read bundled fixtures.
router.get("/replay/session", brainAuthNotReady);
router.get("/replay/event", brainAuthNotReady);
router.get("/replay/explain", brainAuthNotReady);

export default router;
