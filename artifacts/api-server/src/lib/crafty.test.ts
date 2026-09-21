import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCraftyBackupConfigs,
  normalizeCraftyBackupFiles,
  normalizeCraftyFileEntries,
  normalizeCraftyPlugins,
  normalizeServerPath,
  parseCraftySize,
} from "./crafty";

test("normalizes Crafty filename-keyed root and nested directory payloads", () => {
  const root = normalizeCraftyFileEntries({
    root_path: { local_path: "", top: true },
    plugins: { path: "plugins", dir: true, modified: "09/21/2026 01:00:00" },
    "server.properties": { path: "server.properties", dir: false, size: "2.5 KB", modified: "09/21/2026 01:00:00" },
  }, "");
  assert.deepEqual(root.map(({ name, path, directory, size }) => ({ name, path, directory, size })), [
    { name: "plugins", path: "plugins", directory: true, size: 0 },
    { name: "server.properties", path: "server.properties", directory: false, size: 2560 },
  ]);

  const nested = normalizeCraftyFileEntries({
    root_path: { local_path: "plugins", top: false },
    "EssentialsX.jar": { path: "plugins/EssentialsX.jar", dir: false, size: "1.2 MB" },
  }, "plugins");
  assert.equal(nested[0]?.path, "plugins/EssentialsX.jar");
  assert.equal(nested[0]?.size, 1_258_291);
  assert.deepEqual(normalizeCraftyFileEntries({ root_path: { local_path: "empty" } }, "empty"), []);
});

test("keeps readable file contents separate from directory entries", () => {
  assert.deepEqual(normalizeCraftyFileEntries({ content: "motd=Hello", attributes: { size: "10 B" } }, "server.properties"), []);
});

test("discovers plugin and mod archives from normalized entries", () => {
  const entries = normalizeCraftyFileEntries({
    "LuckPerms.jar": { path: "plugins/LuckPerms.jar", dir: false, size: "4 MB" },
    cache: { path: "plugins/cache", dir: true },
    "notes.txt": { path: "plugins/notes.txt", dir: false, size: "2 B" },
  }, "plugins");
  assert.deepEqual(normalizeCraftyPlugins("plugins", entries).map(({ name, kind }) => ({ name, kind })), [
    { name: "LuckPerms.jar", kind: "plugin" },
  ]);
});

test("normalizes backup configuration maps and their archive lists", () => {
  const configs = normalizeCraftyBackupConfigs({
    "config-a": { backup_id: "config-a", backup_name: "Default Backup", enabled: true },
    "config-b": { backup_id: "config-b", backup_name: "World Only", enabled: true },
  });
  assert.deepEqual(configs, [
    { id: "config-a", name: "Default Backup" },
    { id: "config-b", name: "World Only" },
  ]);
  assert.deepEqual(normalizeCraftyBackupFiles("config-a", {
    total: 2,
    backups: ["/crafty/backups/config-a/2026-09-21_01-00-00.zip", "C:\\crafty\\backups\\config-a\\latest.zip"],
  }), [
    { id: "config-a:2026-09-21_01-00-00.zip", name: "2026-09-21_01-00-00.zip", size: 0, createdAt: null },
    { id: "config-a:latest.zip", name: "latest.zip", size: 0, createdAt: null },
  ]);
});

test("rejects paths that can escape the server root", () => {
  assert.equal(normalizeServerPath("world/region"), "world/region");
  assert.equal(normalizeServerPath(""), "");
  for (const unsafe of ["../secret", "world/../../secret", "\\\\server\\share", "world\0secret"]) {
    assert.throws(() => normalizeServerPath(unsafe));
  }
  assert.throws(() => normalizeServerPath("", false));
  assert.equal(parseCraftySize("1.5 GB"), 1_610_612_736);
});