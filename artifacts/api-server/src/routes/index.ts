import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import craftyRouter from "./crafty";
import provisioningRouter from "./provisioning";
import infrastructureRouter from "./infrastructure";
import sandboxRouter from "./sandbox";
import appRouter from "./app";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(craftyRouter);
router.use(provisioningRouter);
router.use(infrastructureRouter);
router.use(sandboxRouter);
router.use(appRouter);

export default router;
