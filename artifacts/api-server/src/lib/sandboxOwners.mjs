import { createHash } from "node:crypto";

/**
 * Stable owner key for a sandbox. Derived from the access-code identity
 * (or CONTROL_API_KEY), not the rotating session token.
 */
export function ownerIdFor(code) {
  const identity = String(code || "").trim();
  if (!identity) throw new Error("Missing sandbox owner.");
  return createHash("sha256").update(`aetherion.sandbox.owner.v1:${identity}`).digest("hex");
}

export function canSeeSandbox(row, scope) {
  if (!scope?.ownerId) return false;
  if (row?.ownerId && row.ownerId === scope.ownerId) return true;
  // Legacy rows written before ownership existed. Only the owner role may see
  // them, so the pool can be cleaned up without showing them to other users.
  if (row && !row.ownerId && scope.includeUnowned) return true;
  return false;
}

export function visibleToOwner(rows, scope) {
  return (Array.isArray(rows) ? rows : []).filter((row) => canSeeSandbox(row, scope));
}

export function findOwned(rows, id, scope) {
  const row = (Array.isArray(rows) ? rows : []).find((item) => item && item.id === id);
  if (!row || !canSeeSandbox(row, scope)) return undefined;
  return row;
}

export function omitOwner(row) {
  if (!row || typeof row !== "object") return row;
  const { ownerId: _omit, ...rest } = row;
  return rest;
}
