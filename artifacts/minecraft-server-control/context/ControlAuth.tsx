import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

const KEY_API_BASE = 'aetherion.control.apiBase';
const KEY_API_TOKEN = 'aetherion.control.apiKey';

type ControlAuthValue = {
  isReady: boolean;
  isUnlocked: boolean;
  apiBase: string;
  unlock: (apiBase: string, apiKey: string) => Promise<void>;
  lock: () => Promise<void>;
};

const ControlAuthContext = createContext<ControlAuthValue | null>(null);

function normalizeBase(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function ControlAuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [apiBase, setApiBaseState] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [savedBase, savedKey] = await Promise.all([
          SecureStore.getItemAsync(KEY_API_BASE),
          SecureStore.getItemAsync(KEY_API_TOKEN),
        ]);
        if (savedBase && savedKey) {
          const base = normalizeBase(savedBase);
          setApiBaseState(base);
          setApiKey(savedKey);
          setBaseUrl(base);
          setAuthTokenGetter(() => savedKey);
        }
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  const unlock = useCallback(async (nextBase: string, nextKey: string) => {
    const base = normalizeBase(nextBase);
    const key = nextKey.trim();
    if (!base || !key) throw new Error('API-URL und Schlüssel sind erforderlich.');

    const health = await fetch(`${base}/api/healthz`);
    if (!health.ok) throw new Error(`API nicht erreichbar (HTTP ${health.status}).`);

    const probe = await fetch(`${base}/api/crafty/servers`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (probe.status === 401) throw new Error('API-Schlüssel ist ungültig.');
    if (!probe.ok) {
      const body = await probe.text().catch(() => '');
      throw new Error(body || `Crafty-Probe fehlgeschlagen (HTTP ${probe.status}).`);
    }

    await SecureStore.setItemAsync(KEY_API_BASE, base);
    await SecureStore.setItemAsync(KEY_API_TOKEN, key);
    setApiBaseState(base);
    setApiKey(key);
    setBaseUrl(base);
    setAuthTokenGetter(() => key);
  }, []);

  const lock = useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_API_BASE),
      SecureStore.deleteItemAsync(KEY_API_TOKEN),
    ]);
    setApiBaseState('');
    setApiKey(null);
    setBaseUrl(null);
    setAuthTokenGetter(null);
  }, []);

  const value = useMemo(
    () => ({
      isReady,
      isUnlocked: Boolean(apiKey && apiBase),
      apiBase,
      unlock,
      lock,
    }),
    [apiBase, apiKey, isReady, lock, unlock],
  );

  return <ControlAuthContext.Provider value={value}>{children}</ControlAuthContext.Provider>;
}

export function useControlAuth() {
  const ctx = useContext(ControlAuthContext);
  if (!ctx) throw new Error('useControlAuth must be used inside ControlAuthProvider');
  return ctx;
}
