import { readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import net from "node:net";

/**
 * Real-time view of sandbox servers on the local node.
 *
 * Crafty only refreshes its stats every 30 s, which is too slow to show
 * "starting → online" or to enforce the one-running-server rule. The control
 * API runs on the same host as Crafty, so it can look at the process table and
 * speak the Minecraft status protocol directly.
 */

export type ServerProcess = {
  pid: number;
  startedAt: string | null;
  rssMb: number | null;
};

export type ServerPing = {
  online: number;
  max: number;
  players: string[];
  version: string;
  motd: string;
  latencyMs: number;
};

const CLOCK_TICKS_PER_SECOND = 100;
const SNAPSHOT_TTL_MS = 1500;

let bootTimeSec: number | null = null;
let snapshot: { at: number; byCwd: Map<string, ServerProcess> } | null = null;
const realPaths = new Map<string, string>();

export function probeSupported() {
  return process.platform === "linux";
}

function bootTime() {
  if (bootTimeSec != null) return bootTimeSec;
  const match = /^btime\s+(\d+)/m.exec(readFileSync("/proc/stat", "utf8"));
  bootTimeSec = match ? Number(match[1]) : 0;
  return bootTimeSec;
}

function readProcess(pid: number): ServerProcess {
  let startedAt: string | null = null;
  let rssMb: number | null = null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Fields after the parenthesised command name; starttime is field 22.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[19]);
    const boot = bootTime();
    if (Number.isFinite(ticks) && boot > 0) {
      startedAt = new Date((boot + ticks / CLOCK_TICKS_PER_SECOND) * 1000).toISOString();
    }
  } catch {
    // process exited between readdir and read
  }
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    if (match) rssMb = Math.round(Number(match[1]) / 1024);
  } catch {
    // ignore
  }
  return { pid, startedAt, rssMb };
}

function scan() {
  const byCwd = new Map<string, ServerProcess>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readFileSync(`/proc/${entry}/comm`, "utf8").trim() !== "java") continue;
      const cwd = readlinkSync(`/proc/${entry}/cwd`);
      if (!byCwd.has(cwd)) byCwd.set(cwd, readProcess(Number(entry)));
    } catch {
      // not ours to read, or already gone
    }
  }
  return byCwd;
}

function resolvePath(value: string) {
  const cached = realPaths.get(value);
  if (cached) return cached;
  let resolved = value.replace(/\/+$/, "");
  try {
    resolved = realpathSync(resolved);
  } catch {
    // directory may not exist yet
  }
  realPaths.set(value, resolved);
  return resolved;
}

/**
 * `undefined` means the probe cannot answer (non-Linux dev machine or no path),
 * `null` means no Java process runs in that server directory.
 */
export function findServerProcess(serverPath: string | null | undefined): ServerProcess | null | undefined {
  if (!probeSupported() || !serverPath) return undefined;
  if (!snapshot || Date.now() - snapshot.at > SNAPSHOT_TTL_MS) {
    snapshot = { at: Date.now(), byCwd: scan() };
  }
  return snapshot.byCwd.get(resolvePath(serverPath)) ?? null;
}

export function invalidateProbe() {
  snapshot = null;
}

function varInt(value: number) {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset: number): [number, number] | null {
  let result = 0;
  let shift = 0;
  let position = offset;
  for (;;) {
    if (position >= buffer.length) return null;
    const byte = buffer[position++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, position];
    shift += 7;
    if (shift > 35) throw new Error("VarInt too long");
  }
}

function frame(packetId: number, payload: Buffer) {
  const body = Buffer.concat([varInt(packetId), payload]);
  return Buffer.concat([varInt(body.length), body]);
}

function mcString(value: string) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([varInt(bytes.length), bytes]);
}

export function flattenChat(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenChat).join("");
  if (value && typeof value === "object") {
    const record = value as { text?: unknown; extra?: unknown };
    return flattenChat(record.text ?? "") + flattenChat(record.extra ?? "");
  }
  return "";
}

export function parseStatusResponse(data: unknown, latencyMs: number): ServerPing {
  const record = (data && typeof data === "object" ? data : {}) as {
    players?: { online?: unknown; max?: unknown; sample?: unknown };
    version?: { name?: unknown };
    description?: unknown;
  };
  const sample = Array.isArray(record.players?.sample) ? record.players.sample : [];
  return {
    online: Number(record.players?.online ?? 0) || 0,
    max: Number(record.players?.max ?? 0) || 0,
    players: sample
      .map((entry) => (entry && typeof entry === "object" ? (entry as { name?: unknown }).name : null))
      .filter((name): name is string => typeof name === "string")
      .slice(0, 12),
    version: typeof record.version?.name === "string" ? record.version.name : "",
    motd: flattenChat(record.description).replace(/§./g, "").trim(),
    latencyMs,
  };
}

/** Minecraft Server List Ping. Resolves null when nothing answers in time. */
export function pingMinecraft(host: string, port: number, timeoutMs = 1500): Promise<ServerPing | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const deadline = setTimeout(() => finish(null), timeoutMs);
    const finish = (result: ServerPing | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve(result);
    };
    socket.on("error", () => finish(null));
    socket.on("connect", () => {
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      const handshake = frame(0x00, Buffer.concat([varInt(767), mcString(host), portBytes, varInt(1)]));
      socket.write(Buffer.concat([handshake, frame(0x00, Buffer.alloc(0))]));
    });
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 1 << 20) {
        finish(null);
        return;
      }
      try {
        const length = readVarInt(buffer, 0);
        if (!length || buffer.length < length[1] + length[0]) return;
        const packetId = readVarInt(buffer, length[1]);
        if (!packetId || packetId[0] !== 0) {
          finish(null);
          return;
        }
        const text = readVarInt(buffer, packetId[1]);
        if (!text) {
          finish(null);
          return;
        }
        const json = buffer.subarray(text[1], text[1] + text[0]).toString("utf8");
        finish(parseStatusResponse(JSON.parse(json), Date.now() - started));
      } catch {
        finish(null);
      }
    });
  });
}
