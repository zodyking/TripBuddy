# Deploying FedExTool on Dokploy

## Build Type (IMPORTANT)

Dokploy defaults to **Nixpacks** auto-detection, which will **not** work for this app (it builds a static-only Caddy site and skips the Node API server).

**You must set the build type to "Dockerfile":**

1. In Dokploy, go to your application settings
2. Find **Build Type** or **Builder** setting
3. Change from "Nixpacks" / "Auto" to **"Dockerfile"**
4. Ensure **Dockerfile Path** is set to `Dockerfile` (the repo root)

## WhatsApp (WAHA) — Separate Service

WAHA runs as a **separate Docker service** in Dokploy (not bundled with the app).

1. In Dokploy, create a new **Docker** service
2. Image: `devlikeapro/waha`
3. Environment variables:
   - `WHATSAPP_DEFAULT_ENGINE=NOWEB`
   - `WHATSAPP_START_SESSION=default`
4. Expose port 3000 or assign a domain
5. In the TripBuddy app → Settings → WhatsApp → enter the WAHA URL

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

## Verify which UI bundle is deployed

After each deploy, the running app serves Vite-built files from `dist/`. Compare the server to your browser:

```
GET /api/build-info
```

Response includes `mainScript` and `mainCss` (filenames under `/assets/`, e.g. `index-DhW1B_kH.js`). Open the site’s **View source** on `(index)` and confirm the same script name appears. If they differ, the browser or a CDN is still serving an old `index.html`, or traffic is not hitting the new container.

This endpoint is public (no auth) and sends `Cache-Control: no-store`.

## Log files and `tail` on the Dokploy host

If you see:

`tail: cannot open '...' for reading: No such file or directory`

common causes:

1. **Wrong app id** — Under `/etc/dokploy/logs/`, each app has its own folder (e.g. `tripbuddy-tripbuddy-thr5x8` vs `tripbuddy-tripbuddy-knuts7`). List the directory and use the folder that actually exists.
2. **Wrong or rotated filename** — Log filenames often include a timestamp. List the folder and copy the exact name.
3. **Colons in the filename** — e.g. `tripbuddy-...-2026-05-14:15:56:51.log`. **Quote the full path** in the shell so it is not split:
   - `tail -n 200 '/etc/dokploy/logs/<your-app-folder>/<exact-file>.log'`

Discovery commands (run over SSH on the Dokploy server):

```bash
ls -la /etc/dokploy/logs/
ls -la /etc/dokploy/logs/tripbuddy-tripbuddy-*/
```

If the log directory is empty or missing, use Docker logs instead (next section).

## Docker logs (when `/etc/dokploy/logs/...` is missing)

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker logs -f <container_name_or_id>
```

Use the container that matches your TripBuddy / FedEx tool image. Dokploy’s UI “Logs” tab usually wraps the same output.

## Confirm Dockerfile build (not Nixpacks)

Your deploy **must** use the repo **Dockerfile** (multi-stage: Node `ui` + `npm run build`, then Playwright runtime with `COPY --from=ui /app/dist`).

If build logs contain **`Starting nixpacks build...`** or a **Caddy / Railway Nixpacks** base image, Dokploy is **not** using this repo’s Dockerfile. In that case, Dockerfile edits (including `CACHE_BUST`) will not produce the UI you expect.

**In Dokploy application settings:**

1. **Build type** = **Dockerfile** (not Nixpacks / Auto).
2. **Dockerfile path** = `Dockerfile` (repository root).

**After redeploy, build logs should show** lines such as:

- `FROM node:20-bookworm-slim AS ui`
- `RUN npm run build`
- `COPY --from=ui /app/dist ./dist`

They should **not** show `Starting nixpacks build...` as the primary builder for this app.

See also [nixpacks.toml](../nixpacks.toml) (fallback only; explicit Dockerfile is the reliable fix).

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
