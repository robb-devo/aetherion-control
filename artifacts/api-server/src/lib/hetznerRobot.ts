import { readFileSync } from "node:fs";
import os from "node:os";

type RobotServerResponse = {
  server: {
    server_ip: string;
    server_ipv6_net: string;
    server_number: number;
    server_name: string;
    product: string;
    dc: string;
    traffic: string;
    status: string;
    cancelled: boolean;
    paid_until: string;
    ip?: string[];
  };
};

export type DedicatedHost = {
  id: string;
  name: string;
  serverIp: string;
  ipv6Network: string;
  product: string;
  datacenter: string;
  traffic: string;
  status: string;
  cancelled: boolean;
  paidUntil: string;
  additionalIps: string[];
  source: "robot" | "local";
};

async function robotRequest<T>(path: string): Promise<T> {
  const username = process.env.HETZNER_ROBOT_USERNAME?.trim();
  const password = process.env.HETZNER_ROBOT_PASSWORD?.trim();
  if (!username || !password) throw new Error("Hetzner Robot is not configured");
  const authorization = Buffer.from(`${username}:${password}`).toString("base64");
  const response = await fetch(`https://robot-ws.your-server.de${path}`, {
    headers: { Authorization: `Basic ${authorization}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Hetzner Robot returned ${response.status}`);
  return response.json() as Promise<T>;
}

function readPublicIp() {
  return (
    process.env.DEDICATED_HOST_IP?.trim() ||
    process.env.PUBLIC_HOST_IP?.trim() ||
    "135.181.18.162"
  );
}

function localDedicatedHost(): DedicatedHost {
  let uptimeDays = "";
  try {
    const seconds = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
    if (Number.isFinite(seconds)) uptimeDays = `${Math.floor(seconds / 86400)}d up`;
  } catch {
    uptimeDays = "";
  }
  const load = os.loadavg()[0];
  return {
    id: "local-aetherion",
    name: process.env.DEDICATED_HOST_NAME?.trim() || os.hostname() || "aetherion",
    serverIp: readPublicIp(),
    ipv6Network: process.env.DEDICATED_HOST_IPV6?.trim() || "",
    product: process.env.DEDICATED_HOST_PRODUCT?.trim() || "Hetzner Dedicated",
    datacenter: process.env.DEDICATED_HOST_DC?.trim() || "HEL / FSN",
    traffic: uptimeDays || `${os.cpus().length} cores`,
    status: "ready",
    cancelled: false,
    paidUntil: load >= 0 ? `load ${load.toFixed(2)}` : "—",
    additionalIps: [],
    source: "local",
  };
}

export async function listHetznerDedicatedServers(): Promise<DedicatedHost[]> {
  const username = process.env.HETZNER_ROBOT_USERNAME?.trim();
  const password = process.env.HETZNER_ROBOT_PASSWORD?.trim();
  if (!username || !password) {
    return [localDedicatedHost()];
  }

  try {
    const rows = await robotRequest<RobotServerResponse[]>("/server");
    return rows.map(({ server }) => ({
      id: String(server.server_number),
      name: server.server_name || server.product,
      serverIp: server.server_ip,
      ipv6Network: server.server_ipv6_net,
      product: server.product,
      datacenter: server.dc,
      traffic: server.traffic,
      status: server.status,
      cancelled: server.cancelled,
      paidUntil: server.paid_until,
      additionalIps: Array.isArray(server.ip) ? server.ip : [],
      source: "robot" as const,
    }));
  } catch (error) {
    // Keep the app usable if Robot credentials are wrong/expired.
    const fallback = localDedicatedHost();
    fallback.traffic = error instanceof Error ? `Robot offline · ${fallback.traffic}` : fallback.traffic;
    return [fallback];
  }
}
