# AETHERION Control

Private Android app to steer Crafty on your Hetzner box.

## Download APK

Get the latest APK from **[Releases](https://github.com/robb-devo/aetherion-control/releases)**.

Install on Android (allow unknown sources), open the app, unlock with:

| Field | Value |
|------|------|
| API Base URL | `http://135.181.18.162:5055` |
| Control API Key | value of `CONTROL_API_KEY` in `/etc/aetherion-control.env` on the server |

Then: **Servers** → tap a node → Start / Stop / Restart. Console sends commands to the selected server.

## What this is

- Mobile UI salvaged from the Replit scaffold (server list, detail, console)
- Personal Control API on the Hetzner host (no Clerk / Google / Replit)
- Crafty wired with a real API token

## Server API

Runs as `aetherion-control.service` on port **5055**.
