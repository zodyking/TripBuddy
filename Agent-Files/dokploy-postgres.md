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
| `FEDEX_TOOL_DATA_ACCOUNT_KEY` | 64-char hex (same as account id) | Only when `FEDEX_TOOL_AUTH_ENABLED=0`: which user’s row in `fedextool_kv` to use (`u:<key>:…`); set to the same id you use for that machine’s data |

The server **requires** a working `DATABASE_URL`. It does **not** use JSON on disk for runtime reads/writes. On startup, it runs a **one-time import** of legacy `FEDEX_TOOL_DATA_DIR` JSON (and some older flat `fedextool_kv` key names) into the new key layout: global keys are prefixed with `g:`; per-user data uses `u:<account_sha256>:` and matches the account id derived from the username.

**Not in Postgres:** Playwright browser profile under `FEDEX_TOOL_DATA_DIR/.../pw-user-data` (Chromium user data) stays on disk; only metadata lives in the database.

## 3. Persistence across deploys

- **Data lives in the Postgres service**, not in the app container image. Redeploying the app does not delete the DB if the DB is a separate service with a persistent volume.
- Point `DATABASE_URL` at the **stable hostname** Dokploy gives the database (often an internal DNS name on the same Docker network as the app).

## 4. Local development

```bash
# e.g. Docker
docker run -d --name pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=fedextool -p 5432:5432 postgres:16

export DATABASE_URL=postgresql://postgres:dev@127.0.0.1:5432/fedextool
```

A local `DATABASE_URL` (container or `USE_LOCAL_POSTGRES=1` with `PG*`) is required; there is no file-based fallback.
