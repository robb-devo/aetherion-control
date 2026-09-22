# AETHERION Launcher

Windows desktop launcher for the AETHERION Fabric client. Sign in with Microsoft, install the pack from `pack/manifest.json`, and play. The installer can update itself from GitHub Releases.

Version **1.3.0** keeps the 1.2.2 launch, auth, and pack behavior.

## Develop

```bash
cd artifacts/aetherion-launcher
npm install
npm run dev
```

`npm run dev` starts Vite and Electron together. Microsoft sign-in, Java, and the pack download need a normal Windows desktop session.

This package is **not** part of the pnpm workspace. Install and build it on its own.

## Play

1. Sign in with Microsoft.
2. If the pack is missing, Play installs it (Java 21, Fabric, mods, shaders).
3. Play launches Minecraft and auto-joins the configured server.

The multiplayer list entry **AETHERION** is written to the instance `servers.dat` on pack install, again immediately before every launch, and once more when the game process exits. That file lives in the same folder passed to Minecraft as `--gameDir`:

`%APPDATA%\AetherionLauncher\instance\servers.dat`

The address on that entry is the network server (`play.donnernet.de` unless `serverAddress` was saved). A sandbox you join is a **separate** list entry and does not replace AETHERION.

## Your own Server

This uses the existing control API sandbox pool (`/api/sandbox`), the same access-code auth as the mobile app (`Authorization: Bearer <token>` from `POST /api/auth/unlock`). Default API base: `http://135.181.18.162:5055`.

The list is private to the signed-in access code. Pool RAM and CPU limits are unchanged. Text upload (256 KB, no jars) goes to `POST /api/sandbox/servers/:id/files`. Play on a row sets the launch target to that `address:port` and starts the client.

## Build a Windows installer

On a Windows machine:

```bash
cd artifacts/aetherion-launcher
npm ci
npm run build
```

Output:

- `release/AETHERION-Launcher-<version>.exe` — NSIS one-click installer (per user, no custom install directory)
- `release/latest.yml` — update metadata for `electron-updater`
- `release/*.blockmap` — optional differential-download map, when electron-builder emits one

`npm run build` runs the renderer build, `electron-builder --win nsis --publish never`, then `scripts/write-latest-yml.mjs`. NSIS is used instead of portable because `electron-updater` can quit, install, and relaunch an NSIS app.

GitHub Actions workflow `.github/workflows/launcher-release.yml` runs the same build on `windows-latest` when a `launcher-v*` tag is pushed, or when the workflow is started by hand. A tag publish does **not** mark the GitHub release as Latest, so it does not replace the Android control release.

## Auto-update

The installed app checks GitHub Releases for `robb-devo/aetherion-control` (public release assets, no token). It ignores drafts and prereleases. A release counts only when it contains both:

- `AETHERION-Launcher-x.y.z.exe`
- `latest.yml`

The newest matching version newer than the running app shows an **Update** control. Choosing it hides the launcher, shows a small progress window, downloads the installer, then `quitAndInstall` relaunches on the new version.

`latest.yml` shape:

```yaml
version: 1.3.0
files:
  - url: AETHERION-Launcher-1.3.0.exe
    sha512: "<base64 sha512 of the exe>"
    size: 123456789
path: AETHERION-Launcher-1.3.0.exe
sha512: "<same sha512>"
releaseDate: "2026-09-22T00:00:00.000Z"
```

`url` and `path` are file names. The app feeds `electron-updater` the generic URL:

`https://github.com/robb-devo/aetherion-control/releases/download/<tag>/`

so it does not depend on which repo release is marked Latest.

### Publish

1. Set `version` in `artifacts/aetherion-launcher/package.json`.
2. Tag `launcher-v` plus that version, for example `launcher-v1.3.0`, and push the tag.
3. Confirm the release has the exe and `latest.yml` named exactly as above.
4. An older installed build then offers Update.

Friends install once from that release. Later versions arrive through the in-app updater.
