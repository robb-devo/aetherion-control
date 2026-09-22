#!/bin/bash
# Update the Aetherion control API so the desktop launcher can create sandboxes.
#
# This restarts aetherion-control.service only.
# It does not stop, restart, reload, or reconfigure Crafty, proxies, or the
# production Minecraft network. Restarting this unit does not restart units
# listed in After= or Wants=.
set -euo pipefail

ROOT="${AETHERION_CONTROL_ROOT:-/opt/aetherion-control}"
ENV_FILE="${AETHERION_CONTROL_ENV:-/etc/aetherion-control.env}"
UNIT="aetherion-control.service"
PUBLIC_HOST="${AETHERION_PUBLIC_HOST:-135.181.18.162}"
PORT="5055"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/apply-launcher-sandbox.sh" >&2
  exit 1
fi

if [[ ! -d "$ROOT/.git" ]]; then
  echo "No git checkout at $ROOT" >&2
  exit 1
fi

CRAFTY_BEFORE=""
if systemctl cat crafty.service >/dev/null 2>&1; then
  CRAFTY_BEFORE="$(systemctl show crafty.service -p ActiveEnterTimestamp --value || true)"
fi

cd "$ROOT"
git fetch origin main
git checkout main
git pull --ff-only origin main

# The baked launcher bearer is aetherion-launcher-friend-v1.
# An explicit LAUNCHER_SERVICE_KEY would 401 that key, so comment it out.
# Do not print or rewrite the rest of the env file.
if [[ -f "$ENV_FILE" ]]; then
  parsed_port="$(grep -E '^[[:space:]]*PORT=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\"' || true)"
  if [[ "$parsed_port" =~ ^[0-9]+$ ]]; then
    PORT="$parsed_port"
  fi
  if grep -qE '^[[:space:]]*LAUNCHER_SERVICE_KEY=' "$ENV_FILE"; then
    tmp="$(mktemp)"
    sed -E 's/^[[:space:]]*LAUNCHER_SERVICE_KEY=/# LAUNCHER_SERVICE_KEY=/' "$ENV_FILE" >"$tmp"
    cat "$tmp" >"$ENV_FILE"
    rm -f "$tmp"
  fi
fi

pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server build

systemctl restart "$UNIT"
systemctl is-active --quiet "$UNIT"

if [[ -n "$CRAFTY_BEFORE" ]]; then
  CRAFTY_AFTER="$(systemctl show crafty.service -p ActiveEnterTimestamp --value || true)"
  if [[ "$CRAFTY_BEFORE" != "$CRAFTY_AFTER" ]]; then
    echo "crafty.service ActiveEnterTimestamp changed during this script." >&2
    echo "This script never calls systemctl against crafty. Investigate before continuing." >&2
    exit 1
  fi
fi

echo "Restarted ${UNIT} only. crafty.service was not restarted."
echo "Public API: http://${PUBLIC_HOST}:${PORT}"

smoke_body="$(mktemp)"
smoke_code="$(curl -sS -o "$smoke_body" -w '%{http_code}' \
  -H "Authorization: Bearer aetherion-launcher-friend-v1" \
  -H "X-Aetherion-Player: a1b2c3d4e5f67890abcdef1234567890" \
  "http://127.0.0.1:${PORT}/api/sandbox/servers")"
rm -f "$smoke_body"

echo "GET /api/sandbox/servers -> HTTP ${smoke_code}"
if [[ "$smoke_code" == "401" || "$smoke_code" == "403" ]]; then
  echo "Friend key was rejected. Leave LAUNCHER_SERVICE_KEY unset and restart ${UNIT} only." >&2
  exit 1
fi
if [[ "$smoke_code" != "200" ]]; then
  echo "Expected HTTP 200 from the sandbox list." >&2
  exit 1
fi
echo "Friend key accepted. Sandbox list is scoped to that Microsoft UUID."
