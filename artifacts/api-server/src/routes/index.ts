import { Router, type IRouter } from "express";
import healthRouter from "./health";
import housingRouter from "./housing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(housingRouter);

export default router;
