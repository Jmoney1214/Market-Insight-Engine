import { Router, type IRouter } from "express";
import healthRouter from "./health";
import eventRouter from "./event";
import explainRouter from "./explain";
import journalRouter from "./journal";
import registryRouter from "./registry";
import historyRouter from "./history";
import replayRouter from "./replay";

const router: IRouter = Router();

router.use(healthRouter);
router.use(eventRouter);
router.use(explainRouter);
router.use(journalRouter);
router.use(registryRouter);
router.use(historyRouter);
router.use(replayRouter);

export default router;
