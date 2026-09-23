# AETHERION mobile studio audit

Audited on `main` at `2ff0a36` (21 Sep 2026). Scope is the Expo app in `artifacts/minecraft-server-control` and the Crafty data it reads. Windows / Operator desktop builds were not reviewed for redesign. The last section lists what this branch changed and what was left alone.

The phone people actually install is **not this tree**. GitHub Releases `v1.0.4` through `v1.0.14` (latest APK `AETHERION-Control-1.0.14.apk`, `versionCode` 16) were published the same day with no matching commits. `app.json` on `main` is still `1.0.3` / `versionCode` 5. Strings recovered from the 1.0.14 Hermes bundle mention sandboxes, access codes, a crystal wave header, player tools, and an in-app updater. None of that source is in git. This audit describes the code that is committed. It does not reconstruct the unpublished APK.

Do not tag a release from this branch over the 1.0.14 APK. `versionCode` was deliberately left at 5 so Android will refuse to replace the installed 1.0.14 build with this older binary.

## 1. Structure, navigation, screens

Expo Router, one stack, four tabs, one detail route.

| Route | File | Role |
| --- | --- | --- |
| Auth stack | `app/(auth)/sign-in.tsx`, `sign-up.tsx` (redirects to sign-in) | API base URL + control key |
| Tabs | `app/(tabs)/_layout.tsx` | Home, Servers, Console, Tools. iOS 26 liquid glass uses `NativeTabs`; Android uses the classic tab bar |
| Home | `app/(tabs)/index.tsx` | Hero, quick actions, three servers, activity |
| Servers | `app/(tabs)/servers.tsx` | All Crafty nodes + Hetzner host card |
| Console | `app/(tabs)/console.tsx` | Command entry |
| Tools | `app/(tabs)/tools.tsx` | Session, refresh, sign out |
| Detail | `app/server/[id].tsx` | Overview, players, logs, files, plugins, backups |
| Root | `app/_layout.tsx` | Fonts, React Query, auth, server state |

Shared chrome is `components/ControlUI.tsx` (type, bars, chips, buttons) and `constants/colors.ts` via `hooks/useColors.ts`. `components/ErrorBoundary.tsx` wraps the tree.

## 2. State, API, auth

Two client stores, plus React Query on the detail screen only.

- `context/ControlAuth.tsx` reads the API base and bearer key from `expo-secure-store`, calls `setBaseUrl` / `setAuthTokenGetter` on `@workspace/api-client-react`, and probes `GET /api/healthz` then `GET /api/crafty/servers` before saving. Unlock fails closed on HTTP errors and on 401.
- `context/ServerContext.tsx` owns the server list, a local activity log, and actions. It calls the generated client (`listCraftyServers`, `getCraftyServerStats`, `runCraftyServerAction`, `sendCraftyServerCommand`).
- The detail screen uses generated React Query hooks for stats, logs, plugins, backups, and file mutations.
- `lib/api-client-react/src/custom-fetch.ts` attaches `Authorization: Bearer` and turns non-OK responses into `ApiError` with the server's `error` string.
- Server auth is `artifacts/api-server/src/middlewares/requireAuth.ts`: `CONTROL_API_KEY`, timing-safe compare. `/api/healthz` is public. Crafty routes are not.

There is no Clerk session in this build. The control key is the whole credential.

## 3. Crafty data chain

```
Minecraft process
  → Crafty Controller  GET /api/v2/servers/{id}/stats
  → API  artifacts/api-server/src/lib/crafty.ts  getCraftyStats()
  → GET /api/crafty/servers/:id/stats
  → ServerContext.toMinecraftServer()  and the detail screen's React Query cache
  → Home / Servers / detail Overview
```

`getCraftyStats` maps Crafty's own fields and does not multiply them. CPU stays a percentage rounded to one decimal (`cpu: 1.3` stays `1.3`). Memory percent is rounded to an integer. `running` is Crafty's boolean. Player names are parsed from a JSON string or a comma list. Uptime is computed from Crafty's `started` timestamp. `127.0.0.1` / `0.0.0.0` are replaced with `PUBLIC_HOST_IP` in `normalize()` so the card shows the public address, not the loopback bind.

