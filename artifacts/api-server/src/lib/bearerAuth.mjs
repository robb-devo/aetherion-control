import { timingSafeEqual } from "node:crypto";

export const DEFAULT_LAUNCHER_SERVICE_KEY = "aetherion-launcher-friend-v1";

export function launcherServiceKey(env = process.env) {
  return env.LAUNCHER_SERVICE_KEY?.trim() || DEFAULT_LAUNCHER_SERVICE_KEY;
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * CONTROL_API_KEY is the phone-app owner credential.
 * The launcher friend key is accepted even when CONTROL_API_KEY is unset,
 * and it only receives the sandbox permission.
 * If both secrets are the same string, the owner principal wins.
 */
export function classifyBearer(provided, env = process.env) {
  const token = String(provided || "").trim();
  if (!token) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const master = env.CONTROL_API_KEY?.trim() || "";
  const launcherKey = launcherServiceKey(env);

  if (master && safeEqual(token, master)) {
    return {
      ok: true,
      access: {
        token,
        code: "CONTROL_API_KEY",
        name: "Owner",
        role: "owner",
        permissions: ["*"],
      },
    };
  }

  if (launcherKey && safeEqual(token, launcherKey)) {
    return {
      ok: true,
      access: {
        token,
        code: "LAUNCHER_SERVICE",
        name: "Launcher",
        role: "operator",
        permissions: ["sandbox"],
      },
    };
  }

  if (!master) {
    return {
      ok: false,
      status: 500,
      error: "CONTROL_API_KEY is not configured on the API server.",
    };
  }

  return { ok: false, status: 401, error: "Unauthorized" };
}

export function hasPermission(access, permission) {
  if (!access) return false;
  if (access.permissions.includes("*")) return true;
  return access.permissions.includes(permission);
}
