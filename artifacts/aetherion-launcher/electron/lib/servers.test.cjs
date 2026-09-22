const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { ensureServerEntries, normalizeIp } = require("./servers.cjs");

test("normalizeIp keeps default port bare and appends other ports", () => {
  assert.equal(normalizeIp("play.donnernet.de", 25565), "play.donnernet.de");
  assert.equal(normalizeIp("135.181.18.162", 25610), "135.181.18.162:25610");
  assert.equal(normalizeIp("play.donnernet.de:25565", 25565), "play.donnernet.de:25565");
});

test("servers.dat keeps AETHERION and a sandbox as separate entries", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherion-servers-"));
  const first = await ensureServerEntries(dir, [
    { name: "AETHERION", address: "play.donnernet.de", port: 25565 },
    { name: "Friend", address: "example.com", port: 25565 },
  ]);
  assert.equal(first.file, path.join(dir, "servers.dat"));
  assert.equal(fs.readFileSync(first.file)[0], 0x1f);
  assert.equal(fs.readFileSync(first.file)[1], 0x8b);

  const second = await ensureServerEntries(dir, [
    { name: "AETHERION", address: "play.donnernet.de", port: 25565 },
    { name: "sandbox-isle", address: "135.181.18.162", port: 25610 },
  ]);

  const byName = Object.fromEntries(second.servers.map((entry) => [entry.name, entry.ip]));
  assert.equal(byName.AETHERION, "play.donnernet.de");
  assert.equal(byName["sandbox-isle"], "135.181.18.162:25610");
  assert.equal(byName.Friend, "example.com");
  assert.equal(second.servers[0].name, "AETHERION");
  assert.equal(second.servers[0].hidden, false);
});
