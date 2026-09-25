/**
 * A node is one machine that hosts sandbox servers through its own Crafty.
 *
 * Records already carry a `nodeId` and the pool is accounted per node.
 * AD15 is listed when CRAFTY_AD15_BASE_URL is set.
 */
export type SandboxNode = {
  id: string;
  name: string;
  provider: string;
  /** Raw IP, used by the desktop launcher's `address` field. */
  publicIp: string;
  /** Hostname players type into Minecraft (falls back to the IP). */
  publicHost: string;
  /** RAM available to running sandboxes on this node. */
  poolMb: number;
  poolCores: number;
  portStart: number;
  portEnd: number;
  /** False until Crafty on this node is reachable from the control API. */
  available: boolean;
};

export const DEFAULT_NODE_ID = "hetzner-hel";
export const HOMELAB_NODE_ID = "ad15-homelab";

export function listNodes(env: NodeJS.ProcessEnv = process.env): SandboxNode[] {
  const publicIp = env.PUBLIC_HOST_IP?.trim() || env.DEDICATED_HOST_IP?.trim() || "135.181.18.162";
  const nodes: SandboxNode[] = [
    {
      id: env.SANDBOX_NODE_ID?.trim() || DEFAULT_NODE_ID,
      name: env.DEDICATED_HOST_NAME?.trim() || "aetherion",
      provider: env.DEDICATED_HOST_PRODUCT?.trim() || "EX44",
      publicIp,
      publicHost: env.SANDBOX_PUBLIC_HOST?.trim() || publicIp,
      poolMb: Number(env.SANDBOX_POOL_GB || 64) * 1024,
      poolCores: Number(env.SANDBOX_POOL_CORES || 8),
      portStart: Number(env.SANDBOX_PORT_START || 25600),
      portEnd: Number(env.SANDBOX_PORT_END || 25649),
      available: true,
    },
  ];

  const ad15Url = env.CRAFTY_AD15_BASE_URL?.trim();
  const ad15Ip = env.AD15_PUBLIC_IP?.trim() || env.AD15_HOST?.trim() || "192.168.178.117";
  nodes.push({
    id: HOMELAB_NODE_ID,
    name: env.AD15_HOST_NAME?.trim() || "AD15",
    provider: "AD15",
    publicIp: ad15Ip,
    publicHost: env.AD15_PUBLIC_HOST?.trim() || ad15Ip,
    poolMb: Number(env.AD15_POOL_GB || 12) * 1024,
    poolCores: Number(env.AD15_POOL_CORES || 8),
    portStart: Number(env.AD15_PORT_START || 25700),
    portEnd: Number(env.AD15_PORT_END || 25749),
    available: Boolean(ad15Url),
  });

  return nodes;
}

/** Rows written before nodes existed have no nodeId and live on the first node. */
export function nodeFor(nodeId?: string | null) {
  const nodes = listNodes();
  return nodes.find((node) => node.id === nodeId) ?? nodes[0];
}
