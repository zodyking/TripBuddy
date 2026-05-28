import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'

const MAX_ITEMS = 200

/**
 * @typedef {{ nbr: string, rating: 'none' | 'good' | 'bad', firstSeenAt: number, lastSeenAt: number, lastTripLegSeq: string | null, manual: boolean, notes: string }} DollyItem
 * @typedef {{ lastPrimaryNbr: string | null, items: Record<string, DollyItem>, updatedAt: number }} DollyRegistry
 */

function key() {
  return userScopeKey('dolly:registry')
}

/**
 * @returns {Promise<DollyRegistry>}
 */
export async function readDollyRegistry() {
  const d = await readKeyJson(key(), () => ({}))
  if (!d || typeof d !== 'object') {
    return { lastPrimaryNbr: null, items: {}, updatedAt: 0 }
  }
  const items =
    d.items && typeof d.items === 'object' && !Array.isArray(d.items)
      ? d.items
      : {}
  return {
    lastPrimaryNbr: typeof d.lastPrimaryNbr === 'string' ? d.lastPrimaryNbr : null,
    items: /** @type {Record<string, DollyItem>} */ (items),
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
  }
}

/**
 * @param {DollyRegistry} reg
 */
async function writeDollyRegistry(reg) {
  const next = {
    ...reg,
    updatedAt: Date.now(),
  }
  await writeKeyJson(key(), next)
  return next
}

const DOLL_RE = /^\d{6}$/

/**
 * @param {string} raw
 * @returns {string | null}
 */
function six(raw) {
  if (raw == null) return null
  const t = String(raw).trim().replace(/\D/g, '').slice(0, 6)
  return DOLL_RE.test(t) ? t : null
}

/**
 * Merge dolly from Linehaul trip body (updates when dispatch sends new numbers).
 * @param {unknown} tripBody
 * @param {string} [legSeq] dailyTripLegSequence
 */
export async function syncDollyFromTrip(tripBody, legSeq) {
  if (tripBody == null || typeof tripBody !== 'object' || Array.isArray(tripBody)) {
    return readDollyRegistry()
  }
  const o = /** @type {Record<string, unknown>} */ (tripBody)
  const n1 = six(o.dollyNumber1)
  const n2 = six(o.dollyNumber2)
  const primary = n1 || n2
  if (!primary) {
    return readDollyRegistry()
  }

  const reg = await readDollyRegistry()
  const now = Date.now()
  const items = { ...reg.items }
  for (const n of [n1, n2].filter(Boolean)) {
    const ex = items[n] || {
      nbr: n,
      rating: 'none',
      firstSeenAt: now,
      lastSeenAt: now,
      lastTripLegSeq: legSeq && /^\d+$/.test(legSeq) ? legSeq : null,
      manual: false,
      notes: '',
    }
    ex.lastSeenAt = now
    ex.lastTripLegSeq = legSeq && /^\d+$/.test(legSeq) ? legSeq : ex.lastTripLegSeq
    ex.nbr = n
    ex.manual = false
    if (!ex.firstSeenAt) ex.firstSeenAt = now
    if (!ex.rating) ex.rating = 'none'
    items[n] = ex
  }
  const keys = Object.keys(items)
  if (keys.length > MAX_ITEMS) {
    const sorted = keys.sort(
      (a, b) => (items[b].lastSeenAt || 0) - (items[a].lastSeenAt || 0),
    )
    for (const k of sorted.slice(MAX_ITEMS)) {
      delete items[k]
    }
  }
  return await writeDollyRegistry({
    lastPrimaryNbr: primary,
    items,
  })
}

/**
 * @param {string} n
 * @param {{ legSeq?: string, manual?: boolean }} [opt]
 */
export async function addOrTouchDolly(n, opt = {}) {
  const sixD = six(n)
  if (!sixD) throw new Error('Dolly number must be 6 digits')
  const reg = await readDollyRegistry()
  const now = Date.now()
  const prev = reg.items[sixD]
  const item = {
    nbr: sixD,
    rating: prev?.rating && prev.rating !== 'none' ? prev.rating : 'none',
    firstSeenAt: prev?.firstSeenAt || now,
    lastSeenAt: now,
    lastTripLegSeq:
      opt.legSeq && /^\d+$/.test(String(opt.legSeq))
        ? String(opt.legSeq)
        : prev?.lastTripLegSeq ?? null,
    manual: opt.manual === true || prev?.manual === true,
    notes: prev?.notes || '',
  }
  const items = { ...reg.items, [sixD]: item }
  return writeDollyRegistry({ ...reg, lastPrimaryNbr: sixD, items })
}

/**
 * @param {string} n
 * @param {'none' | 'good' | 'bad'} rating
 */
export async function setDollyRating(n, rating) {
  if (!['none', 'good', 'bad'].includes(rating)) {
    throw new Error('Invalid rating')
  }
  const sixD = six(n)
  if (!sixD) throw new Error('Dolly number must be 6 digits')
  const reg = await readDollyRegistry()
  const prev = reg.items[sixD] || {
    nbr: sixD,
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    lastTripLegSeq: null,
    manual: true,
    notes: '',
  }
  const item = { ...prev, nbr: sixD, rating }
  if (!item.firstSeenAt) item.firstSeenAt = Date.now()
  const items = { ...reg.items, [sixD]: item }
  return writeDollyRegistry({ ...reg, items })
}

/**
 * Remove a dolly from the user registry (clears lastPrimary when it matches).
 * @param {string} n
 */
export async function removeDollyFromRegistry(n) {
  const sixD = six(n)
  if (!sixD) throw new Error('Dolly number must be 6 digits')
  const reg = await readDollyRegistry()
  if (!reg.items[sixD]) {
    if (reg.lastPrimaryNbr === sixD) {
      return writeDollyRegistry({ ...reg, lastPrimaryNbr: null })
    }
    return reg
  }
  const items = { ...reg.items }
  delete items[sixD]
  let lastPrimaryNbr = reg.lastPrimaryNbr
  if (lastPrimaryNbr === sixD) {
    lastPrimaryNbr = null
    const remaining = Object.keys(items).sort(
      (a, b) => (items[b].lastSeenAt || 0) - (items[a].lastSeenAt || 0),
    )
    if (remaining.length) lastPrimaryNbr = remaining[0]
  }
  return writeDollyRegistry({ ...reg, lastPrimaryNbr, items })
}