The client then rounded CPU to an integer again (`asPercent` in `ServerContext.tsx`) and, when CPU was over 82, invented a `degraded` status Crafty never sent.

TPS is not in Crafty's stats payload and was not shown. That part was already honest. Do not invent a TPS figure.

## 4. Polling, cache, races, fake values

What was wrong on `main`:

- **Failed stats became an offline server full of zeros.** The per-server `catch` called `toMinecraftServer(server, null)`, and that function used `running ?? false`, `online ?? 0`, `cpu ?? 0`. A 502 looked identical to an empty, stopped server.
- **A failed restart was forced to `offline`**, even when the server had been online and Crafty had rejected the call.
- **Restart was announced before Crafty answered**, then a single refresh 2.2s later. The toast always used a check icon, including for the German error string set in the list `catch`.
- **No generation guard.** A slow poll could overwrite a newer one, including a local `restarting` flag.
- **`isLoading` was set true on every 10s poll**, so the home pill flipped to `SYNCING WITH CRAFTY` and the refresh spinner ran on a timer.
- **Background failure kept the old numbers and still presented them as live.** Home replaced the subtitle with the error but left the counts in the hero.
- **`disk` was hardcoded to `0`.** Nothing rendered it. It was a trap.
- **Console was not Crafty's log.** `lines` is a local activity list in AsyncStorage. The console screen titled it `{name}.stdin` and the placeholder said live output would load. Refresh replaced that with `Connected to Crafty · N servers loaded`, which is an app event, not server output. Commands were appended before Crafty accepted them.
- **Quick actions did not do what they said.** `restartServer('proxy')` looks up a Crafty id, and ids are not the string `proxy`. `Backup now` routed to Tools, which has no backup call. `Broadcast` only opened the console.
- **Server list metrics are not restored from AsyncStorage.** That comment in `ServerContext` is correct and should stay. Only the activity lines were persisted.

Detail stats use `refetchInterval: 10000` in addition to the context poll. Same API, twice. Harmless at this server count, wasteful, left as P2.

## 5. Loading, empty, error, offline, start/stop

- First load with an empty list said `Loading live systems…`. Good.
- Empty Crafty list said `No Crafty servers were returned.` Good.
- Servers screen showed the error string. Home buried it in the hero subtitle.
- Offline status text on the server card used `colors.success` unless the status was the invented `degraded` (`servers.tsx` `ServerDetail`). Offline rendered green.
- Detail Overview used `stats?.cpu ?? 0` while the query was in flight, so the first paint was `0%` CPU and `0/0` players.
- Detail actions set `{label} in progress…` before `onSettled`, including when the mutation failed (the label cleared and a separate error appeared, but the notice had already claimed the action was underway).
- Player rows said `Connected now` for every name. Crafty only supplies the name.
- There is no offline detector beyond a failed fetch. No fake "reconnecting" progress was added.

## 6. Performance

The server list is a handful of rows inside `ScrollView`. `FlatList` would not change anything a person can feel. The context value changes every poll and re-renders every tab; that is acceptable at this size. The real cost was N stats requests every 10 seconds with no in-flight guard, plus a second stats query on the open detail screen, plus the loading flag forcing a full hero repaint. Animations are press opacity only. Leave them.

## 7. Theme

`constants/colors.ts` is a dark violet system (background `#08070D`, primary `#A970FF`, Inter). Light and dark palettes are the same object, so `userInterfaceStyle: "automatic"` does not flip to a white theme. That is the brand, not a bug. Radius tokens, eyebrows, and the hero gradient are consistent across Home, Servers, Console, and sign-in. Do not restyle it.

Copy is mixed English and German (`Dein Netzwerk…`, `Session trennen`, English hero pills). The 1.0.9 release notes say the shipped APK is English. This tree is not. A full language pass was not part of the data fixes.

## 8. Update system

### What the committed app did

Nothing. No version check, no download, no installer intent. `app.json` version `1.0.3` is only the Expo manifest. `scripts/build.js` is the Replit static web bundle exporter. It is not an APK pipeline. There is no `expo-updates`, no EAS config, and no GitHub Action in the repo.

### What the shipped APK did

Release notes, not source:

