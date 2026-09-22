import { Router, type IRouter, type Response } from "express";
import { requireAuth, requirePermission } from "../middlewares/requireAuth";
import { ownerIdFor, type OwnerScope } from "../lib/sandboxOwners.mjs";
import {
  createSandbox,
  deleteSandbox,
  getSandboxOptions,
  listSandboxes,
  startSandbox,
  uploadSandboxFile,
  type SandboxCreateInput,
  type SandboxDifficulty,
  type SandboxGamemode,
  type SandboxPreset,
  type SandboxType,
} from "../lib/sandbox";

const router: IRouter = Router();
router.use("/sandbox", requireAuth);

function scopeFrom(req: Express.Request): OwnerScope {
  const code = req.access?.code;
  if (!code) throw new Error("Unauthorized");
  return {
    ownerId: ownerIdFor(code),
    includeUnowned: req.access?.role === "owner",
  };
}

function fail(res: Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /unauthorized/i.test(message)
    ? 401
    : /not found/i.test(message)
      ? 404
      : /not enough|must be|required|exists|unsupported|available|invalid|too large|text files|path|owner/i.test(message)
        ? 400
        : 502;
  res.status(status).json({ error: message });
}

router.get("/sandbox/options", requirePermission("sandbox"), async (_req, res) => {
  try {
    res.json(await getSandboxOptions());
  } catch (error) {
    fail(res, error, "Sandbox options failed");
  }
});

router.get("/sandbox/servers", requirePermission("sandbox"), (req, res) => {
  try {
    res.json({ servers: listSandboxes(scopeFrom(req)) });
  } catch (error) {
    fail(res, error, "Sandbox list failed");
  }
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
    const created = await createSandbox(input, scopeFrom(req));
    res.status(201).json(created);
  } catch (error) {
    fail(res, error, "Sandbox create failed");
  }
});

router.delete("/sandbox/servers/:id", requirePermission("sandbox"), async (req, res) => {
  try {
    res.json(await deleteSandbox(String(req.params.id), scopeFrom(req)));
  } catch (error) {
    fail(res, error, "Sandbox delete failed");
  }
});

router.post("/sandbox/servers/:id/start", requirePermission("sandbox"), async (req, res) => {
  try {
    res.json(await startSandbox(String(req.params.id), scopeFrom(req)));
  } catch (error) {
    fail(res, error, "Sandbox start failed");
  }
});

router.post("/sandbox/servers/:id/files", requirePermission("sandbox"), async (req, res) => {
  try {
    const body = req.body ?? {};
    const content = typeof body.content === "string" ? body.content : "";
    res.json(await uploadSandboxFile(String(req.params.id), scopeFrom(req), String(body.path ?? ""), content));
  } catch (error) {
    fail(res, error, "Sandbox upload failed");
  }
});

export default router;
