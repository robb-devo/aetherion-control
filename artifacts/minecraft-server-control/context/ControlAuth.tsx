import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

const KEY_API_BASE = 'aetherion.control.apiBase';
const KEY_API_TOKEN = 'aetherion.control.apiKey';
const KEY_DISPLAY_NAME = 'aetherion.control.displayName';
const KEY_ROLE = 'aetherion.control.role';
const KEY_PERMISSIONS = 'aetherion.control.permissions';

const DEFAULT_API = 'http://135.181.18.162:5055';

export type AccessRole = 'owner' | 'operator' | 'viewer';

type ControlAuthValue = {
  isReady: boolean;
  isUnlocked: boolean;
  apiBase: string;
  displayName: string;
  role: AccessRole | null;
  permissions: string[];
  unlockWithCode: (code: string) => Promise<void>;
  unlockWithApiKey: (apiBase: string, apiKey: string, displayName?: string) => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  lock: () => Promise<void>;
  can: (permission: string) => boolean;
};

const ControlAuthContext = createContext<ControlAuthValue | null>(null);

function normalizeBase(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function normalizeName(value: string) {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.slice(0, 24) || 'Operator';
}

function normalizeRole(value: string | null | undefined): AccessRole | null {
  if (value === 'owner' || value === 'operator' || value === 'viewer') return value;
  return null;
}

export function ControlAuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [apiBase, setApiBaseState] = useState(DEFAULT_API);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [displayName, setDisplayNameState] = useState('Operator');
  const [role, setRole] = useState<AccessRole | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [savedBase, savedKey, savedName, savedRole, savedPerms] = await Promise.all([
          SecureStore.getItemAsync(KEY_API_BASE),
          SecureStore.getItemAsync(KEY_API_TOKEN),
          SecureStore.getItemAsync(KEY_DISPLAY_NAME),
          SecureStore.getItemAsync(KEY_ROLE),
          SecureStore.getItemAsync(KEY_PERMISSIONS),
        ]);
        if (savedName) setDisplayNameState(normalizeName(savedName));
        if (savedRole) setRole(normalizeRole(savedRole));
        if (savedPerms) {
          try {
            const parsed = JSON.parse(savedPerms) as string[];
            if (Array.isArray(parsed)) setPermissions(parsed);
          } catch {
            // ignore
          }
        }
        if (savedBase && savedKey) {
          const base = normalizeBase(savedBase);
          setApiBaseState(base);
          setApiKey(savedKey);
          setBaseUrl(base);
          setAuthTokenGetter(() => savedKey);
        } else {
          setApiBaseState(DEFAULT_API);
          setBaseUrl(DEFAULT_API);
        }
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  const persistSession = useCallback(
    async (opts: {
      base: string;
      token: string;
      name: string;
      role: AccessRole;
      permissions: string[];
    }) => {
      await Promise.all([
        SecureStore.setItemAsync(KEY_API_BASE, opts.base),
        SecureStore.setItemAsync(KEY_API_TOKEN, opts.token),
        SecureStore.setItemAsync(KEY_DISPLAY_NAME, opts.name),
        SecureStore.setItemAsync(KEY_ROLE, opts.role),
        SecureStore.setItemAsync(KEY_PERMISSIONS, JSON.stringify(opts.permissions)),
      ]);
      setApiBaseState(opts.base);
      setApiKey(opts.token);
      setDisplayNameState(opts.name);
      setRole(opts.role);
      setPermissions(opts.permissions);
      setBaseUrl(opts.base);
      setAuthTokenGetter(() => opts.token);
    },
    [],
  );

  const unlockWithCode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code) throw new Error('Enter your access code.');
      const base = DEFAULT_API;
      const health = await fetch(`${base}/api/healthz`);
      if (!health.ok) throw new Error(`API unreachable (HTTP ${health.status}).`);

      const response = await fetch(`${base}/api/auth/unlock`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        displayName?: string;
        role?: AccessRole;
        permissions?: string[];
      };
      if (!response.ok || !body.token) {
        throw new Error(body.error || `Unlock failed (HTTP ${response.status}).`);
      }
      await persistSession({
        base,
        token: body.token,
        name: normalizeName(body.displayName || 'Operator'),
        role: normalizeRole(body.role) || 'viewer',
        permissions: Array.isArray(body.permissions) ? body.permissions : [],
      });
    },
    [persistSession],
  );

  const unlockWithApiKey = useCallback(
    async (nextBase: string, nextKey: string, nextName?: string) => {
      const base = normalizeBase(nextBase || DEFAULT_API);
      const key = nextKey.trim();
      if (!base || !key) throw new Error('API URL and key are required.');

      const health = await fetch(`${base}/api/healthz`);
      if (!health.ok) throw new Error(`API unreachable (HTTP ${health.status}).`);

      const probe = await fetch(`${base}/api/crafty/servers`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      if (probe.status === 401) throw new Error('API key is invalid.');
      if (!probe.ok) {
        const text = await probe.text().catch(() => '');
        throw new Error(text || `Crafty probe failed (HTTP ${probe.status}).`);
      }

      await persistSession({
        base,
        token: key,
        name: normalizeName(nextName || displayName),
        role: 'owner',
        permissions: ['*'],
      });
    },
    [displayName, persistSession],
  );

  const setDisplayName = useCallback(async (name: string) => {
    const next = normalizeName(name);
    await SecureStore.setItemAsync(KEY_DISPLAY_NAME, next);
    setDisplayNameState(next);
  }, []);

  const lock = useCallback(async () => {
    if (apiKey?.startsWith('aes_') && apiBase) {
      try {
        await fetch(`${apiBase}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        });
      } catch {
        // best-effort
      }
    }
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_API_BASE),
      SecureStore.deleteItemAsync(KEY_API_TOKEN),
      SecureStore.deleteItemAsync(KEY_ROLE),
      SecureStore.deleteItemAsync(KEY_PERMISSIONS),
    ]);
    setApiBaseState(DEFAULT_API);
    setApiKey(null);
    setRole(null);
    setPermissions([]);
    setBaseUrl(DEFAULT_API);
    setAuthTokenGetter(null);
  }, [apiBase, apiKey]);

  const can = useCallback(
    (permission: string) => {
      if (permissions.includes('*')) return true;
      return permissions.includes(permission);
    },
    [permissions],
  );

  const value = useMemo(
    () => ({
      isReady,
      isUnlocked: Boolean(apiKey),
      apiBase,
      displayName,
      role,
      permissions,
      unlockWithCode,
      unlockWithApiKey,
      setDisplayName,
      lock,
      can,
    }),
    [apiBase, apiKey, can, displayName, isReady, lock, permissions, role, setDisplayName, unlockWithApiKey, unlockWithCode],
  );

  return <ControlAuthContext.Provider value={value}>{children}</ControlAuthContext.Provider>;
}

export function useControlAuth() {
  const ctx = useContext(ControlAuthContext);
  if (!ctx) throw new Error('useControlAuth must be used inside ControlAuthProvider');
  return ctx;
}
