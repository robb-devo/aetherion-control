import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareVersions,
  decideUpdate,
  isTrustedApkUrl,
  releaseSizeMatches,
  selectReleaseApk,
} from './appUpdate.ts';

const release = {
  tag_name: 'v1.0.14',
  name: 'AETHERION Control 1.0.14',
  body: 'Login copy cleanup.',
  html_url: 'https://github.com/robb-devo/aetherion-control/releases/tag/v1.0.14',
  assets: [
    {
      name: 'AETHERION-Control-1.0.14.apk',
      browser_download_url: 'https://github.com/robb-devo/aetherion-control/releases/download/v1.0.14/AETHERION-Control-1.0.14.apk',
      size: 53296004,
    },
    {
      name: 'notes.txt',
      browser_download_url: 'https://example.com/notes.txt',
      size: 12,
    },
  ],
};

test('version comparison is numeric semver and ignores a leading v', () => {
  assert.equal(compareVersions('1.0.14', '1.0.3'), 1);
  assert.equal(compareVersions('v1.0.3', '1.0.3'), 0);
  assert.equal(compareVersions('1.0.3', '1.10.0'), -1);
  assert.equal(compareVersions('latest', '1.0.3'), null);
});

test('only an APK hosted on this repo release URL is selectable', () => {
  const selected = selectReleaseApk(release);
  assert.equal(selected?.version, '1.0.14');
  assert.equal(selected?.size, 53296004);
  assert.equal(isTrustedApkUrl(selected?.url ?? ''), true);
  assert.equal(
    selectReleaseApk({
      tag_name: 'v9.0.0',
      assets: [{ name: 'app.apk', browser_download_url: 'https://evil.example/app.apk', size: 10 }],
    }),
    null,
  );
});

test('a newer GitHub release is an update, and an older one is not a downgrade', () => {
  const apk = selectReleaseApk(release);
  assert.ok(apk);
  assert.equal(decideUpdate('1.0.3', apk).kind, 'update');
  assert.equal(decideUpdate('1.0.14', apk).kind, 'current');
  assert.equal(decideUpdate('1.0.15', apk).kind, 'ahead');
});

test('install is allowed only when the downloaded byte count matches the asset', () => {
  assert.equal(releaseSizeMatches(53296004, 53296004), true);
  assert.equal(releaseSizeMatches(53296003, 53296004), false);
  assert.equal(releaseSizeMatches(0, 53296004), false);
});
