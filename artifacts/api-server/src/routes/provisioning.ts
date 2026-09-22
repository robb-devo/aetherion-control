import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import { CreateProvisioningJobBody, GetProvisioningJobParams, GetProvisioningJobResponse, GetProvisioningOptionsResponse } from "@workspace/api-zod";
import {
  createProvisioningJob,
  getProvisioningJob,
  isValidProvisioningInput,
  provisioningOptions,
  type ProvisioningInput,
} from "../lib/hetznerProvisioning";
import { requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use("/provisioning", requireAuth);
router.use("/provisioning", requirePermission("provisioning"));

router.get("/provisioning/options", (_req, res): void => {
  res.json(GetProvisioningOptionsResponse.parse(provisioningOptions));
});

router.post("/provisioning/jobs", (req, res): void => {
  if (!process.env.HETZNER_API_TOKEN) {
    res.status(503).json({ error: "Hetzner provisioning is not configured" });
    return;
  }
  const parsed = CreateProvisioningJobBody.safeParse(req.body);
  if (!parsed.success || !isValidProvisioningInput(parsed.data as ProvisioningInput)) {
    res.status(400).json({ error: parsed.success ? "Unsupported provisioning configuration" : parsed.error.message });
    return;
  }
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.status(202).json(createProvisioningJob(userId, parsed.data as ProvisioningInput));
});

router.get("/provisioning/jobs/:id", (req, res): void => {
  const params = GetProvisioningJobParams.safeParse(req.params);
  const userId = getAuth(req).userId;
  if (!params.success || !userId) {
    res.status(400).json({ error: "Invalid provisioning job" });
    return;
  }
  const job = getProvisioningJob(params.data.id, userId);
  if (!job) {
    res.status(404).json({ error: "Provisioning job not found" });
    return;
  }
  res.json(GetProvisioningJobResponse.parse(job));
});

export default router;