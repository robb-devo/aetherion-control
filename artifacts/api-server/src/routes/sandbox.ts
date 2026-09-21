import { Router, type IRouter } from "express";
import { requireAuth, requirePermission } from "../middlewares/requireAuth";
import {
  createSandbox,
  deleteSandbox,
  getSandboxOptions,
  listSandboxes,
  startSandbox,
  type SandboxCreateInput,
  type SandboxDifficulty,
  type SandboxGamemode,
  type SandboxPreset,
  type SandboxType,
} from "../lib/sandbox";

const router: IRouter = Router();
router.use("/sandbox", requireAuth);

router.get("/sandbox/options", requirePermission("sandbox"), async (_req, res) => {
  try {
    res.json(await getSandboxOptions());
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Sandbox options failed" });
  }
});

router.get("/sandbox/servers", requirePermission("sandbox"), (_req, res) => {
  res.json({ servers: listSandboxes() });
});

router.post("/sandbox/servers", requirePermission("sandbox"), async (req, res) => {
  try {
    const body = req.body ?? {};
    const input: SandboxCreateInput = {
      name: String(body.name ?? ""),
      serverType: body.serverType as SandboxType,
      version: String(body.version ?? ""),
      ramGb: Number(body.ramGb),
      cpuCores: Number(body.cpuCores),
      preset: body.preset as SandboxPreset | undefined,
      maxPlayers: body.maxPlayers != null ? Number(body.maxPlayers) : undefined,
      viewDistance: body.viewDistance != null ? Number(body.viewDistance) : undefined,
      simulationDistance: body.simulationDistance != null ? Number(body.simulationDistance) : undefined,
      difficulty: body.difficulty as SandboxDifficulty | undefined,
      gamemode: body.gamemode as SandboxGamemode | undefined,
      onlineMode: body.onlineMode,
      motd: body.motd != null ? String(body.motd) : undefined,
      startAfterCreate: body.startAfterCreate,
    };
    const created = await createSandbox(input);
    res.status(201).json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sandbox create failed";
    const status = /not enough|must be|required|exists|unsupported|available|invalid/i.test(message) ? 400 : 502;
    res.status(status).json({ error: message });
  }
});

router.delete("/sandbox/servers/:id", requirePermission("sandbox"), async (req, res) => {
  try {
    res.json(await deleteSandbox(req.params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sandbox delete failed";
    res.status(message.includes("not found") ? 404 : 502).json({ error: message });
  }
});

router.post("/sandbox/servers/:id/start", requirePermission("sandbox"), async (req, res) => {
  try {
    res.json(await startSandbox(req.params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sandbox start failed";
    res.status(message.includes("not found") ? 404 : 502).json({ error: message });
  }
});

export default router;
