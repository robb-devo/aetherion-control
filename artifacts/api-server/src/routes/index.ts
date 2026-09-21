import { Router, type IRouter } from "express";
import healthRouter from "./health";
import craftyRouter from "./crafty";
import provisioningRouter from "./provisioning";
import infrastructureRouter from "./infrastructure";

const router: IRouter = Router();

router.use(healthRouter);
router.use(craftyRouter);
router.use(provisioningRouter);
router.use(infrastructureRouter);

export default router;
