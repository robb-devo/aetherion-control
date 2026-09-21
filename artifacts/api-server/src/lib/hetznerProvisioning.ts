import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { logger } from "./logger";

type ServerType = "vanilla" | "paper" | "purpur";
type JobStatus = "queued" | "provisioning" | "installing" | "ready" | "failed";
type StepState = "pending" | "active" | "complete" | "failed";

export type ProvisioningInput = {
  name: string;
  version: string;
  serverType: ServerType;
  region: "nbg1" | "fsn1" | "hel1";
  size: "cpx22" | "cpx32" | "cpx42";
};

export type ProvisioningJob = {
  id: string;
  ownerId: string;
  name: string;
  status: JobStatus;
  progress: number;
  message: string;
  publicIp: string | null;
  createdAt: string;
  serverId?: number;
  steps: Array<{ key: string; label: string; state: StepState }>;
};

const jobs = new Map<string, ProvisioningJob>();
const versions = ["1.21.8", "1.21.7", "1.21.5", "1.20.6"];
const types = new Set<ServerType>(["vanilla", "paper", "purpur"]);
const regions = new Set(["nbg1", "fsn1", "hel1"]);
const sizes = new Set(["cpx22", "cpx32", "cpx42"]);
const steps = [
  { key: "host", label: "Create dedicated host" },
  { key: "boot", label: "Boot secure workload" },
  { key: "agent", label: "Install Aetherion Agent and Crafty" },
  { key: "verify", label: "Verify Minecraft service" },
];

export const provisioningOptions = {
  configured: Boolean(process.env.HETZNER_API_TOKEN),
  versions: versions.map((value) => ({ value, label: value })),
  serverTypes: [
    { value: "vanilla", label: "Vanilla" },
    { value: "paper", label: "Paper" },
    { value: "purpur", label: "Purpur" },
  ],
  regions: [
    { value: "nbg1", label: "Nuremberg, DE" },
    { value: "fsn1", label: "Falkenstein, DE" },
    { value: "hel1", label: "Helsinki, FI" },
  ],
  sizes: [
    { value: "cpx22", label: "4 GB · 2 vCPU", ramGb: 4, cpu: 2 },
    { value: "cpx32", label: "8 GB · 4 vCPU", ramGb: 8, cpu: 4 },
    { value: "cpx42", label: "16 GB · 8 vCPU", ramGb: 16, cpu: 8 },
  ],
};

export function isValidProvisioningInput(input: ProvisioningInput) {
  return /^[a-zA-Z0-9-]{3,32}$/.test(input.name)
    && versions.includes(input.version)
    && types.has(input.serverType)
    && regions.has(input.region)
    && sizes.has(input.size);
}

export function createProvisioningJob(ownerId: string, input: ProvisioningInput) {
  const job: ProvisioningJob = {
    id: randomUUID(),
    ownerId,
    name: input.name,
    status: "queued",
    progress: 5,
    message: "Provisioning request queued",
    publicIp: null,
    createdAt: new Date().toISOString(),
    steps: steps.map((step) => ({ ...step, state: "pending" })),
  };
  jobs.set(job.id, job);
  void provision(job, input);
  return publicJob(job);
}

export function getProvisioningJob(id: string, ownerId: string) {
  const job = jobs.get(id);
  return job?.ownerId === ownerId ? publicJob(job) : null;
}

function publicJob(job: ProvisioningJob) {
  const { ownerId: _ownerId, serverId: _serverId, ...safe } = job;
  return safe;
}

function activate(job: ProvisioningJob, index: number, status: JobStatus, progress: number, message: string) {
  job.steps = job.steps.map((step, stepIndex) => ({
    ...step,
    state: stepIndex < index ? "complete" : stepIndex === index ? "active" : "pending",
  }));
  Object.assign(job, { status, progress, message });
}

