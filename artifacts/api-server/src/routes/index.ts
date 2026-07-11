import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import watchlistRouter from "./watchlist";
import scanRouter from "./scan";
import copilotRouter from "./copilot";
import brainRouter from "./brain";
import calibrationRouter from "./calibration";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(watchlistRouter);
router.use(scanRouter);
router.use("/copilot", copilotRouter);
router.use("/brain", brainRouter);
router.use(calibrationRouter);

export default router;
