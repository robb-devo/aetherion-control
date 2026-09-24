/**
 * A node is one machine that hosts sandbox servers through its own Crafty.
 *
 * Only the Hetzner host exists today. Records already carry a `nodeId` and the
 * pool is accounted per node, so a second host (e.g. the AD15) can be added
 * here later without migrating existing sandboxes.
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
};

export const DEFAULT_NODE_ID = "hetzner-hel";

export function listNodes(env: NodeJS.ProcessEnv = process.env): SandboxNode[] {
  const publicIp = env.PUBLIC_HOST_IP?.trim() || env.DEDICATED_HOST_IP?.trim() || "135.181.18.162";
  return [
    {
      id: env.SANDBOX_NODE_ID?.trim() || DEFAULT_NODE_ID,
      name: env.DEDICATED_HOST_NAME?.trim() || "aetherion",
      provider: env.DEDICATED_HOST_PRODUCT?.trim() || "Hetzner Dedicated",
      publicIp,
      publicHost: env.SANDBOX_PUBLIC_HOST?.trim() || publicIp,
      poolMb: Number(env.SANDBOX_POOL_GB || 64) * 1024,
      poolCores: Number(env.SANDBOX_POOL_CORES || 8),
      portStart: Number(env.SANDBOX_PORT_START || 25600),
      portEnd: Number(env.SANDBOX_PORT_END || 25649),
    },
  ];
}

/** Rows written before nodes existed have no nodeId and live on the first node. */
export function nodeFor(nodeId?: string | null) {
  const nodes = listNodes();
  return nodes.find((node) => node.id === nodeId) ?? nodes[0];
}
