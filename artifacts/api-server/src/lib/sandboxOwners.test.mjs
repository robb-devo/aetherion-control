import assert from "node:assert/strict";
import test from "node:test";
import { canSeeSandbox, findOwned, omitOwner, ownerIdFor, visibleToOwner } from "./sandboxOwners.mjs";

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

test("public sandbox objects do not include ownerId", () => {
  const pub = omitOwner({ id: "a", name: "sandbox-rob", ownerId: rob, port: 25600 });
  assert.equal(Object.hasOwn(pub, "ownerId"), false);
  assert.equal(pub.name, "sandbox-rob");
});
