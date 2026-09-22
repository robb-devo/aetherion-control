const { paths, readJson, writeJson } = require("./paths.cjs");

/** Same host the AETHERION control app uses. */
const DEFAULT_API_BASE = "http://135.181.18.162:5055";

function normalizeBase(value) {
  const raw = String(value || DEFAULT_API_BASE).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("API URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must be http or https.");
  }
  return url.origin;
}

function readSession() {
  const stored = readJson(paths().control, null);
  if (!stored?.token) return null;
  return {
    apiBase: normalizeBase(stored.apiBase || DEFAULT_API_BASE),
    token: String(stored.token),
    displayName: stored.displayName ? String(stored.displayName) : null,
    role: stored.role ? String(stored.role) : null,
    permissions: Array.isArray(stored.permissions) ? stored.permissions.map(String) : [],
  };
}

function publicSession(session) {
  const permissions = session?.permissions || [];
  return {
    apiBase: session?.apiBase || DEFAULT_API_BASE,
    unlocked: Boolean(session?.token),
    displayName: session?.displayName || null,
    role: session?.role || null,
    canSandbox: permissions.includes("*") || permissions.includes("sandbox"),
  };
}

function currentPublic() {
  return publicSession(readSession());
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 280) };
  }
}

async function api(pathname, { method = "GET", body, token } = {}) {
  const session = readSession();
  const base = session?.apiBase || DEFAULT_API_BASE;
  const headers = { Accept: "application/json" };
  const auth = token || session?.token;
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}/api${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await readBody(response);
  if (response.status === 401 && session?.token && token == null) {
    const file = paths().control;
    const { existsSync, unlinkSync } = require("node:fs");
    if (existsSync(file)) unlinkSync(file);
  }
  if (!response.ok) {
    const message = data?.error || `Request failed (HTTP ${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function unlockControl({ code, apiBase }) {
  const base = normalizeBase(apiBase || DEFAULT_API_BASE);
  const secret = String(code || "").trim();
  if (!secret) throw new Error("Enter your access code.");

  const health = await fetch(`${base}/api/healthz`);
  if (!health.ok) throw new Error(`API unreachable (HTTP ${health.status}).`);

  const response = await fetch(`${base}/api/auth/unlock`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ code: secret }),
  });
  const data = await readBody(response);
  if (!response.ok || !data.token) {
    throw new Error(data.error || `Unlock failed (HTTP ${response.status}).`);
  }

  const session = {
    apiBase: base,
    token: data.token,
    displayName: data.displayName || "Operator",
    role: data.role || "viewer",
    permissions: Array.isArray(data.permissions) ? data.permissions : [],
  };
  writeJson(paths().control, session);
  return publicSession(session);
}

async function lockControl() {
  const session = readSession();
  if (session?.token?.startsWith("aes_")) {
    try {
      await fetch(`${session.apiBase}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}`, Accept: "application/json" },
      });
    } catch {
      // best-effort
    }
  }
  const file = paths().control;
  const { existsSync, unlinkSync } = require("node:fs");
  if (existsSync(file)) unlinkSync(file);
  return publicSession(null);
}

function requireSession() {
  const session = readSession();
  if (!session?.token) throw new Error("Connect with your access code first.");
  if (!session.permissions.includes("*") && !session.permissions.includes("sandbox")) {
    throw new Error("This access code cannot use sandbox servers.");
  }
  return session;
}

async function sandboxOptions() {
  requireSession();
  return api("/sandbox/options");
}

async function sandboxList() {
  requireSession();
  return api("/sandbox/servers");
}

async function sandboxCreate(input) {
  requireSession();
  return api("/sandbox/servers", { method: "POST", body: input || {} });
}

async function sandboxStart(id) {
  requireSession();
  return api(`/sandbox/servers/${encodeURIComponent(id)}/start`, { method: "POST" });
}

async function sandboxDelete(id) {
  requireSession();
  return api(`/sandbox/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function sandboxUpload({ id, path: filePath, content }) {
  requireSession();
  return api(`/sandbox/servers/${encodeURIComponent(id)}/files`, {
    method: "POST",
    body: { path: filePath, content },
  });
}

module.exports = {
  DEFAULT_API_BASE,
  currentPublic,
  unlockControl,
  lockControl,
  sandboxOptions,
  sandboxList,
  sandboxCreate,
  sandboxStart,
  sandboxDelete,
  sandboxUpload,
};
