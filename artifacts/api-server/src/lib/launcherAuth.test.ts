import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express, { type Express } from "express";
import { DEFAULT_LAUNCHER_SERVICE_KEY } from "./bearerAuth.mjs";
import { ownerIdFor } from "./sandboxOwners.mjs";
import { sandboxPresetCatalog } from "./sandbox";
import { requireAuth, requirePermission } from "../middlewares/requireAuth";
import sandboxRouter from "../routes/sandbox";

const PLAYER_A = "a1b2c3d4e5f67890abcdef1234567890";
const PLAYER_B = "0123456789abcdef0123456789abcdef";

async function listen(app: Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function hit(
  base: string,
  pathname: string,
  init: { token?: string; player?: string; method?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  if (init.player !== undefined) headers["x-aetherion-player"] = init.player;
  const response = await fetch(`${base}${pathname}`, { method: init.method ?? "GET", headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as { error?: string; servers?: { id: string }[]; code?: string }) : {};
  return { status: response.status, body };
}

test("sandbox presets offer 16 GB by default and 24 GB without raising core caps", () => {
  const catalog = sandboxPresetCatalog();
  assert.equal(catalog.defaultPreset, "balanced");
  assert.equal(catalog.defaultRamGb, 16);
  assert.equal(catalog.presets.balanced.ramGb, 16);
  assert.equal(catalog.presets.balanced.label, "16 GB");
  assert.equal(catalog.presets.large.ramGb, 24);
  assert.equal(catalog.presets.large.label, "24 GB");
  assert.equal(catalog.maxRamGb, 24);
  assert.ok(catalog.poolGb >= 24);
  assert.equal(catalog.maxCores, 4);
  assert.equal(catalog.poolCores, 8);
  assert.ok(catalog.presets.balanced.cpuCores <= catalog.maxCores);
  assert.ok(catalog.presets.large.cpuCores <= catalog.maxCores);
});

test("launcher friend key scopes sandboxes and cannot call the control plane", async () => {
  const previous = {
    CONTROL_API_KEY: process.env.CONTROL_API_KEY,
    LAUNCHER_SERVICE_KEY: process.env.LAUNCHER_SERVICE_KEY,
    SANDBOX_STORE_PATH: process.env.SANDBOX_STORE_PATH,
  };
  const dir = await mkdtemp(path.join(tmpdir(), "aetherion-sandbox-"));
  const store = path.join(dir, "sandboxes.json");
  delete process.env.CONTROL_API_KEY;
  delete process.env.LAUNCHER_SERVICE_KEY;
  process.env.SANDBOX_STORE_PATH = store;
  await writeFile(
    store,
    JSON.stringify([
      { id: "sand-a", name: "sandbox-a", port: 25600, ownerId: ownerIdFor(`ms:${PLAYER_A}`) },
      { id: "sand-b", name: "sandbox-b", port: 25601, ownerId: ownerIdFor(`ms:${PLAYER_B}`) },
      { id: "sand-legacy", name: "sandbox-legacy", port: 25602 },
    ]),
  );

  const app = express();
  app.use("/api", sandboxRouter);
  app.get("/api/crafty/health", requireAuth, requirePermission("servers.read"), (_req, res) => {
    res.json({ code: _req.access?.code });
  });
  const { server, base } = await listen(app);

  try {
    const routes = (sandboxRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack
      .filter((layer) => layer.route)
      .map((layer) => {
        const methods = Object.entries(layer.route!.methods)
          .filter(([, on]) => on)
          .map(([name]) => name)
          .join(",");
        return `${methods} ${layer.route!.path}`;
      });
    assert.ok(routes.includes("get /sandbox/options"));
    assert.ok(routes.includes("get /sandbox/servers"));
    assert.ok(routes.includes("post /sandbox/servers"));
    assert.ok(routes.includes("post /sandbox/servers/:id/start"));
    assert.ok(routes.includes("post /sandbox/servers/:id/stop"));
    assert.ok(routes.includes("delete /sandbox/servers/:id"));

    const missing = await hit(base, "/api/sandbox/servers");
    assert.equal(missing.status, 401);

    const unsigned = await hit(base, "/api/sandbox/servers", { token: DEFAULT_LAUNCHER_SERVICE_KEY });
    assert.equal(unsigned.status, 401);
    assert.match(unsigned.body.error ?? "", /Microsoft/);

    const invalid = await hit(base, "/api/sandbox/servers", {
      token: DEFAULT_LAUNCHER_SERVICE_KEY,
      player: "not-a-uuid",
    });
    assert.equal(invalid.status, 400);

    const own = await hit(base, "/api/sandbox/servers", {
      token: DEFAULT_LAUNCHER_SERVICE_KEY,
      player: PLAYER_A,
    });
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.servers?.map((row) => row.id), ["sand-a"]);

    const dashed = await hit(base, "/api/sandbox/servers", {
      token: DEFAULT_LAUNCHER_SERVICE_KEY,
      player: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
    });
    assert.equal(dashed.status, 200);
    assert.deepEqual(dashed.body.servers?.map((row) => row.id), ["sand-a"]);

    const otherStop = await hit(base, "/api/sandbox/servers/sand-b/stop", {
      token: DEFAULT_LAUNCHER_SERVICE_KEY,
      player: PLAYER_A,
      method: "POST",
    });
    assert.equal(otherStop.status, 404);

    const crafty = await hit(base, "/api/crafty/health", { token: DEFAULT_LAUNCHER_SERVICE_KEY, player: PLAYER_A });
    assert.equal(crafty.status, 403);

    process.env.CONTROL_API_KEY = "phone-secret";
    const phone = await hit(base, "/api/crafty/health", { token: "phone-secret" });
    assert.equal(phone.status, 200);
    assert.equal(phone.body.code, "CONTROL_API_KEY");

    const phoneServers = await hit(base, "/api/sandbox/servers", { token: "phone-secret" });
    assert.equal(phoneServers.status, 200);
    assert.deepEqual(
      phoneServers.body.servers?.map((row) => row.id).sort(),
      ["sand-legacy"],
    );
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
