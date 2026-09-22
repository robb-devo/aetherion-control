export const DEFAULT_LAUNCHER_SERVICE_KEY: string;

export type AccessPrincipal = {
  token: string;
  name: string;
  role: "owner" | "operator";
  permissions: string[];
  code: "CONTROL_API_KEY" | "LAUNCHER_SERVICE";
};

export function launcherServiceKey(env?: NodeJS.ProcessEnv): string;

export function classifyBearer(
  provided: string,
  env?: NodeJS.ProcessEnv,
):
  | { ok: true; access: AccessPrincipal }
  | { ok: false; status: number; error: string };

export function hasPermission(
  access: { permissions: string[] } | undefined,
  permission: string,
): boolean;
