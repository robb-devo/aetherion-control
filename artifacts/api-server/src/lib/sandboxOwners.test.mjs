import assert from "node:assert/strict";
import test from "node:test";
import {
  canSeeSandbox,
  findOwned,
  normalizePlayerId,
  omitOwner,
  ownerIdFor,
  scopeForAccess,
  visibleToOwner,
} from "./sandboxOwners.mjs";

const rob = ownerIdFor("ROBB-OWN1");
const lemon = ownerIdFor("LEMON-OPS1");

test("owner ids are stable and distinct per access identity", () => {
  assert.equal(ownerIdFor("ROBB-OWN1"), rob);
  assert.notEqual(rob, lemon);
  assert.throws(() => ownerIdFor("  "), /owner/);
});

test("lists only the caller's sandboxes", () => {
  const rows = [
    { id: "a", name: "sandbox-rob", ownerId: rob },
    { id: "b", name: "sandbox-lemon", ownerId: lemon },
    { id: "c", name: "sandbox-legacy" },
  ];
  const seen = visibleToOwner(rows, { ownerId: lemon });
  assert.deepEqual(seen.map((row) => row.id), ["b"]);
  assert.equal(findOwned(rows, "a", { ownerId: lemon }), undefined);
  assert.equal(findOwned(rows, "missing", { ownerId: lemon }), undefined);
});

test("owner role can see unowned legacy rows but not other users", () => {
  const rows = [
    { id: "a", name: "sandbox-rob", ownerId: rob },
    { id: "c", name: "sandbox-legacy" },
  ];
  const seen = visibleToOwner(rows, { ownerId: rob, includeUnowned: true });
  assert.deepEqual(seen.map((row) => row.id), ["a", "c"]);
  assert.equal(findOwned(rows, "a", { ownerId: lemon, includeUnowned: true }), undefined);
  assert.equal(findOwned(rows, "c", { ownerId: rob, includeUnowned: true })?.id, "c");
  assert.equal(canSeeSandbox({ ownerId: lemon }, { ownerId: rob, includeUnowned: true }), false);
});

test("microsoft player ids scope separately from access codes", () => {
  const dashed = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
  const plain = normalizePlayerId(dashed);
  assert.equal(plain, "a1b2c3d4e5f67890abcdef1234567890");
  assert.equal(normalizePlayerId(plain), plain);
  assert.equal(normalizePlayerId("  "), null);
  assert.throws(() => normalizePlayerId("not-a-uuid"), /Invalid player id/);

  const player = scopeForAccess({
    code: "LAUNCHER_SERVICE",
    role: "operator",
    playerId: plain,
  });
  assert.equal(player.includeUnowned, false);
  assert.equal(player.ownerId, ownerIdFor(`ms:${plain}`));
  assert.notEqual(player.ownerId, ownerIdFor("LEMON-OPS1"));
  assert.throws(
    () => scopeForAccess({ code: "LAUNCHER_SERVICE", role: "operator", playerId: null }),
    /Sign in with Microsoft/,
  );

  const spoofed = scopeForAccess({
    code: "LEMON-OPS1",
    role: "operator",
    playerId: plain,
  });
  assert.equal(spoofed.ownerId, lemon);
  assert.equal(spoofed.includeUnowned, false);

  const master = scopeForAccess({
    code: "CONTROL_API_KEY",
    role: "owner",
    playerId: plain,
  });
  assert.equal(master.ownerId, ownerIdFor(`ms:${plain}`));
  assert.equal(master.includeUnowned, false);

  const owner = scopeForAccess({ code: "CONTROL_API_KEY", role: "owner", playerId: null });
  assert.equal(owner.includeUnowned, true);
  assert.equal(owner.ownerId, ownerIdFor("CONTROL_API_KEY"));
});

test("public sandbox objects do not include ownerId", () => {
  const pub = omitOwner({ id: "a", name: "sandbox-rob", ownerId: rob, port: 25600 });
  assert.equal(Object.hasOwn(pub, "ownerId"), false);
  assert.equal(pub.name, "sandbox-rob");
});
