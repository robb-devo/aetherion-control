import { Router, type IRouter } from "express";
import { requireAuth, requirePermission } from "../middlewares/requireAuth";
import { listHetznerDedicatedServers } from "../lib/hetznerRobot";

const router: IRouter = Router();
router.use("/infrastructure", requireAuth);
router.use("/infrastructure", requirePermission("infrastructure.read"));

router.get("/infrastructure/hosts", async (_req, res): Promise<void> => {
  try {
    res.json({ hosts: await listHetznerDedicatedServers() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Hetzner Robot request failed" });
  }
});

export default router;