async function hetznerRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("Hetzner provisioning is not configured");
  const response = await fetch(`https://api.hetzner.cloud/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Hetzner API returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

function cloudInit(input: ProvisioningInput) {
  const payload = Buffer.from(JSON.stringify({
    name: input.name,
    version: input.version,
    serverType: input.serverType,
  })).toString("base64");
  return `#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, curl]
write_files:
  - path: /opt/aetherion/server.json.b64
    permissions: "0600"
    encoding: b64
    content: ${Buffer.from(payload).toString("base64")}
  - path: /opt/aetherion/compose.yaml
    permissions: "0600"
    content: |
      services:
        crafty:
          image: registry.gitlab.com/crafty-controller/crafty-4:latest
          restart: unless-stopped
          ports: ["8443:8443", "25565:25565"]
          volumes:
            - crafty-backups:/crafty/backups
            - crafty-logs:/crafty/logs
            - crafty-servers:/crafty/servers
            - crafty-config:/crafty/app/config
        agent:
          image: ghcr.io/aetherion-cloud/agent:latest
          restart: unless-stopped
          volumes:
            - /var/run/docker.sock:/var/run/docker.sock
            - /opt/aetherion/server.json.b64:/run/aetherion/server.json.b64:ro
      volumes:
        crafty-backups: {}
        crafty-logs: {}
        crafty-servers: {}
        crafty-config: {}
runcmd:
  - [sh, -c, "cd /opt/aetherion && docker compose up -d"]
  - [sh, -c, "touch /opt/aetherion/ready"]
`;
}

async function waitForServer(serverId: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const data = await hetznerRequest<{ server: { status: string } }>(`/servers/${serverId}`);
    if (data.server.status === "running") return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Host did not enter running state in time");
}

async function provision(job: ProvisioningJob, input: ProvisioningInput) {
  try {
    activate(job, 0, "provisioning", 15, "Creating Hetzner host");
    const created = await hetznerRequest<{
      server: { id: number; public_net: { ipv4: { ip: string } } };
    }>("/servers", {
      method: "POST",
      body: JSON.stringify({
        name: `aetherion-${input.name.toLowerCase()}-${job.id.slice(0, 6)}`,
        server_type: input.size,
        image: "ubuntu-24.04",
        location: input.region,
        user_data: cloudInit(input),
        labels: { managed_by: "aetherion", provisioning_job: job.id },
        public_net: { enable_ipv4: true, enable_ipv6: true },
        start_after_create: true,
      }),
    });
    job.serverId = created.server.id;
    job.publicIp = created.server.public_net.ipv4.ip;
    activate(job, 1, "provisioning", 35, "Host created; waiting for boot");
    await waitForServer(created.server.id);
    activate(job, 2, "installing", 65, "Installing Aetherion Agent and Crafty");
    await new Promise((resolve) => setTimeout(resolve, 15000));
    activate(job, 3, "installing", 90, "Verifying Minecraft workload");
    await waitForPort(job.publicIp, 8443);
    job.steps = job.steps.map((step) => ({ ...step, state: "complete" }));
    Object.assign(job, { status: "ready", progress: 100, message: "Dedicated Minecraft host is ready" });
    logger.info({ event: "provisioning_succeeded", jobId: job.id, userId: job.ownerId, serverId: job.serverId }, "Provisioning audit event");
  } catch (error) {
    const activeIndex = job.steps.findIndex((step) => step.state === "active");
    if (activeIndex >= 0) job.steps[activeIndex].state = "failed";
    Object.assign(job, {
      status: "failed",
      message: error instanceof Error ? error.message : "Provisioning failed",
    });
    let rollback = "not_required";
    if (job.serverId) {
      try {
        await hetznerRequest(`/servers/${job.serverId}`, { method: "DELETE" });
        rollback = "server_deleted";
        job.publicIp = null;
      } catch (rollbackError) {
        rollback = "delete_failed";
        logger.error({ error: rollbackError, jobId: job.id, serverId: job.serverId }, "Provisioning rollback failed");
      }
    }
    logger.error({
      event: "provisioning_failed",
      jobId: job.id,
      userId: job.ownerId,
      serverId: job.serverId,
      rollback,
      error,
    }, "Provisioning audit event");
  }
}

function canConnect(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (connected: boolean) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(5000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(host: string, port: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await canConnect(host, port)) return;
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error("Crafty workload did not become reachable");
}