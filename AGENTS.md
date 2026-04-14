# AGENTS.md

## Cursor Cloud specific instructions

### Overview

FedExTool is a Vue 3 + Fastify dispatch dashboard for FedEx Ground Linehaul operations. It uses Playwright (Chromium) for browser automation against FedEx internal systems.

### Project structure

- **Root**: Vue 3 frontend (Vite 8, `src/`)
- **`server/`**: Fastify 5 API backend (plain JS, ES Modules)
- Two separate `package.json` / `package-lock.json` — root (frontend + dev tooling) and `server/` (backend + Playwright)
- Data is stored as JSON files in `server/.local/` (no database)

### Running in development

```sh
npm run dev          # Starts both API (:3847) and Vite UI (:5173) via concurrently
npm run dev:ui       # Vite only (API auto-started by vite plugin if not already running)
npm run dev:server   # API only (node --watch server/index.mjs)
```

The Vite config includes a custom plugin (`vite-plugin-fedextool-api.mjs`) that auto-starts the API server when running `vite` alone, so `npm run dev:ui` also works standalone.

### Build

```sh
npm run build   # Vite production build → dist/
```

### Key caveats

- **No lint/test config**: The project has no ESLint, Prettier, or test runner configured. No `lint` or `test` npm scripts exist.
- **Node version**: Requires `^20.19.0 || >=22.12.0` (specified in both `package.json` engines fields).
- **Playwright Chromium**: The `server/package.json` `postinstall` script runs `playwright install chromium`. System dependencies for Chromium should be installed via `npx playwright install-deps chromium` if not already present.
- **No database**: All persistent state is JSON files under `server/.local/`. No migrations needed.
- **External FedEx services**: Actual dispatch automation and Linehaul API calls require FedEx Okta credentials and network access to `fdxtools.fedex.com` / `fxg-prod-prod.apigee.net`. The app runs fine without these — features simply return auth errors.
- **`dist/` warning on API startup**: In dev mode, the API logs `WARNING: dist folder not found at /workspace/dist` — this is expected; the Vite dev server serves the UI instead.
