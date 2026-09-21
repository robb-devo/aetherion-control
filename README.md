# AETHERION Control

Private phone app + API to steer Crafty on the Hetzner box.

## Unlock (phone)

1. API Base: `http://135.181.18.162:5055`
2. Control API Key: value of `CONTROL_API_KEY` on the server (`/etc/aetherion-control.env`)

## Server deploy

```bash
# on Hetzner after syncing this repo to /opt/aetherion-control
cd /opt/aetherion-control
pnpm install
pnpm --filter @workspace/api-server run build
install -m 600 deploy/aetherion-control.env.example /etc/aetherion-control.env
# edit /etc/aetherion-control.env → CRAFTY_API_TOKEN + CONTROL_API_KEY
cp deploy/aetherion-control.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now aetherion-control
ufw allow 5055/tcp || true
curl -s http://127.0.0.1:5055/api/healthz
```

## Local mobile

```bash
pnpm install
pnpm --filter @workspace/minecraft-server-control run dev
```

APK: `eas build` / Expo export once the API is live.
