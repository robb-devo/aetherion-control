import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LAUNCHER_SERVICE_KEY,
  classifyBearer,
  hasPermission,
  launcherServiceKey,
} from "./bearerAuth.mjs";

test("launcher friend key defaults and can be rotated", () => {
  assert.equal(launcherServiceKey({}), DEFAULT_LAUNCHER_SERVICE_KEY);
  assert.equal(launcherServiceKey({ LAUNCHER_SERVICE_KEY: "  " }), DEFAULT_LAUNCHER_SERVICE_KEY);
  assert.equal(launcherServiceKey({ LAUNCHER_SERVICE_KEY: " rotated " }), "rotated");
});

test("friend key is sandbox-only and does not need CONTROL_API_KEY", () => {
  const result = classifyBearer(DEFAULT_LAUNCHER_SERVICE_KEY, {});
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.access.code, "LAUNCHER_SERVICE");
  assert.deepEqual(result.access.permissions, ["sandbox"]);
  assert.equal(hasPermission(result.access, "sandbox"), true);
  assert.equal(hasPermission(result.access, "servers.read"), false);
  assert.equal(hasPermission(result.access, "servers.action"), false);
  assert.equal(hasPermission(result.access, "infrastructure.read"), false);
  assert.equal(hasPermission(result.access, "provisioning"), false);
});

test("CONTROL_API_KEY stays owner and is distinct from the friend key", () => {
  const env = { CONTROL_API_KEY: "phone-secret" };
  const owner = classifyBearer("phone-secret", env);
  assert.equal(owner.ok, true);
  if (!owner.ok) return;
  assert.equal(owner.access.code, "CONTROL_API_KEY");
  assert.equal(hasPermission(owner.access, "sandbox"), true);
  assert.equal(hasPermission(owner.access, "servers.action"), true);

  const launcher = classifyBearer(DEFAULT_LAUNCHER_SERVICE_KEY, env);
  assert.equal(launcher.ok, true);
  if (!launcher.ok) return;
  assert.equal(launcher.access.code, "LAUNCHER_SERVICE");
  assert.deepEqual(launcher.access.permissions, ["sandbox"]);

  const rejected = classifyBearer("nope", env);
  assert.deepEqual(rejected, { ok: false, status: 401, error: "Unauthorized" });
});

test("a rotated launcher key replaces the baked default", () => {
  const env = { CONTROL_API_KEY: "phone-secret", LAUNCHER_SERVICE_KEY: "other-friend" };
  const baked = classifyBearer(DEFAULT_LAUNCHER_SERVICE_KEY, env);
  assert.equal(baked.ok, false);
  if (baked.ok) return;
  assert.equal(baked.status, 401);
  const rotated = classifyBearer("other-friend", env);
  assert.equal(rotated.ok, true);
  if (!rotated.ok) return;
  assert.equal(rotated.access.code, "LAUNCHER_SERVICE");
});

test("missing bearer is 401, and a non-friend key without CONTROL_API_KEY is 500", () => {
  assert.equal(classifyBearer("", {}).status, 401);
  const missing = classifyBearer("phone-secret", {});
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.status, 500);
});

test("identical master and launcher secrets stay the owner principal", () => {
  const env = { CONTROL_API_KEY: DEFAULT_LAUNCHER_SERVICE_KEY };
  const result = classifyBearer(DEFAULT_LAUNCHER_SERVICE_KEY, env);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.access.code, "CONTROL_API_KEY");
  assert.equal(hasPermission(result.access, "servers.read"), true);
});
