import assert from "node:assert/strict";
import test from "node:test";
import { SANDBOX_ROUTES, planSandboxCreate, type SandboxOptions } from "./sandboxCreate.ts";

const catalog: SandboxOptions = {
  maxRamGb: 24,
  maxCores: 4,
  presets: [
    { value: "light", ramGb: 2, cpuCores: 1 },
    { value: "performance", ramGb: 6, cpuCores: 3 },
    { value: "max", ramGb: 8, cpuCores: 4 },
    { value: "balanced", ramGb: 16, cpuCores: 4 },
    { value: "large", ramGb: 24, cpuCores: 4 },
  ],
  versions: {
    paper: ["1.20.4", "1.21.1", "1.21.11", "1.21.4-rc1", "1.21-pre1"],
    vanilla: ["1.21.8"],
  },
};

test("one-tap create uses 16 GB Paper and the newest stable 1.21", () => {
  const body = planSandboxCreate(catalog, "", () => 0);
  assert.equal(body.preset, "balanced");
  assert.equal(body.ramGb, 16);
  assert.equal(body.cpuCores, 4);
  assert.equal(body.serverType, "paper");
  assert.equal(body.version, "1.21.11");
  assert.equal(body.startAfterCreate, true);
  assert.match(body.name, /^welt-/);
  assert.deepEqual(Object.keys(body).sort(), [
    "cpuCores",
    "name",
    "preset",
    "ramGb",
    "serverType",
    "startAfterCreate",
    "version",
  ]);
});

test("optional name is cleaned and empty symbols fall back to a generated name", () => {
  assert.equal(planSandboxCreate(catalog, "Friends Night", () => 0).name, "friends-night");
  assert.match(planSandboxCreate(catalog, "!!!", () => 0).name, /^welt-/);
});

test("a one-character name is rejected before any request", () => {
  assert.throws(() => planSandboxCreate(catalog, "a"), /2–24/);
});

test("24 GB is used only when 16 GB is not offered and the API allows it", () => {
  const body = planSandboxCreate(
    {
      ...catalog,
      presets: [
        { value: "max", ramGb: 8, cpuCores: 4 },
        { value: "large", ramGb: 24, cpuCores: 4 },
      ],
    },
    "event",
  );
  assert.equal(body.preset, "large");
  assert.equal(body.ramGb, 24);
});

test("a lower API cap does not request more RAM than the catalog allows", () => {
  const body = planSandboxCreate(
    {
      maxRamGb: 8,
      presets: [
        { value: "light", ramGb: 2, cpuCores: 1 },
        { value: "max", ramGb: 8, cpuCores: 4 },
        { value: "large", ramGb: 24, cpuCores: 4 },
      ],
      versions: { fabric: ["1.21.8", "1.20.1"] },
    },
    "mod",
  );
  assert.equal(body.preset, "max");
  assert.equal(body.ramGb, 8);
  assert.equal(body.serverType, "fabric");
  assert.equal(body.version, "1.21.8");
});

test("sandbox routes stay on /api/sandbox", () => {
  const paths = [
    SANDBOX_ROUTES.options,
    SANDBOX_ROUTES.servers,
    SANDBOX_ROUTES.start("sand/1"),
    SANDBOX_ROUTES.stop("sand/1"),
    SANDBOX_ROUTES.remove("sand/1"),
  ];
  for (const path of paths) {
    assert.match(path, /^\/api\/sandbox\//);
    assert.equal(path.includes("crafty"), false);
    assert.equal(path.includes("auth"), false);
  }
  assert.equal(SANDBOX_ROUTES.start("sand/1"), "/api/sandbox/servers/sand%2F1/start");
});
