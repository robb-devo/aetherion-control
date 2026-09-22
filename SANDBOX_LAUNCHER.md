# Sandbox launcher auth

The desktop launcher (`robb-devo/launcheraetherion`, and the launcher in this repo) does not ask for an access code. Microsoft sign-in is the player identity. The control API accepts a baked friend key and scopes sandbox rows to that Microsoft UUID.

## What the launcher sends

After Microsoft login the launcher calls `http://135.181.18.162:5055` (override with `AETHERION_API_BASE` or the launcher’s saved API base).

Every sandbox request includes:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer aetherion-launcher-friend-v1` |
| `X-Aetherion-Player` | Microsoft / Minecraft UUID, 32 hex characters. Dashes are optional. |

`LAUNCHER_SERVICE_KEY` on the API replaces the baked bearer. When that variable is unset or blank, the API uses `aetherion-launcher-friend-v1`. The launcher can send a different bearer only when `AETHERION_CONTROL_KEY` or a saved service key is set on that machine.

The friend key is **not** `CONTROL_API_KEY` and it is not an access code. Sandbox routes accept it even when `CONTROL_API_KEY` is missing. Other routes still use `CONTROL_API_KEY` for the phone app.

## What the API does

`requireAuth` classifies the bearer:

- `CONTROL_API_KEY` → owner, permission `*`. Used by the phone app. A player header, when present, scopes that call to the same Microsoft id and hides legacy unowned rows.
- `LAUNCHER_SERVICE_KEY` (default `aetherion-launcher-friend-v1`) → `LAUNCHER_SERVICE`, permission `sandbox` only.

The friend key cannot read Crafty, infrastructure, or provisioning. Those routes require a permission the launcher principal does not have. Sandbox create, start, stop, and delete only touch Crafty servers recorded in the sandbox store (`sandbox-*` names, ports 25600–25649). They do not restart or reconfigure the production network.

Presets include **16 GB** (`balanced`, the default — the launcher preselects that id) and **24 GB** (`large`). CPU stays at 4 cores per sandbox and 8 cores in the pool. The RAM pool default is 64 GB (`SANDBOX_POOL_GB` / `SANDBOX_MAX_GB`).

Sandbox calls with the friend key require `X-Aetherion-Player`. The owner id stored on each row is `sha256("aetherion.sandbox.owner.v1:ms:" + uuid)`. List, start, stop, delete, and upload only see rows with that owner id. A missing player header is 401 (`Sign in with Microsoft before using sandboxes.`). A non-UUID header is 400.

## Routes

All paths are under `/api` and require `Authorization: Bearer` plus, for the friend key, `X-Aetherion-Player`.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/sandbox/options` | Pool, engines, versions |
| `GET` | `/api/sandbox/servers` | This player’s sandboxes |
| `POST` | `/api/sandbox/servers` | Create one |
| `POST` | `/api/sandbox/servers/:id/start` | Start |
| `POST` | `/api/sandbox/servers/:id/stop` | Stop |
| `DELETE` | `/api/sandbox/servers/:id` | Delete |
| `POST` | `/api/sandbox/servers/:id/files` | Text upload (256 KB, no jars) |

There is no access-code field and no `/api/auth/unlock` step for these routes.

## Deploy on the live host

Public API: `http://135.181.18.162:5055`.

The live process is `deploy/aetherion-control.service`:

- Unit name: `aetherion-control.service`
- `EnvironmentFile=/etc/aetherion-control.env`
- `WorkingDirectory=/opt/aetherion-control/artifacts/api-server`
- `ExecStart=/usr/bin/node --enable-source-maps /opt/aetherion-control/artifacts/api-server/dist/index.mjs`
- `After=network.target crafty.service` and `Wants=crafty.service` (startup order only)
- `Restart=always`

`/etc/aetherion-control.env` follows `deploy/aetherion-control.env.example`. Keep `CONTROL_API_KEY` for the phone app. Leave `LAUNCHER_SERVICE_KEY` unset.

After this is on `main`, on the host:

```bash
sudo bash /opt/aetherion-control/deploy/apply-launcher-sandbox.sh
```

The script checks out `main`, runs `pnpm install --frozen-lockfile` and `pnpm --filter @workspace/api-server build`, comments out `LAUNCHER_SERVICE_KEY` if it was set, and runs `systemctl restart aetherion-control.service`. It does not call `systemctl` on `crafty.service` and it does not restart the production Minecraft network. Restarting the control API unit does not restart Crafty.

Smoke test (list only — it does not create a server):

```bash
curl -sS -D - \
  -H "Authorization: Bearer aetherion-launcher-friend-v1" \
  -H "X-Aetherion-Player: a1b2c3d4e5f67890abcdef1234567890" \
  http://135.181.18.162:5055/api/sandbox/servers
```

Expect HTTP 200 and `{"servers":[...]}` for that UUID. HTTP 401 means the host is still running the old API. `GET /api/sandbox/options` can return 502 when Crafty’s jar cache is unreachable; that is not an auth failure, and it does not restart Crafty.
