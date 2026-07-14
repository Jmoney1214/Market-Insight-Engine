import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import watchlistRouter from "./watchlist";
import scanRouter from "./scan";
import copilotRouter from "./copilot";
import authRouter from "./auth.js";
import governanceRouter from "./governance.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(governanceRouter);
router.use(analysisRouter);
router.use(watchlistRouter);
router.use(scanRouter);
router.use("/copilot", copilotRouter);

export default router;
