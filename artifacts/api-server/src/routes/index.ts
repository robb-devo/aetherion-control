import { Router, type IRouter } from "express";
import healthRouter from "./health";
import craftyRouter from "./crafty";
import provisioningRouter from "./provisioning";
import infrastructureRouter from "./infrastructure";
import sandboxRouter from "./sandbox";
import webRouter from "./web";

const router: IRouter = Router();

router.use(healthRouter);
router.use(craftyRouter);
router.use(provisioningRouter);
router.use(infrastructureRouter);
router.use(sandboxRouter);
router.use(webRouter);

export default router;
