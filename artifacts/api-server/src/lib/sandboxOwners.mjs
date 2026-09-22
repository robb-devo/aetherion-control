import { createHash } from "node:crypto";

/**
 * Stable owner key for a sandbox. Derived from the access-code identity,
 * CONTROL_API_KEY, or a Microsoft player id (`ms:<uuid>`), not the rotating
 * session token.
 */
export function ownerIdFor(code) {
  const identity = String(code || "").trim();
  if (!identity) throw new Error("Missing sandbox owner.");
  return createHash("sha256").update(`aetherion.sandbox.owner.v1:${identity}`).digest("hex");
}

/** 32-char Minecraft/Microsoft UUID, dashed or not. Empty input is null. */
export function normalizePlayerId(raw) {
  const id = String(raw || "").trim().toLowerCase().replace(/-/g, "");
  if (!id) return null;
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("Invalid player id.");
  return id;
}

/**
 * Who a sandbox call is allowed to see.
 * Access-code sessions ignore playerId so an operator cannot spoof another owner.
 * The launcher service key and a master key sent with a player header are scoped
 * to that Microsoft identity and never include legacy unowned rows.
 */
export function scopeForAccess({ code, role, playerId }) {
  const identity = String(code || "").trim();
  if (!identity) throw new Error("Unauthorized");
  if (identity === "LAUNCHER_SERVICE") {
    if (!playerId) throw new Error("Sign in with Microsoft before using sandboxes.");
    return { ownerId: ownerIdFor(`ms:${playerId}`), includeUnowned: false };
  }
  if (identity === "CONTROL_API_KEY" && playerId) {
    return { ownerId: ownerIdFor(`ms:${playerId}`), includeUnowned: false };
  }
  return {
    ownerId: ownerIdFor(identity),
    includeUnowned: role === "owner",
  };
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
