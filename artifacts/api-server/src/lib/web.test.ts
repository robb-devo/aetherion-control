import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { buildJavaCommand, cleanLogLine } from "./sandbox";
import { ownerIdFor } from "./sandboxOwners.mjs";
import { parseStatusResponse, pingMinecraft } from "./serverProbe";
import {
  authenticate,
  hashPassword,
  registerUser,
  resetAccountCache,
  scopeForWebUser,
  verifyPassword,
} from "./webAccounts";
import {
  RAM_TIERS,
  cleanServerName,
  craftySlugFor,
  deriveStatus,
  playableVersions,
  tierFor,
} from "./webServers";
import webRouter from "../routes/web";

async function withTempData<T>(run: (dir: string) => Promise<T>) {
  const dir = await mkdtemp(path.join(tmpdir(), "aeth-web-"));
  const previous = {
    WEB_ACCOUNTS_PATH: process.env.WEB_ACCOUNTS_PATH,
    WEB_SESSIONS_PATH: process.env.WEB_SESSIONS_PATH,
    SANDBOX_STORE_PATH: process.env.SANDBOX_STORE_PATH,
    WEB_COOKIE_INSECURE: process.env.WEB_COOKIE_INSECURE,
  };
  process.env.WEB_ACCOUNTS_PATH = path.join(dir, "accounts.json");
  process.env.WEB_SESSIONS_PATH = path.join(dir, "sessions.json");
  process.env.SANDBOX_STORE_PATH = path.join(dir, "sandboxes.json");
  process.env.WEB_COOKIE_INSECURE = "1";
  resetAccountCache();
  try {
    return await run(dir);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetAccountCache();
    await rm(dir, { recursive: true, force: true });
  }
}

test("scrypt hashes verify only the right password and never store it", async () => {
  const hash = await hashPassword("correct horse");
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!hash.includes("correct horse"));
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("correct horsE", hash), false);
  assert.equal(await verifyPassword("anything", "garbage"), false);
});

test("accounts need only a username and a password", async () => {
  await withTempData(async () => {
    const user = await registerUser("Robb_01", "hunter2hunter2");
    assert.equal(user.username, "Robb_01");
    await assert.rejects(registerUser("robb_01", "another-password"), /taken/);
    await assert.rejects(registerUser("admin", "another-password"), /taken/);
    await assert.rejects(registerUser("ab", "long-enough"), /3–20/);
    await assert.rejects(registerUser("has space", "long-enough"), /3–20/);
    await assert.rejects(registerUser("valid_name", "short"), /8 characters/);
    assert.equal((await authenticate("ROBB_01", "hunter2hunter2")).id, user.id);
    await assert.rejects(authenticate("Robb_01", "wrong-password"), /Wrong username or password/);
    await assert.rejects(authenticate("nobody", "whatever-pass"), /Wrong username or password/);
  });
});

test("website owners are namespaced apart from launcher Microsoft ids", () => {
  const scope = scopeForWebUser({ id: "abc" });
  assert.equal(scope.ownerId, ownerIdFor("web:abc"));
  assert.notEqual(scope.ownerId, ownerIdFor("ms:abc"));
  assert.equal(scope.includeUnowned, false);
});

test("RAM tiers start at 512 MB and stay inside the playground range", () => {
  assert.deepEqual(
    RAM_TIERS.map((tier) => tier.ramMb),
    [512, 768, 1024, 1536, 2048],
  );
  assert.equal(tierFor(256), undefined);
  assert.equal(tierFor(1024)?.rarity, "rare");
  for (const tier of RAM_TIERS) assert.ok(tier.cpuCores >= 1 && tier.cpuCores <= 2);
});

