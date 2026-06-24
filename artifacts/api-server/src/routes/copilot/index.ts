import { Router, type IRouter } from "express";
import healthRouter from "./health";
import journalRouter from "./journal";
import registryRouter from "./registry";
import historyRouter from "./history";

const router: IRouter = Router();

router.use(healthRouter);
router.use(journalRouter);
router.use(registryRouter);
router.use(historyRouter);

export default router;
