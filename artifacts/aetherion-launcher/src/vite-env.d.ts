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
  controlApiBase: string;
  controlKeySet: boolean;
  apiBase: string;
};

export type ControlInfo = {
  apiBase: string;
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
  control: ControlInfo;
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
  ramChoices: number[];
  cpuChoices: number[];
  difficulties: string[];
  gamemodes: string[];
  defaults: {
    maxPlayers: number;
    viewDistance: number;
    simulationDistance: number;
    difficulty: string;
    gamemode: string;
    onlineMode: boolean;
    motd: string;
  };
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
  maxPlayers?: number;
  onlineMode?: boolean;
};

export type SandboxCreateInput = {
  name: string;
  serverType: string;
  version: string;
  ramGb: number;
  cpuCores: number;
  preset: string;
  maxPlayers: number;
  viewDistance: number;
  simulationDistance: number;
  difficulty: string;
  gamemode: string;
  onlineMode: boolean;
  motd: string;
  startAfterCreate: boolean;
};

declare global {
  interface Window {
    aetherion: {
      getState: () => Promise<AppState>;
      updateSettings: (
        patch: Partial<Pick<Settings, "ramGb" | "autoJoin" | "controlApiBase">> & { controlKey?: string },
      ) => Promise<Settings>;
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
      sandboxOptions: () => Promise<SandboxOptions>;
      sandboxList: () => Promise<{ servers: SandboxServer[] }>;
      sandboxCreate: (input: SandboxCreateInput) => Promise<SandboxServer>;
      sandboxStart: (id: string) => Promise<{ ok: boolean; id: string; address: string; running: boolean | null }>;
      sandboxDelete: (id: string) => Promise<{ ok: boolean; id: string }>;
      sandboxUpload: (input: { id: string; path: string; content: string }) => Promise<{ ok: boolean; path: string }>;
      onProgress: (handler: (evt: ProgressEvent) => void) => () => void;
      onLog: (handler: (evt: { level: string; message: string }) => void) => () => void;
      onClose: (handler: (evt: { code: number }) => void) => () => void;
      onRunning: (handler: (evt: { ok: boolean }) => void) => () => void;
      onUpdate: (handler: (evt: UpdateStatus) => void) => () => void;
    };
  }
}

export {};
