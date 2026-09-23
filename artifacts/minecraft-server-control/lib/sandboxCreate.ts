/**
 * One-tap sandbox create plan.
 * 16 GB (`balanced`) when the API offers it, otherwise 24 GB (`large`) if that fits.
 * Paper and the newest stable 1.21 when the catalog has them.
 * The body is only what POST /api/sandbox/servers already accepts.
 */

export const SANDBOX_ROUTES = {
  options: "/api/sandbox/options",
  servers: "/api/sandbox/servers",
  start: (id: string) => `/api/sandbox/servers/${encodeURIComponent(id)}/start`,
  stop: (id: string) => `/api/sandbox/servers/${encodeURIComponent(id)}/stop`,
  remove: (id: string) => `/api/sandbox/servers/${encodeURIComponent(id)}`,
} as const;

export type SandboxEngine = "vanilla" | "paper" | "fabric" | "purpur";

export type SandboxPresetOption = {
  value: string;
  ramGb: number;
  cpuCores: number;
};

export type SandboxOptions = {
  maxRamGb?: number;
  maxCores?: number;
  presets?: SandboxPresetOption[];
  versions?: Partial<Record<SandboxEngine, string[]>>;
};

export type SandboxCreateBody = {
  name: string;
  serverType: SandboxEngine;
  version: string;
  preset: string;
  ramGb: number;
  cpuCores: number;
  startAfterCreate: true;
};

const ENGINE_ORDER: SandboxEngine[] = ["paper", "purpur", "fabric", "vanilla"];

const NAME_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function suggestSandboxName(random: () => number = Math.random): string {
  let suffix = "";
  for (let i = 0; i < 4; i += 1) {
    suffix += NAME_ALPHABET[Math.floor(random() * NAME_ALPHABET.length)] ?? "a";
  }
  return `welt-${suffix}`;
}

export function normalizeSandboxName(raw: string, random: () => number = Math.random): string {
  const trimmed = raw.trim();
  const source = trimmed || suggestSandboxName(random);
  const cleaned = source.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) return suggestSandboxName(random);
  if (cleaned.length < 2 || cleaned.length > 24) {
    throw new Error("Name muss 2–24 Zeichen haben.");
  }
  return cleaned;
}

function versionParts(value: string): number[] {
  return value.split(/[^0-9]+/).filter(Boolean).map((part) => Number(part));
}

function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta) return delta;
  }
  return a.localeCompare(b);
}

function isStable(value: string): boolean {
  return !/(snapshot|pre|rc|alpha|beta)/i.test(value);
}

function pickVersion(versions: string[]): string | undefined {
  const pool = versions.map((item) => item.trim()).filter(Boolean);
  const modern = pool.filter((item) => item === "1.21" || item.startsWith("1.21."));
  const ranked = (modern.length ? modern : pool).slice().sort(compareVersions);
  const stable = ranked.filter(isStable);
  return (stable.length ? stable : ranked).at(-1);
}

function pickEngine(versions: SandboxOptions["versions"]): { serverType: SandboxEngine; version: string } | null {
  const catalog = versions ?? {};
  for (const serverType of ENGINE_ORDER) {
    const version = pickVersion(catalog[serverType] ?? []);
    if (version) return { serverType, version };
  }
  return null;
}

function pickPreset(options: SandboxOptions): { preset: string; ramGb: number; cpuCores: number } {
  const maxRam = Number.isFinite(options.maxRamGb) ? Number(options.maxRamGb) : 24;
  const maxCores = Number.isFinite(options.maxCores) ? Number(options.maxCores) : 4;
  const allowed = (options.presets ?? []).filter(
    (preset) => preset.value !== "custom" && preset.ramGb >= 1 && preset.ramGb <= maxRam,
  );

  const sixteen =
    allowed.find((preset) => preset.value === "balanced" && preset.ramGb === 16) ??
    allowed.find((preset) => preset.ramGb === 16);
  const twentyFour =
    allowed.find((preset) => preset.value === "large" && preset.ramGb === 24) ??
    allowed.find((preset) => preset.ramGb === 24);
  const atLeastSixteen = allowed
    .filter((preset) => preset.ramGb >= 16)
    .sort((a, b) => b.ramGb - a.ramGb)[0];
  const largest = allowed.slice().sort((a, b) => b.ramGb - a.ramGb)[0];
  const chosen = sixteen ?? (maxRam >= 24 ? twentyFour : undefined) ?? atLeastSixteen ?? largest;

  if (chosen) {
    const cpuCores = Math.max(1, Math.min(maxCores, chosen.cpuCores || 4));
    return { preset: chosen.value, ramGb: chosen.ramGb, cpuCores };
  }

  if (maxRam >= 16) {
    return { preset: "balanced", ramGb: 16, cpuCores: Math.max(1, Math.min(maxCores, 4)) };
  }

  throw new Error("Keine passende Sandbox-Größe verfügbar.");
}

export function planSandboxCreate(
  options: SandboxOptions,
  rawName: string,
  random: () => number = Math.random,
): SandboxCreateBody {
  const engine = pickEngine(options.versions);
  if (!engine) throw new Error("Keine Version verfügbar.");
  const size = pickPreset(options);
  return {
    name: normalizeSandboxName(rawName, random),
    serverType: engine.serverType,
    version: engine.version,
    preset: size.preset,
    ramGb: size.ramGb,
    cpuCores: size.cpuCores,
    startAfterCreate: true,
  };
}

export function sandboxErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: unknown } }).data;
    if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Sandbox fehlgeschlagen.";
}
