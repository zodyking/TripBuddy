# AGENTS.md

## Cursor Cloud specific instructions

### Project overview
FedExTool is a Vue 3 + Fastify full-stack app for FedEx Ground Linehaul dispatch automation. The frontend (Vite 8, Vue 3) runs on port 5173 and proxies `/api` to the Fastify backend on port 3847. See `package.json` scripts for standard commands.

### Required services
| Service | How to start | Notes |
|---------|-------------|-------|
| PostgreSQL | `pg_ctlcluster 16 main start` | Must create db `fedextool` and set password on first run: `su - postgres -c "createdb fedextool"` then `su - postgres -c "psql -c \"ALTER USER postgres PASSWORD 'dev';\""` |
| API + UI (dev) | `npm run dev` | Starts both Fastify API (:3847) and Vite dev server (:5173) via `concurrently` |

### Environment variables
```
DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5432/fedextool
FEDEX_TOOL_AUTH_ENABLED=0   # disable auth for local dev (no FedEx credentials needed)
```
These must be exported in the shell before running `npm run dev`.

### Gotchas
- The server **exits immediately** if PostgreSQL is unreachable (`requirePostgresOrThrow()`). Always start PostgreSQL first.
- `server/package.json` has a `postinstall` script that runs `playwright install chromium`. This downloads ~110 MB of Chromium binaries on first install. If the download fails, the server will still start but all Playwright-based automation endpoints will error.
- There is no ESLint, TypeScript, or test framework configured in this repo. Lint and test commands are not available.
- `npm run build` runs `vite build` producing `dist/`. The Fastify server serves this statically in production; in dev mode it warns `dist folder not found` which is expected.
- The Vite plugin `vite-plugin-fedextool-api.mjs` auto-starts the Fastify API when running `npm run dev:ui` alone (checks health on :3847 first). When using `npm run dev`, `concurrently` starts both, so the plugin detects the API is already up.
