/**
 * Per-account API usage: rolling per-minute rate limits + daily hard caps (PostgreSQL).
 * Buckets: here, tomtom, fedex_linehaul, panynj, ny511
 */
import { requestAsyncLocalStorage } from './request-context.mjs'
import { getLastActiveAccountKey } from './active-account.mjs'
import { getPostgresPool } from './kv-pg.mjs'
import { ensureUserProfileTable } from './user-profile-pg.mjs'

export const API_BUCKETS = /** @type {const} */ ([
  'here',
  'tomtom',
  'fedex_linehaul',
  'panynj',
  'ny511',
])

/** @typedef {(typeof API_BUCKETS)[number]} ApiBucket */

const BUCKET_LABELS = {
  here: 'HERE (traffic & routing)',
  tomtom: 'TomTom (routing / highway fallback)',
  fedex_linehaul: 'FedEx Linehaul',
  panynj: 'PANYNJ bridge crossing API',
  ny511: '511NY cameras API',
}

/** Built-in defaults per calendar day (UTC) and per rolling minute. */
const DEFAULT_DAY = {
  here: 800,
  tomtom: 800,
  fedex_linehaul: 80_000,
  panynj: 4000,
  ny511: 500,
}

const DEFAULT_PER_MINUTE = {
  here: 40,
  tomtom: 40,
  fedex_linehaul: 200,
  panynj: 30,
  ny511: 15,
}

const MAX_LIMIT_DAY = 50_000_000
const MAX_PER_MINUTE = 10_000

/** @type {Map<string, number[]>} */
const minuteBuckets = new Map()

function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

function envNum(name, fallback) {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

/**
 * @param {ApiBucket} bucket
 */
export function defaultDailyLimit(bucket) {
  const key = `API_QUOTA_${String(bucket).toUpperCase()}_DAY`
  return envNum(key, DEFAULT_DAY[bucket] ?? 1000)
}

/**
 * @param {ApiBucket} bucket
 */
export function defaultPerMinuteLimit(bucket) {
  const key = `API_QUOTA_${String(bucket).toUpperCase()}_PER_MINUTE`
  return envNum(key, DEFAULT_PER_MINUTE[bucket] ?? 60)
}

export class ApiQuotaError extends Error {
  /**
   * @param {ApiBucket} bucket
   * @param {string} message
   * @param {'daily' | 'rate'} kind
   */
  constructor(bucket, message, kind = 'daily') {
    super(message)
    this.name = 'ApiQuotaError'
    this.bucket = bucket
    this.kind = kind
    this.code = 'API_QUOTA_EXCEEDED'
  }
}

export function getQuotaAccountKey() {
  const req = requestAsyncLocalStorage.getStore()
  const fromReq =
    req && typeof req.credentialAccountKey === 'string'
      ? req.credentialAccountKey.trim()
      : ''
  if (fromReq) return fromReq
  return String(getLastActiveAccountKey() || '').trim()
}

/**
 * @param {string} accountKey
 * @param {ApiBucket} bucket
 * @returns {Promise<{ dayKey: string, counts: Record<string, number>, limitOverrides: Record<string, number> }>}
 */
async function loadQuotaState(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) {
    return {
      dayKey: utcDayKey(),
      counts: {},
      limitOverrides: {},
    }
  }
  const p = await getPostgresPool()
  if (!p) {
    return { dayKey: utcDayKey(), counts: {}, limitOverrides: {} }
  }
  await ensureUserProfileTable()
  const { rows } = await p.query(
    `SELECT api_quota_state FROM fedextool_user_profile WHERE account_key = $1`,
    [ak],
  )
  const raw = rows[0]?.api_quota_state
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? /** @type {Record<string, unknown>} */ (raw)
      : {}
  const today = utcDayKey()
  let dayKey = typeof o.dayKey === 'string' ? o.dayKey : today
  /** @type {Record<string, number>} */
  let counts = {}
  if (o.counts && typeof o.counts === 'object' && !Array.isArray(o.counts)) {
    counts = /** @type {Record<string, number>} */ (o.counts)
  }
  if (dayKey !== today) {
    dayKey = today
    counts = {}
  }
  /** @type {Record<string, number>} */
  let limitOverrides = {}
  if (
    o.limitOverrides &&
    typeof o.limitOverrides === 'object' &&
    !Array.isArray(o.limitOverrides)
  ) {
    limitOverrides = /** @type {Record<string, number>} */ (o.limitOverrides)
  }
  return { dayKey, counts, limitOverrides }
}

/**
 * @param {string} accountKey
 * @param {{ dayKey: string, counts: Record<string, number>, limitOverrides: Record<string, number> }} state
 */
async function saveQuotaState(accountKey, state) {
  const ak = String(accountKey || '').trim()
  if (!ak) return
  const p = await getPostgresPool()
  if (!p) return
  await ensureUserProfileTable()
  const payload = JSON.stringify({
    dayKey: state.dayKey,
    counts: state.counts,
    limitOverrides: state.limitOverrides,
  })
  await p.query(
    `INSERT INTO fedextool_user_profile (account_key, api_quota_state, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (account_key) DO UPDATE SET
       api_quota_state = EXCLUDED.api_quota_state,
       updated_at = now()`,
    [ak, payload],
  )
}

function minuteKey(accountKey, bucket) {
  return `${String(accountKey).trim()}:${bucket}`
}

