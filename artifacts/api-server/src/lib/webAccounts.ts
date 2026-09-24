import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ownerIdFor, type OwnerScope } from "./sandboxOwners.mjs";

/**
 * Website accounts: a username and a password, nothing else.
 * Passwords are scrypt hashes; session tokens are random and stored only as
 * sha256 so a leaked sessions file cannot be replayed.
 */

export type WebUser = {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
};

type WebSession = {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
};

export class AccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 12 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9_.-]{3,20}$/;
const RESERVED = new Set(["admin", "administrator", "owner", "root", "system", "staff", "support", "aetherion", "donnernet", "moderator"]);
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

function accountsPath() {
  return process.env.WEB_ACCOUNTS_PATH || "/var/lib/aetherion-control/web-accounts.json";
}

function sessionsPath() {
  return process.env.WEB_SESSIONS_PATH || "/var/lib/aetherion-control/web-sessions.json";
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
}

let users: WebUser[] | null = null;
let sessions: Map<string, WebSession> | null = null;

function loadUsers() {
  if (!users) {
    const raw = readJson<{ users?: WebUser[] }>(accountsPath(), {});
    users = Array.isArray(raw.users) ? raw.users : [];
  }
  return users;
}

function saveUsers() {
  writeJson(accountsPath(), { users: loadUsers() });
}

function loadSessions() {
  if (!sessions) {
    const raw = readJson<{ sessions?: WebSession[] }>(sessionsPath(), {});
    const now = Date.now();
    sessions = new Map(
      (Array.isArray(raw.sessions) ? raw.sessions : [])
        .filter((session) => session?.tokenHash && session.expiresAt > now)
        .map((session) => [session.tokenHash, session]),
    );
  }
  return sessions;
}

function saveSessions() {
  const now = Date.now();
  const live = [...loadSessions().values()].filter((session) => session.expiresAt > now);
  writeJson(sessionsPath(), { sessions: live });
}

/** Test hook: forget cached files so a test can point at fresh paths. */
export function resetAccountCache() {
  users = null;
  sessions = null;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, N, r, p, salt, key] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(N), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Equalises timing for unknown usernames so logins do not reveal which names exist.
let dummyHash: Promise<string> | null = null;

export function normalizeUsername(raw: unknown) {
  const username = String(raw ?? "").trim();
  if (!USERNAME.test(username)) {
    throw new AccountError(
      "INVALID_USERNAME",
      "Usernames are 3–20 characters: letters, numbers, dot, dash or underscore.",
    );
  }
  return { username, usernameKey: username.toLowerCase() };
}

export function validatePassword(raw: unknown) {
  const password = typeof raw === "string" ? raw : "";
  if (password.length < 8 || password.length > 128) {
    throw new AccountError("INVALID_PASSWORD", "Passwords need at least 8 characters.");
  }
  return password;
}

export async function registerUser(rawUsername: unknown, rawPassword: unknown) {
  const { username, usernameKey } = normalizeUsername(rawUsername);
  const password = validatePassword(rawPassword);
  if (RESERVED.has(usernameKey)) {
    throw new AccountError("USERNAME_TAKEN", "That username is taken.", 409);
  }
  if (loadUsers().some((user) => user.usernameKey === usernameKey)) {
    throw new AccountError("USERNAME_TAKEN", "That username is taken.", 409);
  }
  const passwordHash = await hashPassword(password);
  // Re-check after the async hash so two parallel sign-ups cannot both win.
  if (loadUsers().some((user) => user.usernameKey === usernameKey)) {
    throw new AccountError("USERNAME_TAKEN", "That username is taken.", 409);
  }
  const user: WebUser = {
    id: randomUUID(),
    username,
    usernameKey,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  loadUsers().push(user);
  saveUsers();
  return user;
}

export async function authenticate(rawUsername: unknown, rawPassword: unknown) {
  const usernameKey = String(rawUsername ?? "").trim().toLowerCase();
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const user = loadUsers().find((item) => item.usernameKey === usernameKey);
  if (!user) {
    dummyHash ??= hashPassword("aetherion-timing-equaliser");
    await verifyPassword(password, await dummyHash);
    throw new AccountError("INVALID_LOGIN", "Wrong username or password.", 401);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AccountError("INVALID_LOGIN", "Wrong username or password.", 401);
  }
  user.lastLoginAt = new Date().toISOString();
  saveUsers();
  return user;
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  loadSessions().set(hashToken(token), {
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
  });
  saveSessions();
  return token;
}

/** Sliding expiry: an active session keeps extending, an idle one lapses after 30 days. */
export function userForSession(token: string | undefined | null) {
  if (!token) return null;
  const store = loadSessions();
  const key = hashToken(token);
  const session = store.get(key);
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now) {
    store.delete(key);
    saveSessions();
    return null;
  }
  const user = loadUsers().find((item) => item.id === session.userId);
  if (!user) {
    store.delete(key);
    saveSessions();
    return null;
  }
  if (now - session.lastSeenAt > SESSION_TOUCH_MS) {
    session.lastSeenAt = now;
    session.expiresAt = now + SESSION_TTL_MS;
    saveSessions();
  }
  return user;
}

export function revokeSession(token: string | undefined | null) {
  if (!token) return;
  if (loadSessions().delete(hashToken(token))) saveSessions();
}

export function publicUser(user: WebUser) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

/** Website accounts own sandboxes under their own namespace, apart from launcher Microsoft ids. */
export function scopeForWebUser(user: Pick<WebUser, "id">): OwnerScope {
  return { ownerId: ownerIdFor(`web:${user.id}`), includeUnowned: false };
}

/** Fixed-window counter; small and in-process on purpose (single API instance). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(key: string) {
    const now = Date.now();
    if (this.hits.size > 5000) {
      for (const [entryKey, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(entryKey);
    }
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > this.max) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
