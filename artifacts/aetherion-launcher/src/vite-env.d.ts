export type Account = {
  name: string;
  id: string;
  avatar: string | null;
};

export type PackStatus = {
  complete: boolean;
  present: number;
  total: number;
  minecraft: string;
  loader: string;
  packVersion: string;
  server: {
    name: string;
    address: string;
    port: number;
  };
};

export type PlayTarget = {
  kind: "network" | "sandbox";
  name: string;
  address: string;
  port: number;
  label: string;
};

export type Settings = {
  ramGb: number;
  autoJoin: boolean;
  serverAddress: string;
  playTarget: PlayTarget;
};

export type ControlSession = {
  apiBase: string;
  unlocked: boolean;
  displayName: string | null;
  role: string | null;
  canSandbox: boolean;
};

export type UpdateStatus = {
  available: boolean;
  version: string | null;
  currentVersion: string;
};

export type AppState = {
  account: Account | null;
  settings: Settings;
  pack: PackStatus;
  appVersion: string;
  control: ControlSession;
  update: UpdateStatus;
};

export type ProgressEvent = {
  phase: string;
  message: string;
  progress: number;
  detail?: string;
};

export type SandboxPresetName = "light" | "balanced" | "performance" | "max";

export type SandboxOptions = {
  poolGb: number;
  maxRamGb: number;
  poolCores: number;
  maxCores: number;
  usedRamGb: number;
  remainingRamGb: number;
  usedCores: number;
  remainingCores: number;
  publicIp: string;
  presets: Array<{
    value: SandboxPresetName;
    label: string;
    blurb: string;
    ramGb: number;
    cpuCores: number;
  }>;
  serverTypes: Array<{ value: string; label: string; blurb: string }>;
  versions: Record<string, string[]>;
};

export type SandboxServer = {
  id: string;
  name: string;
  serverType: string;
  version: string;
  ramGb: number;
  cpuCores: number;
  preset: string;
  port: number;
  address: string;
};

export type SandboxCreateInput = {
  name: string;
  serverType: string;
  version: string;
  ramGb: number;
  cpuCores: number;
  preset: string;
  startAfterCreate: boolean;
};

declare global {
  interface Window {
    aetherion: {
      getState: () => Promise<AppState>;
      updateSettings: (patch: Partial<Pick<Settings, "ramGb" | "autoJoin">>) => Promise<Settings>;
      setPlayTarget: (
        target:
          | { kind: "network" }
          | { kind: "sandbox"; name: string; address: string; port: number },
      ) => Promise<Settings>;
      login: () => Promise<Account>;
      logout: () => Promise<null>;
      installPack: () => Promise<PackStatus>;
      play: () => Promise<{ ok: boolean }>;
      minimize: () => Promise<void>;
      close: () => Promise<void>;
      updateStatus: () => Promise<UpdateStatus>;
      startUpdate: () => Promise<UpdateStatus>;
      unlockControl: (input: { code: string; apiBase?: string }) => Promise<ControlSession>;
      lockControl: () => Promise<ControlSession>;
      sandboxOptions: () => Promise<SandboxOptions>;
      sandboxList: () => Promise<{ servers: SandboxServer[] }>;
      sandboxCreate: (input: SandboxCreateInput) => Promise<SandboxServer>;
      sandboxStart: (id: string) => Promise<{ ok: boolean; id: string; address: string; running: boolean | null }>;
      sandboxDelete: (id: string) => Promise<{ ok: boolean; id: string }>;
      sandboxUpload: (input: { id: string; path: string; content: string }) => Promise<{ ok: boolean; path: string }>;
      onProgress: (handler: (evt: ProgressEvent) => void) => () => void;
      onLog: (handler: (evt: { level: string; message: string }) => void) => () => void;
      onClose: (handler: (evt: { code: number }) => void) => () => void;
      onUpdate: (handler: (evt: UpdateStatus) => void) => () => void;
    };
  }
}

export {};