test("JVM flags keep launcher GB servers unchanged and support MB tiers", () => {
  assert.equal(
    buildJavaCommand("paper.jar", 16 * 1024, 4),
    "java -Xms8G -Xmx16G -XX:ActiveProcessorCount=4 -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -jar paper.jar nogui",
  );
  assert.match(buildJavaCommand("paper.jar", 2048, 1), /-Xms1G -Xmx2G /);
  assert.match(buildJavaCommand("paper.jar", 1024, 1), /-Xms1G -Xmx1G /);
  assert.match(buildJavaCommand("paper.jar", 512, 1), /-Xms256M -Xmx512M /);
  assert.match(buildJavaCommand("paper.jar", 1536, 2), /-Xms1G -Xmx1536M /);
});

test("console lines come back as plain text", () => {
  assert.equal(
    cleanLogLine("\u001b[33m[18:44 INFO]: It&#x27;s &quot;fine&quot; &lt;3 &amp; more\r"),
    `[18:44 INFO]: It's "fine" <3 & more`,
  );
});

test("only playable release versions are offered", () => {
  assert.deepEqual(
    playableVersions(["26.3", "26.3-rc-3", "1.21.11", "1.21.11-rc3", "1.20.6", "25w14a", "1.8.9"]),
    ["26.3", "1.21.11"],
  );
});

test("server names are free text; Crafty slugs stay valid and unique", () => {
  assert.equal(cleanServerName("  Aetherion   Test  "), "Aetherion Test");
  assert.throws(() => cleanServerName("x"), /2–32/);
  assert.throws(() => cleanServerName("y".repeat(33)), /2–32/);
  const slug = craftySlugFor("Mein Überleben!!");
  assert.match(slug, /^web-[a-z0-9-]{1,10}-[0-9a-f]{4}$/);
  assert.ok(slug.length <= 24);
  assert.notEqual(craftySlugFor("Same"), craftySlugFor("Same"));
  assert.match(craftySlugFor("ÄÖÜ"), /^web-aou-[0-9a-f]{4}$/);
  assert.match(craftySlugFor("!!!"), /^web-server-[0-9a-f]{4}$/);
});

test("status derivation covers every lifecycle phase", () => {
  assert.equal(deriveStatus({ job: { phase: "preparing" }, running: false, pingable: false }), "preparing");
  assert.equal(deriveStatus({ job: { phase: "failed" }, running: false, pingable: false }), "failed");
  assert.equal(deriveStatus({ running: false, pingable: false }), "offline");
  assert.equal(deriveStatus({ running: false, pingable: false, pending: { action: "start" } }), "starting");
  assert.equal(deriveStatus({ running: true, pingable: false }), "starting");
  assert.equal(deriveStatus({ running: true, pingable: true }), "online");
  assert.equal(deriveStatus({ running: true, pingable: true, pending: { action: "stop" } }), "stopping");
  assert.equal(deriveStatus({ running: true, pingable: false, pending: { action: "restart" } }), "restarting");
  assert.equal(deriveStatus({ running: false, pingable: false, pending: { action: "restart" } }), "restarting");
});

