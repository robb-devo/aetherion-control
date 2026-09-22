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

export type Settings = {
  ramGb: number;
  autoJoin: boolean;
  serverAddress: string;
};

export type AppState = {
  account: Account | null;
  settings: Settings;
  pack: PackStatus;
  appVersion: string;
};

export type ProgressEvent = {
  phase: string;
  message: string;
  progress: number;
  detail?: string;
};

declare global {
  interface Window {
    aetherion: {
      getState: () => Promise<AppState>;
      updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
      login: () => Promise<Account>;
      logout: () => Promise<null>;
      installPack: () => Promise<PackStatus>;
      play: () => Promise<{ ok: boolean }>;
      minimize: () => Promise<void>;
      close: () => Promise<void>;
      onProgress: (handler: (evt: ProgressEvent) => void) => () => void;
      onLog: (handler: (evt: { level: string; message: string }) => void) => () => void;
      onClose: (handler: (evt: { code: number }) => void) => () => void;
    };
  }
}

export {};
