# Deploying FedExTool on Dokploy

## Build command (uses repo Dockerfile)

Dokploy should detect the [`Dockerfile`](../Dockerfile) automatically; no custom build command needed.

## Port mapping

| Container port | Purpose |
|----------------|---------|
| `3847`         | Fastify API + Vue SPA |

Set Dokploy to map host port → `3847` (or change via `FEDEX_TOOL_API_PORT`).

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
