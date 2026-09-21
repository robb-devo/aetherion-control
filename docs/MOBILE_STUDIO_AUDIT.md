# Mobile studio audit — release 1.0.15

1.0.15 is built on the real 1.0.14 phone source (`release/1.0.15-source`, commit `cda7bad`) plus the studio truth fixes from PR #1 (`cursor/mobile-studio-audit-a665`). It is not a replay of the older 1.0.3 tree, and it does not drop sandboxes, access codes, `AppUpdateGate`, `CrystalWaveHeader`, or player tools.

Android identity for the next local APK build:

- `artifacts/minecraft-server-control/app.json`: version `1.0.15`, `android.versionCode` `17` (phones on 1.0.14 are `versionCode` 16).
- `artifacts/minecraft-server-control/package.json` version `1.0.15`.
- `android/` is gitignored. There is no `android/app/build.gradle` in this repo; Expo prebuild reads `app.json` when the APK is built locally.

## Truth fixes carried over

- A failed `/stats` call is `unknown` (em dash, “Stats unavailable”). It is not an offline server with 0 players and 0% CPU/RAM. A previous good payload is kept and marked cached.
- CPU stays at one decimal. High CPU stays online. Crafty does not report a `degraded` state, so the app does not invent one. Offline text is red.
- Home rows open that server. Background polls do not flip the hero to “syncing”.
- Restart is finished only after Crafty reports the server stopped and then running. A rejected restart does not force the card offline.
- Backup is finished only when Crafty lists a new archive. Home still backs up the play servers; the summary counts listed archives, not accepted HTTP calls.
- The console shows Crafty logs. The command field clears only after stdin is accepted. “Say message” prefills `say ` instead of pretending a broadcast already happened.
- Updates still come from `/api/app/latest` (ticket download through the control API, so a private GitHub release stays off the phone). The app downloads the APK, checks the byte size, then hands the file to Android’s package installer. It does not claim the update installed when that screen closes.

## Left in place from 1.0.14

Sandbox factory, access codes, wave header, player tools, Hetzner host card, secure-store API key, and the dark violet / Inter system.

## Conflict choices

PR #1 was one commit on the pre-1.0.14 tree, where the tab screens still lived under `app/(tabs)` and there was no in-app updater. Cherry-picking that commit onto this tree would have dropped the 1.0.14 screens. The behavior was ported onto `components/tabs/*`, `ServerContext`, `app/server/[id].tsx`, and the existing `AppUpdateGate` instead. The phone does not call GitHub’s releases API directly; the control API still proxies the asset and now also returns `size` and `pageUrl`.
