# PostgreSQL on Dokploy (external to the repo)

The app does **not** ship a database. You run PostgreSQL as its own service (managed DB or a Dokploy “Postgres” template) and point the API at it with a single **connection string** in environment variables.

## 1. Create a Postgres service

In Dokploy (or your host):

1. Add a new **PostgreSQL** service (or use a managed database from your provider).
2. Create a database and user, e.g. `fedextool` / a strong password.
3. Note the **host**, **port** (usually `5432`), **database name**, **user**, **password**.

The connection string format:

```text
postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

**URL-encode** the password if it contains special characters (`@`, `#`, etc.).

## 2. Wire the app (environment)

Set on your **API** / Node service (not in the git repo):

| Variable | Example | Purpose |
| -------- | ------- | ------- |
| `DATABASE_URL` | `postgresql://fedextool:SECRET@db.internal:5432/fedextool` | Primary: all JSON-backed app data |
| `FEDEX_TOOL_SECRET` | long random string | Encrypts stored passwords / tokens (unchanged) |

When `DATABASE_URL` is set, the server stores **credentials, assignment (incl. history), directory, geo-fence, access log, automations, flow scripts, and check-in flow** in table `fedextool_kv` (key/value JSONB). The first read after deploy can **migrate** existing JSON from `FEDEX_TOOL_DATA_DIR` / `local/` into PostgreSQL.

Optional:

- `FEDEX_TOOL_KV_FILE_MIRROR=1` — also write JSON files alongside Postgres (debug / backup only; not required).

**Not in Postgres:** Playwright browser profile under `FEDEX_TOOL_DATA_DIR/.../pw-user-data` (Chromium user data) stays on disk; only metadata goes to the database.

## 3. Persistence across deploys

- **Data lives in the Postgres service**, not in the app container image. Redeploying the app does not delete the DB if the DB is a separate service with a persistent volume.
- Point `DATABASE_URL` at the **stable hostname** Dokploy gives the database (often an internal DNS name on the same Docker network as the app).

## 4. Local development

```bash
# e.g. Docker
docker run -d --name pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=fedextool -p 5432:5432 postgres:16

export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5432/fedextool
```

Or omit `DATABASE_URL` to keep using JSON files under `server/.local` as before.
