# Deploying FedExTool on Dokploy

## Build Type (IMPORTANT)

Dokploy defaults to **Nixpacks** auto-detection, which will **not** work for this app (it builds a static-only Caddy site and skips the Node API server).

**You must set the build type to "Dockerfile":**

1. In Dokploy, go to your application settings
2. Find **Build Type** or **Builder** setting
3. Change from "Nixpacks" / "Auto" to **"Dockerfile"**
4. Ensure **Dockerfile Path** is set to `Dockerfile` (the repo root)

## WhatsApp (WAHA) — Separate Service

WAHA runs as a **separate Docker service** in Dokploy (not bundled with the app). WAHA requires an API key (`X-Api-Key` header); URL alone is not enough.

### WAHA service (Dokploy)

1. Create a new **Docker** service
2. Image: `devlikeapro/waha`
3. Environment variables (example):
   - `WHATSAPP_DEFAULT_ENGINE=NOWEB`
   - `WHATSAPP_START_SESSION=default`
   - `WAHA_API_KEY=<generate-a-plain-key>` (or `sha512:…` hash — send the **plain** key in requests)
4. Expose port 3000 on the Dokploy internal network (or a private URL)

### TripBuddy app (same Dokploy project)

On the **TripBuddy** container, set:

| Variable | Example | Description |
|----------|---------|-------------|
| `WAHA_BASE_URL` | `http://<waha-service-name>:3000` | Internal URL reachable from TripBuddy (Docker/Dokploy network) |
| `WAHA_API_KEY` | same plain key as WAHA | Injected as `X-Api-Key` on `/api/waha/*` proxy requests |

In the app → **Settings → WhatsApp**: leave **WAHA URL** empty (uses `/api/waha` proxy). Tap **Check connection**, scan QR if needed, **List chats**, and select the chat to monitor.

Verify after deploy: `GET /api/health` includes `waha.apiKeyConfigured: true` and `waha.baseUrlConfigured: true`.

Optional: set a **WAHA URL override** and API key in Settings only if the browser must call WAHA directly (not recommended).

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
GET /api/health
```

Response includes `mainScript`, `mainCss`, `gitCommit`, `builtAt`, and `buildLabel` (short summary). **Settings → General → API** shows **App build:** with the same label.

Open the site’s **View source** on `(index)` and confirm the same `index-….js` script name as `mainScript`. If they differ, the browser or a CDN is still serving an old `index.html`, or traffic is not hitting the new container.

These endpoints are public (no auth) and send `Cache-Control: no-store`. `index.html` is also served with `no-store` so a normal refresh should pick up new bundles.

## Still seeing a stale UI after redeploy?

Work through this list in order:

1. **Confirm Dokploy used the Dockerfile** — Build logs must show `FROM node:20-bookworm-slim AS ui` and `RUN npm run build`. If you see `Starting nixpacks build...` or Caddy, change **Build type** to **Dockerfile** (see top of this doc).

2. **Force a clean image build** — In Dokploy application → **Build**, enable **disable cache** / **no cache** (wording varies by version), then deploy again. Docker layer cache can reuse an old `dist/` even when git has new commits.

3. **Set build arg `GIT_COMMIT`** — Application → **Build** → **Build args**:
   - Name: `GIT_COMMIT`
   - Value: your git commit SHA for that deploy (any non-empty string that changes per deploy is enough to bust the UI layer when combined with a clean build).

4. **Compare server vs browser**
   - On phone/desktop: open `https://<your-host>/api/build-info`
   - Note `mainScript` (e.g. `index-CbNaV9kK.js`)
   - View page source on the app — the `<script type="module">` src must match.
   - If `/api/build-info` is new but the page source is old → browser cache or reverse proxy in front of Dokploy; hard refresh or try a private window.

5. **Confirm the new container is live** — On the Dokploy host: `docker ps` and check **Created** time on the TripBuddy container. If Created is old, the deploy did not replace the container.

6. **Wrong app / domain** — Multiple TripBuddy apps in Dokploy can point at different images; verify the domain you open is the app you redeployed.

7. **PWA / installed app** — If the site was added to the home screen, remove it and open in Safari/Chrome again (there is no service worker in this repo, but OS-level caching can still bite).

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
| `WAHA_BASE_URL` | For WhatsApp | `http://waha:3000` | Internal URL of your WAHA Dokploy service |
| `WAHA_API_KEY` | For WhatsApp | (none) | Plain WAHA API key (same value as on the WAHA container) |

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
