import { Router, type IRouter } from "express";
import {
  DeleteCraftyServerFileBody,
  DeleteCraftyServerFileParams,
  DeleteCraftyServerFileResponse,
  ListCraftyServerBackupsParams,
  ListCraftyServerBackupsResponse,
  ListCraftyServerFilesBody,
  ListCraftyServerFilesParams,
  ListCraftyServerFilesResponse,
  ListCraftyServerPluginsParams,
  ListCraftyServerPluginsResponse,
  SaveCraftyServerFileBody,
  SaveCraftyServerFileParams,
  SaveCraftyServerFileResponse,
} from "@workspace/api-zod";
import {
  deleteCraftyFile,
  getCraftyBackups,
  getCraftyFiles,
  getCraftyHealth,
  getCraftyLogs,
  getCraftyPlugins,
  getCraftyStats,
  listCraftyServers,
  runCraftyAction,
  saveCraftyFile,
  sendCraftyCommand,
} from "../lib/crafty";
import { requireAuth, requirePermission } from "../middlewares/requireAuth";

const router: IRouter = Router();
const allowedActions = new Set(["start_server", "stop_server", "restart_server", "kill_server", "backup_server"]);

router.use("/crafty", requireAuth);
router.use("/crafty", requirePermission("servers.read"));

router.get("/crafty/health", async (_req, res) => {
  try {
    res.json(await getCraftyHealth());
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty health check failed" });
  }
});

router.get("/crafty/servers", async (_req, res) => {
  try {
    res.json({ servers: await listCraftyServers() });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty server list failed" });
  }
});

router.get("/crafty/servers/:id/stats", async (req, res) => {
  try {
    res.json(await getCraftyStats(req.params.id));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty stats request failed" });
  }
});

router.get("/crafty/servers/:id/logs", async (req, res) => {
  try {
    res.json({ lines: await getCraftyLogs(req.params.id) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty logs request failed" });
  }
});

router.post("/crafty/servers/:id/files/query", async (req, res): Promise<void> => {
  const params = ListCraftyServerFilesParams.safeParse(req.params);
  const body = ListCraftyServerFilesBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid server path" });
    return;
  }
  try {
    res.json(ListCraftyServerFilesResponse.parse(await getCraftyFiles(params.data.id, body.data.path)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Crafty file request failed";
    res.status(message.includes("path") || message.includes("Path") ? 400 : 502).json({ error: message });
  }
});

router.put("/crafty/servers/:id/files", requirePermission("servers.files"), async (req, res): Promise<void> => {
  const params = SaveCraftyServerFileParams.safeParse(req.params);
  const body = SaveCraftyServerFileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid file update" });
    return;
  }
  try {
    await saveCraftyFile(params.data.id, body.data.path, body.data.content);
    res.json(SaveCraftyServerFileResponse.parse({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Crafty file update failed";
    res.status(message.includes("path") || message.includes("Path") ? 400 : 502).json({ error: message });
  }
});

router.delete("/crafty/servers/:id/files", requirePermission("servers.files"), async (req, res): Promise<void> => {
  const params = DeleteCraftyServerFileParams.safeParse(req.params);
  const body = DeleteCraftyServerFileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }
  try {
    await deleteCraftyFile(params.data.id, body.data.path);
    res.json(DeleteCraftyServerFileResponse.parse({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Crafty file delete failed";
    res.status(message.includes("path") || message.includes("Path") ? 400 : 502).json({ error: message });
  }
});

router.get("/crafty/servers/:id/plugins", async (req, res): Promise<void> => {
  const params = ListCraftyServerPluginsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid server id" });
    return;
  }
  try {
    res.json(ListCraftyServerPluginsResponse.parse({ plugins: await getCraftyPlugins(params.data.id) }));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty plugin request failed" });
  }
});

router.get("/crafty/servers/:id/backups", async (req, res): Promise<void> => {
  const params = ListCraftyServerBackupsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid server id" });
    return;
  }
  try {
    res.json(ListCraftyServerBackupsResponse.parse({ backups: await getCraftyBackups(params.data.id) }));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty backup request failed" });
  }
});

router.post("/crafty/servers/:id/action", requirePermission("servers.action"), async (req, res) => {
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  if (!allowedActions.has(action)) {
    res.status(400).json({ error: "Unsupported Crafty action" });
    return;
  }
  try {
    await runCraftyAction(req.params.id, action);
    res.json({ ok: true, action });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty action failed" });
  }
});

router.post("/crafty/servers/:id/command", requirePermission("servers.command"), async (req, res) => {
  const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
  if (!command || command.length > 240) {
    res.status(400).json({ error: "Command must contain between 1 and 240 characters" });
    return;
  }
  try {
    await sendCraftyCommand(req.params.id, command);
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Crafty command failed" });
  }
});

export default router;
