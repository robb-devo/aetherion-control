import assert from 'node:assert/strict';
import test from 'node:test';
import { findEdgeServer, mergeLiveServers, summarizeServers, toMinecraftServer } from './liveServers.ts';

const proxy = { id: '1', name: 'Velocity', ip: '135.181.18.162', port: 25565 };
const play = { id: '2', name: 'mmo-r', ip: '135.181.18.162', port: 25566 };

test('a missing stats payload is unknown, not an offline server full of zeros', () => {
  const server = toMinecraftServer(play, null);
  assert.equal(server.status, 'unknown');
  assert.equal(server.metricsKnown, false);
  assert.equal(server.players, null);
  assert.equal(server.cpu, null);
  assert.equal(server.ram, null);
  assert.equal(summarizeServers([server]).players, null);
  assert.equal(summarizeServers([server]).averageCpu, null);
});

test('Crafty percentages are kept and high CPU stays online', () => {
  const server = toMinecraftServer(play, {
    running: true,
    cpu: 1.34,
    memoryPercent: 6.2,
    online: 3,
    maxPlayers: 40,
    memory: '1.2 GB',
    uptime: '2h 4m',
    version: '1.21.4',
  });
  assert.equal(server.status, 'online');
  assert.equal(server.cpu, 1.3);
  assert.equal(server.ram, 6);
  assert.equal(server.players, 3);
  assert.equal(server.tag, 'PLAY');

  const hot = toMinecraftServer(play, {
    running: true,
    cpu: 96,
    memoryPercent: 10,
    online: 1,
    maxPlayers: 20,
  });
  assert.equal(hot.status, 'online');
  assert.equal(hot.cpu, 96);
});

test('a stopped server reports offline only when Crafty says it is not running', () => {
  const server = toMinecraftServer(play, {
    running: false,
    cpu: 0,
    memoryPercent: 0,
    online: 0,
    maxPlayers: 20,
    uptime: 'Offline',
  });
  assert.equal(server.status, 'offline');
  assert.equal(server.metricsKnown, true);
  assert.equal(server.players, 0);
  assert.equal(server.cpu, 0);
});

test('polling does not clobber a restart or replace known stats with an empty payload', () => {
  const live = toMinecraftServer(play, {
    running: true,
    cpu: 4,
    memoryPercent: 20,
    online: 2,
    maxPlayers: 20,
  });
  const stopped = toMinecraftServer(play, {
    running: false,
    cpu: 0,
    memoryPercent: 0,
    online: 0,
    maxPlayers: 20,
  });
  const held = mergeLiveServers([live], [stopped], new Set([play.id]));
  assert.equal(held[0]?.status, 'restarting');
  assert.equal(held[0]?.cpu, 4);
  assert.equal(held[0]?.players, 2);

  const unknown = toMinecraftServer(play, null);
  const cached = mergeLiveServers([live], [unknown], new Set());
  assert.equal(cached[0]?.metricsKnown, true);
  assert.equal(cached[0]?.statsFresh, false);
  assert.equal(cached[0]?.players, 2);
  assert.equal(cached[0]?.status, 'online');
});

test('the proxy quick action resolves an edge server by name, not the id "proxy"', () => {
  const servers = [
    toMinecraftServer(play, { running: true, cpu: 1, memoryPercent: 1, online: 0, maxPlayers: 10 }),
    toMinecraftServer(proxy, { running: true, cpu: 1, memoryPercent: 1, online: 0, maxPlayers: 1000 }),
  ];
  assert.equal(findEdgeServer(servers)?.id, '1');
  assert.equal(findEdgeServer(servers.slice(0, 1)), undefined);
});
