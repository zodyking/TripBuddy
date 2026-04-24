import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_DIR } from './config.mjs'
import { requirePostgresOrThrow, pgSetJson, pgGetJson } from './kv-pg.mjs'
import { G, keyForUser } from './scope-kv.mjs'
import { accountKeyForUsername } from './account-identity.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_LOCAL = path.join(__dirname, '.local')

const LEGACY_ASSIGN = path.join(LOCAL_DIR, 'assignment.json')
const LEGACY_CRED = path.join(LOCAL_DIR, 'credentials.json')
const LEGACY_DIR = path.join(LOCAL_DIR, 'locations-directory.json')
const LEGACY_GF = path.join(LOCAL_DIR, 'geo-fence.json')
const LEGACY_ACCESS = path.join(LOCAL_DIR, 'access-log.json')
const LEGACY_ACCESS_DEV = path.join(SERVER_LOCAL, 'access-log.json')
const LEGACY_AUTO = path.join(LOCAL_DIR, 'automations.json')
const LEGACY_FLOW = path.join(LOCAL_DIR, 'flow-scripts.json')
const LEGACY_CHECKIN = path.join(LOCAL_DIR, 'check-in-flow.json')
const USERS = path.join(LOCAL_DIR, 'users')

/** Pre-namespaced `fedextool_kv` keys from an older deployment */
const LEGACY_KV = {
  geofence: 'geofence:config',
  directory: 'directory:locations',
  assignmentGlobal: 'assignment:global',
  credsLegacy: 'creds:legacy',
  usermetaLegacy: 'usermeta:legacy',
  automations: 'automations:store',
  flow: 'flow:scripts',
  checkin: 'checkin:flow',
}

/**
 * @param {string} f
 */
