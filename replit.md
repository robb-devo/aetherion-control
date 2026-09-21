# AETHERION

A premium mobile-first control center for Crafty-managed Minecraft servers and future Hetzner infrastructure.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Crafty env: `CRAFTY_BASE_URL`, `CRAFTY_USERNAME`, `CRAFTY_PASSWORD`
- Clerk env is provisioned by Replit Auth tooling and must never be exposed outside the expected public publishable key.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/minecraft-server-control` — Expo mobile app
- `artifacts/api-server/src/lib/crafty.ts` — server-only Crafty client
- `artifacts/api-server/src/routes/crafty.ts` — authenticated control API
- `lib/api-spec/openapi.yaml` — API contract and generated client source
- `artifacts/minecraft-server-control/constants/colors.ts` — AETHERION color tokens

## Architecture decisions

- The mobile app never talks directly to Crafty, Hetzner, SSH, or host credentials.
- Clerk protects all Crafty API routes; Expo attaches a short-lived Clerk bearer token.
- Crafty uses its pinned public self-signed certificate instead of disabling TLS verification globally.
- Crafty responses are normalized by the API server before reaching the mobile app.
- Future host operations belong behind a local Aetherion Agent with outbound-only connectivity.

## Product

- Live Crafty server inventory and per-server stats
- Confirmed restart actions and authenticated console commands
- Cached last-known state for mobile resilience
- Premium dark fantasy-tech mobile interface
- Hetzner provisioning, files, plugins, backups, and multi-host support are planned extensions

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Regenerate API clients after changing `lib/api-spec/openapi.yaml`.
- The Crafty certificate currently expires in September 2027 and must be re-pinned when the controller certificate rotates.
- Expo workflows may leave an older Metro process on the injected port; remove the stale process before restarting rather than accepting a second port.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
