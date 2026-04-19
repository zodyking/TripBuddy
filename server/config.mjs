import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Stable entry: opens dispatch app; Okta redirect happens from here (do not use one-time OAuth URLs). */
export const DISPATCH_ENTRY_URL =
  process.env.FEDEX_DISPATCH_URL ??
  'https://fdxtools.fedex.com/grdlhldispatch/home'

/**
 * Successful app login (Playwright probe) requires landing on this path after PurpleID + dispatch.
 * Override with FEDEX_DISPATCH_LOGIN_SUCCESS_PATH if FedEx changes routing.
 */
export const DISPATCH_LOGIN_SUCCESS_PATH =
  (process.env.FEDEX_DISPATCH_LOGIN_SUCCESS_PATH || '').trim() ||
  '/grdlhldispatch/grdlhldispatch/home'

/**
 * Optional: full PurpleID authorize URL for session open only.
 * PKCE params expire — prefer leaving unset so the browser uses DISPATCH_ENTRY_URL and gets a fresh redirect.
 */
export const SESSION_START_URL =
  (process.env.FEDEX_OKTA_AUTHORIZE_URL || '').trim() || DISPATCH_ENTRY_URL

export const API_PORT = Number(process.env.FEDEX_TOOL_API_PORT ?? 3847)

/**
 * Root directory for all persistent data (credentials, automations, user data, uploads).
 * Set `FEDEX_TOOL_DATA_DIR` (e.g. `/data`) so JSON stores survive deploys and are shared across devices hitting the same API.
 * Subfolders: `local/`, `pw-user-data/`, `uploads-tmp/`. When unset, dev defaults under `server/` (`.local`, etc.).
 */
export const PERSISTENCE_DATA_ROOT = process.env.FEDEX_TOOL_DATA_DIR
  ? path.resolve(process.env.FEDEX_TOOL_DATA_DIR)
  : null

export const LOCAL_DIR = PERSISTENCE_DATA_ROOT
  ? path.join(PERSISTENCE_DATA_ROOT, 'local')
  : path.join(__dirname, '.local')

export const USER_DATA_DIR = PERSISTENCE_DATA_ROOT
  ? path.join(PERSISTENCE_DATA_ROOT, 'pw-user-data')
  : path.join(__dirname, '.pw-user-data')

export const UPLOADS_DIR = PERSISTENCE_DATA_ROOT
  ? path.join(PERSISTENCE_DATA_ROOT, 'uploads-tmp')
  : path.join(__dirname, '.uploads-tmp')

/** Default poll interval (ms) when checking for assignment changes */
export const POLL_INTERVAL_MS = Number(process.env.FEDEX_POLL_INTERVAL_MS ?? 120_000)

/**
 * Min time (ms) FedEx dispatch URL must stay stable before continuing (avoids late PurpleID redirect).
 * Lower = faster but may race; set FEDEX_DISPATCH_STABLE_MS in .env to tune.
 */
export const DISPATCH_STABLE_MS = Number(
  process.env.FEDEX_DISPATCH_STABLE_MS ?? 2000,
)

/** Set in .env for encrypting stored Okta password (change default in production). */
export const TOOL_SECRET_HINT =
  'Set FEDEX_TOOL_SECRET in .env for a unique encryption key.'