- `v1.0.6` checked GitHub Releases on launch, prompted, and downloaded an APK.
- `v1.0.8` fixed a missing User-Agent and version detection. Unauthenticated `api.github.com` returns 403 without a User-Agent.
- `v1.0.11` moved the check through the control API because a private repo returned 404 to the phone, and added Tools → Check for app updates.

A check from this environment on 21 Sep 2026 got **HTTP 200** from `https://api.github.com/repos/robb-devo/aetherion-control/releases/latest` with a normal User-Agent. The latest asset is a public APK URL under `github.com/robb-devo/aetherion-control/releases/download/`. The live control API (`http://135.181.18.162:5055/api/healthz`) has no `/api/app/update` or `/api/updates/latest` (both 404). A phone build of *this* tree can read the public Releases API. If the repo is made private again, that call will 404 and the app must say so. It must not embed a GitHub token.

The 1.0.14 bundle is Hermes bytecode. UI strings that survived include "already up to date" and "via control AP…", which matches the 1.0.11 notes. The installer implementation itself is not recoverable as source from the bytecode here.

### Why Android shows a system confirmation

This package (`com.aetherion.control`) is sideloaded. It is not distributed by Google Play.

- **Play in-app updates** (`AppUpdateManager`) only work for an app installed from Play, updating to another Play release. Calling it here returns unavailable. It is the wrong API.
- **`expo-updates` / EAS Update** can replace the JavaScript bundle without an installer dialog, but only inside a binary that was built with that runtime. This project does not use it, and it cannot ship a new `versionCode`, permission, or icon. Switching the release model was out of scope.
- **Sideload** is `ACTION_VIEW` on an `application/vnd.android.package-archive` content URI (or `PackageInstaller.Session.commit`). On Android 8 and later the app must declare `REQUEST_INSTALL_PACKAGES`, and the user must allow that app to install unknown apps. In every case the system package installer draws its own confirmation. A normal app cannot press that button. Silent install is limited to device-owner / device-policy controllers and privileged system apps. This app is neither, and it must not try to become one.

The dialog is the security boundary. The useful work around it is to make the hand-off obvious: what version, how large, that the next screen is Android's, that cancelling leaves the current build in place, and that the new version is only claimed after the process actually restarts on it.

## 9. Build and release

- Mobile scripts: `expo start`, `expo run:android`, `tsc --noEmit`, and `scripts/build.js` (Metro static web export; it exits without `REPLIT_*` or `EXPO_PUBLIC_DOMAIN`).
- Published APKs are attached to GitHub Releases by hand. There is no workflow in `.github/`.
- `plugins/withCleartextTraffic.js` allows HTTP to `135.181.18.162` because the control API is `http://…:5055`. The API key crosses the network in cleartext. That is a deployment fact, not something the UI can paper over. Forcing HTTPS in the app would only break the current server.
- `deploy/aetherion-control.service` runs the API on the Hetzner host. It is not the mobile build.

## Findings

### P0 — real, and wrong on screen

| Issue | Evidence | Class |
| --- | --- | --- |
| Stats failure rendered as offline `0` players / `0%` CPU / `0%` RAM | `ServerContext.tsx` `toMinecraftServer` + the `catch` inside `refresh` | A |
| Restart failure forced `status: 'offline'` | `restartServer` catch | A |
| Restart / backup / "broadcast" claimed or implied an outcome Crafty had not confirmed. Backup and broadcast did not call Crafty. Restart proxy used the id `"proxy"` | `index.tsx` quick actions; `restartServer` sets the toast before `runCraftyServerAction` resolves | A |
| Console presented a local note list as the server stdin stream | `console.tsx` renders `lines`; refresh writes `Connected to Crafty · …` | A |

### P1 — meaningful, fixed in this branch where it was safe

| Issue | Evidence | Class |
| --- | --- | --- |
| Every poll set `isLoading`, so the hero said it was syncing and the spinner spun on a timer | `refresh` + home pill | A |
| Stale poll could overwrite a newer response, including `restarting` | no request generation | A |
| Offline label was green | `servers.tsx` `statusText` color | A |
| Home rows opened the server list, not the server | `router.push('/servers')` | B |
| `degraded` was a client threshold, not a Crafty state | `cpu > 82` | A |
| Detail screen painted `0%` and `0/0` before data, and `Connected now` on every player | `app/server/[id].tsx` | A |
| Error toasts used the success icon | home `check-circle` | B |
| No guided sideload update | no update code in the tree; see §8 | A |

