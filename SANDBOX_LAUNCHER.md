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

The friend key cannot read Crafty, infrastructure, or provisioning. Those routes require a permission the launcher principal does not have.

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

`deploy/` does not contain a deploy script. The live process is the systemd unit in `deploy/aetherion-control.service`:

- Unit name: `aetherion-control.service`
- `EnvironmentFile=/etc/aetherion-control.env`
- `WorkingDirectory=/opt/aetherion-control/artifacts/api-server`
- `ExecStart=/usr/bin/node --enable-source-maps /opt/aetherion-control/artifacts/api-server/dist/index.mjs`
- `After=network.target crafty.service` and `Wants=crafty.service`
- `Restart=always`

The env file on the host is `/etc/aetherion-control.env`. `deploy/aetherion-control.env.example` is the template (port **5055**, Crafty URL, `CONTROL_API_KEY`, public IP). The unit does not read the example file.

On the host that serves `135.181.18.162:5055`:

1. In the checkout that contains `/opt/aetherion-control` (the parent of the unit’s working directory), check out the merged `main` that contains this change.
2. From that repo root, install and build the API bundle the unit executes:

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @workspace/api-server build
   ```

   `build` runs `node ./build.mjs` and writes `artifacts/api-server/dist/index.mjs`.
3. Keep `CONTROL_API_KEY` in `/etc/aetherion-control.env` for the phone app. Do not add an access code. Leave `LAUNCHER_SERVICE_KEY` unset so the baked key `aetherion-launcher-friend-v1` is accepted. Set it only when rotating the launcher credential to the same value.
4. If the unit is not installed yet:

   ```bash
   sudo cp deploy/aetherion-control.service /etc/systemd/system/aetherion-control.service
   sudo systemctl daemon-reload
   sudo systemctl enable aetherion-control
   ```

   This change does not edit the unit file. Skip the copy when the unit is already the one in `deploy/`.
5. Restart and confirm:

   ```bash
   sudo systemctl restart aetherion-control
   systemctl status aetherion-control
   curl -sS -D - -o /tmp/sandbox-options.json \
     -H "Authorization: Bearer aetherion-launcher-friend-v1" \
     -H "X-Aetherion-Player: a1b2c3d4e5f67890abcdef1234567890" \
     http://127.0.0.1:5055/api/sandbox/options
   ```

   A friend-key sandbox call must not return 401. Crafty may answer 502 on `/options` until Crafty itself is up; that is not an auth failure. `GET /api/sandbox/servers` with the same headers should return `{"servers":[...]}` for that UUID only.