/**
 * @param {string} accountKey
 * @param {ApiBucket} bucket
 */
function tryAcquireMinuteSlot(accountKey, bucket) {
  const ak = String(accountKey || '').trim()
  if (!ak) return true
  const maxPm = defaultPerMinuteLimit(bucket)
  if (maxPm <= 0) return true
  const k = minuteKey(ak, bucket)
  const now = Date.now()
  const start = now - 60_000
  let arr = minuteBuckets.get(k) || []
  arr = arr.filter((t) => t > start)
  if (arr.length >= maxPm) return false
  arr.push(now)
  minuteBuckets.set(k, arr)
  return true
}

/**
 * Effective daily limit (override clamped to MAX_LIMIT_DAY).
 * @param {ApiBucket} bucket
 * @param {Record<string, number>} limitOverrides
 */
function effectiveDailyLimit(bucket, limitOverrides) {
  const def = defaultDailyLimit(bucket)
  const raw = limitOverrides[bucket]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return def
  const n = Math.floor(raw)
  if (n < 1) return 1
  return Math.min(MAX_LIMIT_DAY, n)
}

/**
 * Throw if this call would exceed daily cap (based on current count) or minute rate.
 * @param {string} accountKey
 * @param {ApiBucket} bucket
 */
export async function assertApiAllowed(accountKey, bucket) {
  const ak = String(accountKey || '').trim()
  if (!ak) return
  if (!API_BUCKETS.includes(bucket)) return

  if (!tryAcquireMinuteSlot(ak, bucket)) {
    throw new ApiQuotaError(
      bucket,
      `${BUCKET_LABELS[bucket] || bucket}: rate limit (${defaultPerMinuteLimit(bucket)} calls/min). Try again shortly.`,
      'rate',
    )
  }

  const st = await loadQuotaState(ak)
  const limit = effectiveDailyLimit(bucket, st.limitOverrides)
  const cur = typeof st.counts[bucket] === 'number' ? st.counts[bucket] : 0
  if (cur >= limit) {
    throw new ApiQuotaError(
      bucket,
      `${BUCKET_LABELS[bucket] || bucket}: daily limit reached (${cur}/${limit} for UTC day ${st.dayKey}). Raise the cap in Settings or wait until tomorrow.`,
      'daily',
    )
  }
}

/**
 * Increment daily counter after a completed outbound request.
 * @param {string} accountKey
 * @param {ApiBucket} bucket
 */
export async function recordApiCompletedCall(accountKey, bucket) {
  const ak = String(accountKey || '').trim()
  if (!ak || !API_BUCKETS.includes(bucket)) return
  const st = await loadQuotaState(ak)
  const cur = typeof st.counts[bucket] === 'number' ? st.counts[bucket] : 0
  st.counts[bucket] = cur + 1
  st.dayKey = utcDayKey()
  await saveQuotaState(ak, st)
}

/**
 * Snapshot for Settings UI.
 * @param {string} accountKey
 */
export async function getApiQuotaSnapshot(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) {
    return {
      ok: false,
      error: 'Not signed in',
      dayKey: utcDayKey(),
      buckets: [],
    }
  }
  const st = await loadQuotaState(ak)
  const buckets = API_BUCKETS.map((id) => {
    const count = typeof st.counts[id] === 'number' ? st.counts[id] : 0
    const limit = effectiveDailyLimit(id, st.limitOverrides)
    const perMinute = Math.min(MAX_PER_MINUTE, defaultPerMinuteLimit(id))
    const mk = minuteKey(ak, id)
    const now = Date.now()
    const arr = (minuteBuckets.get(mk) || []).filter((t) => t > now - 60_000)
    return {
      id,
      label: BUCKET_LABELS[id] || id,
      countToday: count,
      limitDay: limit,
      defaultLimitDay: defaultDailyLimit(id),
      perMinuteLimit: perMinute,
      callsLastMinute: arr.length,
    }
  })
  return { ok: true, dayKey: st.dayKey, buckets }
}

/**
 * Merge limit overrides (validated). Does not reset counts.
 * @param {string} accountKey
 * @param {Record<string, unknown>} limits
 */
export async function setApiQuotaLimitOverrides(accountKey, limits) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const st = await loadQuotaState(ak)
  const next = { ...st.limitOverrides }
  if (limits && typeof limits === 'object' && !Array.isArray(limits)) {
    for (const id of API_BUCKETS) {
      if (!(id in limits)) continue
      const v = limits[id]
      if (v === null || v === '') {
        delete next[id]
        continue
      }
      const n = Math.floor(Number(v))
      if (!Number.isFinite(n) || n < 1) continue
      next[id] = Math.min(MAX_LIMIT_DAY, n)
    }
  }
  st.limitOverrides = next
  await saveQuotaState(ak, st)
  return getApiQuotaSnapshot(ak)
}

/**
 * Reset today's counts (UTC) only.
 * @param {string} accountKey
 */
export async function resetApiQuotaDayCounts(accountKey) {
  const ak = String(accountKey || '').trim()
  if (!ak) throw new Error('account_key required')
  const st = await loadQuotaState(ak)
  st.dayKey = utcDayKey()
  st.counts = {}
  await saveQuotaState(ak, st)
  return getApiQuotaSnapshot(ak)
}