### P2 — left alone

| Issue | Class |
| --- | --- |
| Detail stats and the context poll both hit `/stats` every 10s | B |
| One context value re-renders every tab | C |
| Mixed German / English copy | B |
| Control API is cleartext HTTP | A, but changing it breaks the live server |
| OpenAPI `CraftyStats` omits `worldSize`, `startedAt`, `uptime` even though `getCraftyStats` returns them and the React client already types them as optional | B. Not changed: "don't break APIs", and the mobile client already reads the extra fields |
| `disk: 0` was unused | A. The field was removed so it cannot be rendered later |
| Files `useEffect` dependency list | B |

### P3 / C — not done

FlatList, extra motion, a second palette, sandbox factory, access codes, per-server wave headers, player tool sheets. The last four exist only as release notes and APK strings. Rebuilding them from those notes would be a rewrite, and it would be wrong where the notes are thinner than the code.

### D — already good

- Secure Store plus a live probe before the key is saved.
- CPU is not multiplied by 100 on the API (`getCraftyStats` comment and math).
- Public IP substitution for loopback binds.
- Server metrics are not resurrected from AsyncStorage.
- Dark violet / Inter system. Leave it.
- Error boundary.
- No fabricated TPS.
- Path checks on the file API (`normalizeServerPath`). Out of mobile scope, but the mobile file browser depends on them.
- Hetzner host card reads `useListHetznerDedicatedServers` and shows an empty or error state instead of a fake host.

## What this branch changes

Data

- A stats failure is `unknown` (em dash, "Stats unavailable"), not offline zeros. If a previous good payload exists, it is kept and marked cached.
- CPU stays at one decimal. High CPU stays `online`; the bar carries the load.
- Restart is `restarting` only after Crafty accepts it. Polling will not overwrite that. Success is "Crafty reports it running" after an observed stop. A rejected call leaves the previous status. A timeout says the server never reported offline, or is still offline.
- Backup asks Crafty, then says a new archive exists only when the backup list contains a new id. Otherwise it says the request was accepted and nothing new is listed yet.
- `Restart proxy` resolves the `EDGE` server (name matches proxy / velocity / gateway). If Crafty did not return one, an alert says so.
- `Say message` opens the console with `say ` filled in for the selected server. It does not pretend to have broadcast.
- The console shows `getCraftyServerLogs` for the selected server while the tab is focused. The command field clears only after Crafty accepts stdin. Output is whatever comes back in the log, not a local echo painted as server text.
- Home rows open `/server/[id]`. Offline is red. The hero does not say "syncing" during a background poll, and it does not add unknown servers in as zero players.
- Detail start / stop / restart / backup use the same rule: the note describes what was asked, then what Crafty has actually reported. Controls stay disabled until a stats payload exists, so a loading `0%` cannot be acted on as "offline".

Updates

- On launch, and from Tools, the app reads the public GitHub Releases API with a User-Agent.
- It offers a download only when the release semver is newer, and only for an `.apk` whose URL starts with `https://github.com/robb-devo/aetherion-control/releases/download/`.
- Progress is bytes written against the asset size. If the file size does not match the asset, the installer is not opened.
- The next step is Android's package installer (`ACTION_VIEW` + `content://` + `REQUEST_INSTALL_PACKAGES`). The card tells the user that confirmation is mandatory. Cancelling it leaves this build installed. The app does not say the update succeeded when the installer closes.
- A build newer than the latest release is not offered a downgrade. This tree is `1.0.3`, so a build of this branch will offer `1.0.14` if GitHub still says that is latest. Installing that APK replaces this build with the published one, which does not contain these source fixes. `versionCode` stays 5 so that APK cannot be installed *over* a phone that already has 1.0.14.

## What Android still will not do

Fully automatic updates are not available to this app.

- Play in-app updates: no, unless the app is shipped on Play.
- Silent sideload: no, unless the device is managed by a device-owner policy or the app is a privileged system app.
- The system installer confirmation will keep appearing. The work in this branch is the guide around that screen, not a way past it.
- An OTA JavaScript update (`expo-updates`) could avoid the dialog for JS-only changes later. It is a different release pipeline and is not wired up.
