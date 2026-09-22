const { getSettings } = require("./paths.cjs");

/** Same host the AETHERION control app uses. */
const DEFAULT_API_BASE = "http://135.181.18.162:5055";
/** Friend-tier credential. Sandbox permission only; never shown in the UI. */
const BAKED_SERVICE_KEY = "aetherion-launcher-friend-v1";

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

function resolveApiBase(settings) {
  const fromSettings = settings?.controlApiBase ? String(settings.controlApiBase).trim() : "";
  const fromEnv = process.env.AETHERION_API_BASE?.trim() || "";
  return normalizeBase(fromSettings || fromEnv || DEFAULT_API_BASE);
}

function resolveServiceKey(settings) {
  const fromSettings = settings?.controlKey ? String(settings.controlKey).trim() : "";
  const fromEnv = process.env.AETHERION_CONTROL_KEY?.trim() || process.env.LAUNCHER_SERVICE_KEY?.trim() || "";
  return fromSettings || fromEnv || BAKED_SERVICE_KEY;
}

function playerHeader(playerId) {
  const id = String(playerId || "").trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(id)) {
    throw new Error("Sign in with Microsoft before using sandboxes.");
  }
  return id;
}

function currentPublic() {
  const settings = getSettings();
  return {
    apiBase: resolveApiBase(settings),
  };
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

async function api(pathname, { method = "GET", body, playerId } = {}) {
  const settings = getSettings();
  const base = resolveApiBase(settings);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${resolveServiceKey(settings)}`,
    "X-Aetherion-Player": playerHeader(playerId),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}/api${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await readBody(response);
  if (!response.ok) {
    const message = data?.error || `Request failed (HTTP ${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function sandboxOptions(playerId) {
  return api("/sandbox/options", { playerId });
}

async function sandboxList(playerId) {
  return api("/sandbox/servers", { playerId });
}

async function sandboxCreate(playerId, input) {
  return api("/sandbox/servers", { method: "POST", body: input || {}, playerId });
}

async function sandboxStart(playerId, id) {
  return api(`/sandbox/servers/${encodeURIComponent(id)}/start`, { method: "POST", playerId });
}

async function sandboxDelete(playerId, id) {
  return api(`/sandbox/servers/${encodeURIComponent(id)}`, { method: "DELETE", playerId });
}

async function sandboxUpload(playerId, { id, path: filePath, content }) {
  return api(`/sandbox/servers/${encodeURIComponent(id)}/files`, {
    method: "POST",
    body: { path: filePath, content },
    playerId,
  });
}

module.exports = {
  DEFAULT_API_BASE,
  normalizeBase,
  currentPublic,
  sandboxOptions,
  sandboxList,
  sandboxCreate,
  sandboxStart,
  sandboxDelete,
  sandboxUpload,
};
