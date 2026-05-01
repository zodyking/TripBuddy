## Cursor Cloud specific instructions

### Overview

FedExTool is a FedEx Ground Linehaul dispatch automation/monitoring tool. Two logical halves:
- **Vue 3 SPA** (root `package.json`) — Vite 8 dev server on `:5173`
- **Fastify API** (`server/package.json`) — Node.js server on `:3847`, uses Playwright/Chromium for browser automation

### Running the dev environment

Standard commands are in `README.md` and `package.json`:

```bash
export DATABASE_URL="postgresql://postgres:dev@127.0.0.1:5432/fedextool"
export FEDEX_TOOL_AUTH_ENABLED=0   # disables auth for local dev
npm run dev                        # starts both Vite + Fastify via concurrently
```

`npm run dev` uses `concurrently` to launch both `vite` (UI on `:5173`) and `node --watch server/index.mjs` (API on `:3847`). The Vite config proxies `/api` to the Fastify server.

### Key gotchas

- **PostgreSQL is mandatory.** The server calls `requirePostgresOrThrow()` at startup and exits immediately if `DATABASE_URL` is unset or the connection fails. Start PostgreSQL first:
  ```
  pg_ctlcluster 16 main start
  ```
- **Playwright Chromium** is installed automatically by the server's `postinstall` script. If the system Chromium deps are missing, run `npx playwright install-deps chromium`.
- **No lint/test scripts** are configured in either `package.json`. There is no ESLint, Prettier, Vitest, or Jest config. The `build` command (`npm run build`) via Vite is the only verification available.
- **Auth can be disabled** with `FEDEX_TOOL_AUTH_ENABLED=0`. Without this, the app requires FedEx Okta/PurpleID credentials.
- The Vite plugin `vite-plugin-fedextool-api.mjs` auto-starts the API server if it isn't already running. When using `npm run dev`, `concurrently` starts both; the plugin detects the existing API and skips its own spawn.
- **dist folder warning** is normal during dev: the server logs `WARNING: dist folder not found` because the production build hasn't been created. This doesn't affect dev mode.
- Optional env vars: `VITE_TOMTOM_KEY` (map tiles/traffic), `TOMTOM_API_KEY` (server-side traffic corridor). App works without them.
