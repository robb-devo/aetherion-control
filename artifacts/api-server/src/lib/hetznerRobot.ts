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

async function robotRequest<T>(path: string): Promise<T> {
  const username = process.env.HETZNER_ROBOT_USERNAME;
  const password = process.env.HETZNER_ROBOT_PASSWORD;
  if (!username || !password) throw new Error("Hetzner Robot is not configured");
  const authorization = Buffer.from(`${username}:${password}`).toString("base64");
  const response = await fetch(`https://robot-ws.your-server.de${path}`, {
    headers: { Authorization: `Basic ${authorization}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Hetzner Robot returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function listHetznerDedicatedServers() {
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
  }));
}