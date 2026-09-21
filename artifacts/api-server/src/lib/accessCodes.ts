import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

export type AccessRole = "owner" | "operator" | "viewer";

export type AccessUser = {
  code: string;
  name: string;
  role: AccessRole;
  enabled?: boolean;
};

export type AccessSession = {
  token: string;
  code: string;
  name: string;
  role: AccessRole;
  permissions: string[];
  createdAt: number;
};

declare global {
  namespace Express {
    interface Request {
      access?: AccessSession | { token: string; name: string; role: "owner"; permissions: string[]; code: "CONTROL_API_KEY" };
    }
  }
}

const ROLE_PERMISSIONS: Record<AccessRole, string[]> = {
  owner: ["*"],
  operator: [
    "servers.read",
    "servers.action",
    "servers.command",
    "servers.files",
    "servers.backups",
    "sandbox",
    "app.update",
    "infrastructure.read",
  ],
  viewer: ["servers.read", "infrastructure.read"],
};

const DEFAULT_CODES: AccessUser[] = [
  { code: "ROBB-OWN1", name: "Robb", role: "owner", enabled: true },
  { code: "LEMON-OPS1", name: "Lemon", role: "operator", enabled: true },
  { code: "ZINO-OPS2", name: "Zino", role: "operator", enabled: true },
  { code: "DAVID-OPS3", name: "David", role: "operator", enabled: true },
  { code: "MONKE-OPS4", name: "Monke", role: "operator", enabled: true },
  { code: "JOSH-OPS5", name: "Josh", role: "operator", enabled: true },
];

const sessions = new Map<string, AccessSession>();

function codesPath() {
  return (
    process.env.ACCESS_CODES_PATH?.trim() ||
    "/opt/aetherion-control/data/access-codes.json"
  );
}

function sessionsPath() {
  return (
    process.env.ACCESS_SESSIONS_PATH?.trim() ||
    "/opt/aetherion-control/data/access-sessions.json"
  );
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function permissionsFor(role: AccessRole) {
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.viewer;
}

function ensureDataDir() {
  const dir = path.dirname(codesPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadAccessCodes(): AccessUser[] {
  ensureDataDir();
  const file = codesPath();
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify({ codes: DEFAULT_CODES }, null, 2), "utf8");
    return DEFAULT_CODES.map((item) => ({ ...item, code: normalizeCode(item.code) }));
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { codes?: AccessUser[] };
    const list = Array.isArray(raw.codes) ? raw.codes : DEFAULT_CODES;
    return list
      .filter((item) => item && typeof item.code === "string")
      .map((item) => ({
        code: normalizeCode(item.code),
        name: String(item.name || "Operator").slice(0, 24),
        role: (["owner", "operator", "viewer"].includes(item.role) ? item.role : "viewer") as AccessRole,
        enabled: item.enabled !== false,
      }));
  } catch {
    return DEFAULT_CODES.map((item) => ({ ...item, code: normalizeCode(item.code) }));
  }
}

function persistSessions() {
  try {
    ensureDataDir();
    writeFileSync(sessionsPath(), JSON.stringify({ sessions: [...sessions.values()] }, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

export function hydrateSessions() {
  try {
    const file = sessionsPath();
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, "utf8")) as { sessions?: AccessSession[] };
    for (const session of raw.sessions ?? []) {
      if (session?.token) sessions.set(session.token, session);
    }
  } catch {
    // ignore
  }
}

hydrateSessions();

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function unlockWithCode(rawCode: string): AccessSession {
  const code = normalizeCode(rawCode);
  if (!code || code.length < 4) throw new Error("Enter a valid access code.");
  const match = loadAccessCodes().find((item) => item.enabled !== false && safeEqual(item.code, code));
  if (!match) throw new Error("Invalid access code.");

  const token = `aes_${randomBytes(24).toString("hex")}`;
  const session: AccessSession = {
    token,
    code: match.code,
    name: match.name,
    role: match.role,
    permissions: permissionsFor(match.role),
    createdAt: Date.now(),
  };
  sessions.set(token, session);
  persistSessions();
  return session;
}

export function getSession(token: string): AccessSession | null {
  return sessions.get(token) ?? null;
}

export function revokeSession(token: string) {
  sessions.delete(token);
  persistSessions();
}

export function hasPermission(
  access: { permissions: string[] } | undefined,
  permission: string,
) {
  if (!access) return false;
  if (access.permissions.includes("*")) return true;
  return access.permissions.includes(permission);
}

/**
 * Accepts CONTROL_API_KEY (owner) or an access-code session token.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const master = process.env.CONTROL_API_KEY?.trim();
  if (!master) {
    res.status(500).json({ error: "CONTROL_API_KEY is not configured on the API server." });
    return;
  }

  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match?.[1]?.trim() ?? "";
  if (!provided) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (safeEqual(provided, master)) {
    req.access = {
      token: provided,
      code: "CONTROL_API_KEY",
      name: "Owner",
      role: "owner",
      permissions: ["*"],
    };
    next();
    return;
  }

  const session = getSession(provided);
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.access = session;
  next();
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasPermission(req.access, permission)) {
      res.status(403).json({ error: `Missing permission: ${permission}` });
      return;
    }
    next();
  };
}

// Keep hash helper available for future hashed-at-rest codes if needed.
export const _debugHash = hashCode;
