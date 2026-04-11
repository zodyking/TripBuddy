# Deploying FedExTool on Dokploy

## Build Type (IMPORTANT)

Dokploy defaults to **Nixpacks** auto-detection, which will **not** work for this app (it builds a static-only Caddy site and skips the Node API server).

**You must set the build type to "Dockerfile":**

1. In Dokploy, go to your application settings
2. Find **Build Type** or **Builder** setting
3. Change from "Nixpacks" / "Auto" to **"Dockerfile"**
4. Ensure **Dockerfile Path** is set to `Dockerfile` (the repo root)

The repo includes a [`nixpacks.toml`](../nixpacks.toml) that disables Nixpacks phases as a fallback, but explicitly selecting "Dockerfile" build type is the reliable fix.

## Port mapping

| Container port | Purpose |
|----------------|---------|
| `3847`         | Fastify API + Vue SPA |

Set Dokploy to map host port → `3847` (or change via `FEDEX_TOOL_API_PORT`).

### Bad Gateway (502) from Traefik

If the site loads **Bad Gateway** but the container is running, the reverse proxy is almost always pointing at the **wrong internal port**.

- In **Domains** (or routing) for this app, the **container / internal port** must be **`3847`** — the port Fastify listens on inside the image (`EXPOSE 3847` in the Dockerfile).
- Do **not** use `5173` (Vite dev), `3000`, or a random value like `5137`. Those will return **502 Bad Gateway** because nothing is listening there.

If you intentionally change the listen port, set `FEDEX_TOOL_API_PORT` in the container env **and** set the same value as the internal port on the domain route.

## Health check

```
GET /api/health
```

Returns `{ "ok": true, "busy": false }` when healthy.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FEDEX_TOOL_SECRET` | **Yes** | dev key | Encryption key for stored credentials; **must be unique in production** |
| `FEDEX_TOOL_API_HOST` | No | `0.0.0.0` | Listen address (container default is already `0.0.0.0`) |
| `FEDEX_TOOL_API_PORT` | No | `3847` | Listen port |
| `FEDEX_TOOL_DATA_DIR` | Recommended | `server/.local` etc. | Root path for persistent data; set to your mounted volume path (e.g. `/data`) |
| `FEDEX_DISPATCH_URL` | No | FedEx default | Override Ground Linehaul dispatch entry URL |
| `FEDEX_OKTA_AUTHORIZE_URL` | No | (none) | PurpleID authorize URL for session start |
| `FEDEX_POLL_INTERVAL_MS` | No | `120000` | Poll interval for assignment changes |

## Volume mount

Persistent data lives in three sub-directories under `FEDEX_TOOL_DATA_DIR`:

- `local/` — credentials, automations, assignment, check-in flow, flow scripts
- `pw-user-data/` — Playwright persistent context (cookies, session)
- `uploads-tmp/` — temporary uploaded files

Bind a Dokploy volume (or host path) to the container path you set in `FEDEX_TOOL_DATA_DIR`:

```
Host volume  →  /data  (container)
FEDEX_TOOL_DATA_DIR=/data
```

## Resource recommendations

Playwright + Chromium is heavy:

- **Memory:** 1.5–2 GB minimum recommended; 2.5+ GB for stable long runs
- **CPU:** 1–2 cores
- **Disk:** ~800 MB for browser binaries + working space

## Example Dokploy settings

| Setting | Value |
|---------|-------|
| Port | `3847` |
| Volumes | `<volume>:/data` |
| Environment | `FEDEX_TOOL_SECRET=<your-secret>`, `FEDEX_TOOL_DATA_DIR=/data` |
| Health check | `GET /api/health` |
| Memory limit | `2048m` |