function varInt(value: number) {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

test("Minecraft status ping reads players, version and MOTD", async () => {
  const status = {
    version: { name: "Paper 1.21.1", protocol: 767 },
    players: { online: 2, max: 8, sample: [{ name: "Robb", id: "x" }, { name: "Lemon", id: "y" }] },
    description: { text: "§5AETHERION", extra: [{ text: " Sandbox" }] },
  };
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      const json = Buffer.from(JSON.stringify(status), "utf8");
      const body = Buffer.concat([varInt(0), varInt(json.length), json]);
      socket.end(Buffer.concat([varInt(body.length), body]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const ping = await pingMinecraft("127.0.0.1", port, 2000);
    assert.ok(ping);
    assert.equal(ping.online, 2);
    assert.equal(ping.max, 8);
    assert.deepEqual(ping.players, ["Robb", "Lemon"]);
    assert.equal(ping.version, "Paper 1.21.1");
    assert.equal(ping.motd, "AETHERION Sandbox");
  } finally {
    server.close();
  }
  assert.equal(await pingMinecraft("127.0.0.1", port, 500), null);
  assert.equal(parseStatusResponse(null, 1).online, 0);
});

async function listenApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", webRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}/api/web` };
}

async function call(
  base: string,
  pathname: string,
  init: { method?: string; body?: unknown; cookie?: string; web?: boolean; origin?: string } = {},
) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.web !== false) headers["x-aetherion-web"] = "1";
  if (init.origin) headers.origin = init.origin;
  const response = await fetch(`${base}${pathname}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

test("web API: cookie sessions, CSRF guard and per-user isolation", async () => {
  await withTempData(async (dir) => {
    await writeFile(
      path.join(dir, "sandboxes.json"),
      JSON.stringify([
        {
          id: "launcher-owned",
          name: "sandbox-friend",
          serverType: "paper",
          version: "1.21.1",
          ramGb: 2,
          cpuCores: 1,
          preset: "light",
          maxPlayers: 12,
          viewDistance: 8,
          simulationDistance: 6,
          difficulty: "normal",
          gamemode: "survival",
          onlineMode: true,
          motd: "x",
          port: 25601,
          createdAt: "2026-09-01T00:00:00.000Z",
          ownerId: ownerIdFor("ms:a1b2c3d4e5f67890abcdef1234567890"),
        },
      ]),
    );
    const { server, base } = await listenApp();
    try {
      assert.equal((await call(base, "/servers")).status, 401);

      const blocked = await call(base, "/auth/register", {
        method: "POST",
        body: { username: "tester", password: "password-123" },
        web: false,
      });
      assert.equal(blocked.status, 403);

      const foreign = await call(base, "/auth/register", {
        method: "POST",
        body: { username: "tester", password: "password-123" },
        origin: "https://evil.example",
      });
      assert.equal(foreign.status, 403);

      const registered = await call(base, "/auth/register", {
        method: "POST",
        body: { username: "tester", password: "password-123" },
        origin: "https://donnernet.de",
      });
      assert.equal(registered.status, 201);
      assert.equal(registered.body.user.username, "tester");
      assert.match(registered.setCookie, /aeth_session=/);
      assert.match(registered.setCookie, /HttpOnly/i);
      assert.match(registered.setCookie, /SameSite=Lax/i);
      assert.match(registered.setCookie, /Path=\/api\/web/);
      const cookie = registered.setCookie.split(";")[0];

      const me = await call(base, "/auth/me", { cookie });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.username, "tester");
      assert.equal(me.body.user.passwordHash, undefined);

      const list = await call(base, "/servers", { cookie });
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.servers, []);
      assert.equal(list.body.maxRunning, 1);

      assert.equal((await call(base, "/servers/launcher-owned", { cookie })).status, 404);
      assert.equal((await call(base, "/servers/launcher-owned/start", { method: "POST", cookie })).status, 404);
      assert.equal((await call(base, "/servers/launcher-owned", { method: "DELETE", cookie })).status, 404);

      const badTier = await call(base, "/servers", {
        method: "POST",
        cookie,
        body: { name: "Tiny", ramMb: 256, software: "paper", version: "1.21.1" },
      });
      assert.equal(badTier.status, 400);
      assert.equal(badTier.body.code, "INVALID_TIER");

      const wrongLogin = await call(base, "/auth/login", {
        method: "POST",
        body: { username: "tester", password: "nope-nope-nope" },
      });
      assert.equal(wrongLogin.status, 401);
      assert.equal(wrongLogin.body.code, "INVALID_LOGIN");

      const login = await call(base, "/auth/login", {
        method: "POST",
        body: { username: "TESTER", password: "password-123" },
      });
      assert.equal(login.status, 200);

      const logout = await call(base, "/auth/logout", { method: "POST", cookie });
      assert.equal(logout.status, 200);
      assert.equal((await call(base, "/auth/me", { cookie })).status, 401);
    } finally {
      server.close();
    }
  });
});
