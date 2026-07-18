import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import watchlistRouter from "./watchlist";
import scanRouter from "./scan";
import copilotRouter from "./copilot";
import researchRouter from "./research";
import memoryRouter from "./memory";
import kronosRouter from "./kronos";
import accuracyRouter from "./accuracy";
import backtestRouter from "./backtest";
import universeRouter from "./universe";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(watchlistRouter);
router.use(scanRouter);
router.use(researchRouter);
router.use(memoryRouter);
router.use(kronosRouter);
router.use(accuracyRouter);
router.use(backtestRouter);
router.use(universeRouter);
router.use("/copilot", copilotRouter);

export default router;
