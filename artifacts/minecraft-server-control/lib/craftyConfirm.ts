export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RestartWatch<T> = {
  outcome: 'online' | 'offline' | 'still-running' | 'unreported';
  stats: T | null;
};

/** Done only after Crafty reports the server stopped and then running again. */
export async function watchRestart<T extends { running: boolean }>(
  read: () => Promise<T | null>,
  alive: () => boolean = () => true,
  attempts = 24,
): Promise<RestartWatch<T>> {
  let sawStopped = false;
  let latest: T | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(3000);
    if (!alive()) break;
    try {
      const stats = await read();
      if (!stats) continue;
      latest = stats;
      if (!stats.running) sawStopped = true;
      else if (sawStopped) return { outcome: 'online', stats };
    } catch {
      // A missed poll is not confirmation either way.
    }
  }
  if (!latest) return { outcome: sawStopped ? 'offline' : 'unreported', stats: null };
  if (latest.running && sawStopped) return { outcome: 'online', stats: latest };
  if (!latest.running) return { outcome: 'offline', stats: latest };
  return { outcome: 'still-running', stats: latest };
}

export async function watchRunning<T extends { running: boolean }>(
  read: () => Promise<T | null>,
  expected: boolean,
  alive: () => boolean = () => true,
  attempts = 15,
): Promise<T | null> {
  let latest: T | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(3000);
    if (!alive()) return latest;
    try {
      const stats = await read();
      if (!stats) continue;
      latest = stats;
      if (stats.running === expected) return stats;
    } catch {
      // A failed poll is not a state change.
    }
  }
  return latest && latest.running === expected ? latest : null;
}

/** A backup is confirmed only when Crafty lists an archive id that was not there before. */
export async function watchNewBackup(
  read: () => Promise<{ id: string; name: string }[] | null>,
  baseline: ReadonlySet<string>,
  alive: () => boolean = () => true,
  budgetMs = 45_000,
): Promise<string | null> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (!alive()) return null;
    try {
      const backups = await read();
      const created = backups?.find((item) => !baseline.has(item.id));
      if (created) return created.name;
    } catch {
      // Keep waiting for the archive list.
    }
  }
  return null;
}