async function readJsonFile(f) {
  try {
    return JSON.parse(await fs.readFile(f, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {string} k
 * @param {unknown} v
 * @returns {Promise<boolean>} true if written
 */
async function ensureKeyIfEmpty(k, v) {
  const cur = await pgGetJson(k)
  if (cur != null) return false
  await pgSetJson(k, v)
  return true
}

/**
 * @param {string} k
 * @param {unknown} value
 */
async function ensureKey(k, value) {
  const cur = await pgGetJson(k)
  if (cur != null) return
  await pgSetJson(k, value)
}

/**
 * One-time: import legacy on-disk JSON and old flat `fedextool_kv` keys.
 */
export async function runDataMigrationOnStartup() {
  await requirePostgresOrThrow()

  // --- Files in FEDEX_TOOL_DATA_DIR (or project .local) ---
  const dir = await readJsonFile(LEGACY_DIR)
  if (dir && typeof dir === 'object' && !Array.isArray(dir)) {
    await ensureKey(G('directory:locations'), dir)
  }
  const gf = await readJsonFile(LEGACY_GF)
  if (gf && typeof gf === 'object' && !Array.isArray(gf)) {
    await ensureKey(G('geofence:config'), {
      enabled: Boolean(gf.enabled),
      redirectUrl: typeof gf.redirectUrl === 'string' ? gf.redirectUrl : '',
      polygon: Array.isArray(gf.polygon) ? gf.polygon : [],
    })
  }
  {
    const merged = { entries: [] }
    const byId = new Set()
    for (const f of [LEGACY_ACCESS, LEGACY_ACCESS_DEV]) {
      const log = await readJsonFile(f)
      if (
        log &&
        typeof log === 'object' &&
        Array.isArray(/** @type {any} */ (log).entries)
      ) {
        for (const e of /** @type {any} */ (log).entries) {
          if (e && e.id && !byId.has(e.id)) {
            byId.add(e.id)
            /** @type {any} */ (merged).entries.push(e)
          }
        }
      }
    }
    if (/** @type {any} */ (merged).entries.length) {
      await ensureKeyIfEmpty(G('access:log:unscoped-legacy'), merged)
    }
  }
  const oldFlatLog = await pgGetJson('access:log')
  if (
    oldFlatLog &&
    typeof oldFlatLog === 'object' &&
    Array.isArray(/** @type {any} */ (oldFlatLog).entries)
  ) {
    await ensureKeyIfEmpty(G('access:log:unscoped-legacy'), oldFlatLog)
  }

  const credRoot = await readJsonFile(LEGACY_CRED)
  const rootUsername =
    credRoot && typeof credRoot.username === 'string' ? credRoot.username.trim() : ''
  const rootAccount = rootUsername ? accountKeyForUsername(rootUsername) : 'single_user'

  const globalAssign = await readJsonFile(LEGACY_ASSIGN)
  if (globalAssign && typeof globalAssign === 'object' && rootAccount) {
    await ensureKey(keyForUser(rootAccount, 'assignment'), globalAssign)
  }
  if (credRoot && typeof credRoot === 'object' && rootAccount) {
    await ensureKey(keyForUser(rootAccount, 'credentials'), credRoot)
  }
  const rootMeta = await readJsonFile(path.join(LOCAL_DIR, 'user-meta.json'))
  if (rootMeta && typeof rootMeta === 'object' && rootAccount) {
    await ensureKey(keyForUser(rootAccount, 'usermeta'), rootMeta)
  }

  let singleAccountHint = rootAccount
  // --- per-account directories ---
  let userDirs = []
  try {
    const entries = await fs.readdir(USERS, { withFileTypes: true })
    userDirs = entries.filter((d) => d.isDirectory() && d.name.length >= 32)
  } catch {
    /* no users dir */
  }
  for (const d of userDirs) {
    const accountKey = d.name
    const udir = path.join(USERS, accountKey)
    const assign = await readJsonFile(path.join(udir, 'assignment.json'))
    if (assign && typeof assign === 'object') {
      await ensureKey(keyForUser(accountKey, 'assignment'), assign)
    }
    const cred = await readJsonFile(path.join(udir, 'credentials.json'))
    if (cred && typeof cred === 'object') {
      await ensureKey(keyForUser(accountKey, 'credentials'), cred)
    }
    const meta = await readJsonFile(path.join(udir, 'user-meta.json'))
    if (meta && typeof meta === 'object') {
      await ensureKey(keyForUser(accountKey, 'usermeta'), meta)
    }
  }
  if (userDirs.length === 1) {
    singleAccountHint = userDirs[0].name
  }

  const auto = await readJsonFile(LEGACY_AUTO)
  const flow = await readJsonFile(LEGACY_FLOW)
  const checkin = await readJsonFile(LEGACY_CHECKIN)
  if (auto && typeof auto === 'object' && singleAccountHint) {
    await ensureKey(keyForUser(singleAccountHint, 'automations'), auto)
  }
  if (flow && typeof flow === 'object' && singleAccountHint) {
    await ensureKey(keyForUser(singleAccountHint, 'flow:scripts'), flow)
  }
  if (checkin && typeof checkin === 'object' && singleAccountHint) {
    await ensureKey(keyForUser(singleAccountHint, 'checkin:flow'), checkin)
  }

  // --- Re-key older PostgreSQL document keys into `g:` and `u:` names ---
  const gGeo = await pgGetJson(LEGACY_KV.geofence)
  if (gGeo && typeof gGeo === 'object') {
    await ensureKey(G('geofence:config'), gGeo)
  }
  const gDir = await pgGetJson(LEGACY_KV.directory)
  if (gDir && typeof gDir === 'object' && !Array.isArray(gDir)) {
    await ensureKey(G('directory:locations'), gDir)
  }
  for (const d of userDirs) {
    const accountKey = d.name
    const aOld = await pgGetJson(`assignment:${accountKey}`)
    if (aOld && typeof aOld === 'object') {
      await ensureKey(keyForUser(accountKey, 'assignment'), aOld)
    }
    const cOld = await pgGetJson(`creds:${accountKey}`)
    if (cOld && typeof cOld === 'object') {
      await ensureKey(keyForUser(accountKey, 'credentials'), cOld)
    }
    const mOld = await pgGetJson(`usermeta:${accountKey}`)
    if (mOld && typeof mOld === 'object') {
      await ensureKey(keyForUser(accountKey, 'usermeta'), mOld)
    }
  }
  const aGlob = await pgGetJson(LEGACY_KV.assignmentGlobal)
  if (aGlob && typeof aGlob === 'object' && rootAccount) {
    await ensureKey(keyForUser(rootAccount, 'assignment'), aGlob)
  }
  const cLeg = await pgGetJson(LEGACY_KV.credsLegacy)
  if (cLeg && typeof cLeg === 'object' && rootAccount) {
    await ensureKey(keyForUser(rootAccount, 'credentials'), cLeg)
  }
  const mLeg = await pgGetJson(LEGACY_KV.usermetaLegacy)
  if (mLeg && typeof mLeg === 'object' && rootAccount) {
    await ensureKey(keyForUser(rootAccount, 'usermeta'), mLeg)
  }
  const aStore = await pgGetJson(LEGACY_KV.automations)
  if (aStore && typeof aStore === 'object' && singleAccountHint) {
    await ensureKey(keyForUser(singleAccountHint, 'automations'), aStore)
  }
  const fStore = await pgGetJson(LEGACY_KV.flow)
  if (fStore && typeof fStore === 'object' && singleAccountHint) {
    await ensureKey(keyForUser(singleAccountHint, 'flow:scripts'), fStore)
  }
  const cStore = await pgGetJson(LEGACY_KV.checkin)
  if (cStore && typeof cStore === 'object' && singleAccountHint) {
    await ensureKey(keyForUser(singleAccountHint, 'checkin:flow'), cStore)
  }
  for (const d of userDirs) {
    const accountKey = d.name
    const oldDolly = await pgGetJson(`dolly:registry:${accountKey}`)
    if (oldDolly && typeof oldDolly === 'object') {
      try {
        await ensureKey(
          // scope-kv: u:<accountKey>:dolly:registry
          `u:${accountKey}:dolly:registry`,
          oldDolly,
        )
      } catch {
        /* */
      }
    }
  }
}
