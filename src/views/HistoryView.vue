<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, Teleport } from 'vue'
import { getAssignment, getCredentials, patchTripHistoryOutcome } from '../api.js'
import { monthGridForCalendarMonth, workWeekGroupMeta } from '../utils/workWeekGroup.js'
import { shiftDateKeyForEventMs } from '../utils/shiftCalendar.js'

/**
 * @typedef {object} LedgerEntry
 * @property {string} id
 * @property {string} [source]
 * @property {number} displayDate (Linehaul: first-saved/dispatch time from recordedAt; complete: completedAt)
 * @property {number} completedAt
 * @property {string} dailyTripLegSequence
 * @property {string} [outcome]
 * @property {Record<string, unknown>} dispatchHeader
 * @property {Record<string, unknown>} tripDetails
 */

const workWeekFromCred = ref({
  workWeekStartDay: 0,
  workWeekEndDay: 6,
  shiftStartMins: 0,
  shiftEndMins: 1439,
})

const loading = ref(true)
const error = ref('')
/** @type {import('vue').Ref<LedgerEntry[]>} */
const entries = ref([])

/** Viewed calendar month (prev/next, no year cap). */
const viewYear = ref(/** @type {number} */(new Date().getFullYear()))
const viewMonth0 = ref(/** @type {number} */(new Date().getMonth()))
const DOUBLE_CLICK_MS = 500

/** YYYY-MM-DD; empty = show all days in the month / full weeks */
const filterDayKey = ref('')
/** First load: open calendar on month of most recent trip (not "today" filter). */
const calendarMonthInitDone = ref(false)
const outcomeMenuOpen = ref('')
const outcomeMenuPos = ref(/** @type {null | { top: number, left: number, minWidth: number }} */ (null))
const outcomeRowForMenu = ref(/** @type {null | LedgerEntry} */ (null))

const outcomeMenuOpts = [
  { k: 'none', t: 'None' },
  { k: 'delivered', t: 'Delivered' },
  { k: 'rejected', t: 'Rejected' },
  { k: 'removed', t: 'Removed' },
]

/**
 * @param {unknown} x
 */
function normalizeOutcome(x) {
  if (x == null) return ''
  const t = String(x).trim().toLowerCase()
  if (t === 'delivered' || t === 'rejected' || t === 'removed' || t === 'none') return t
  return ''
}

/**
 * Paid mileage from Linehaul `viewTripInfoDetails` (stored under tripDetails.mileage).
 * @param {LedgerEntry} e
 */
function mileageBlock(e) {
  const m = e?.tripDetails?.mileage
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  const mo = /** @type {Record<string, unknown>} */ (m)
  const total = typeof mo.totalMiles === 'string' ? mo.totalMiles.trim() : ''
  const run =
    typeof mo.runTimeHours === 'number' && Number.isFinite(mo.runTimeHours)
      ? mo.runTimeHours
      : null
  const dl = Array.isArray(mo.directionList) ? mo.directionList : []
  if (!total && !dl.length && run == null) return null
  return { total, run, directionList: dl }
}

/**
 * @param {unknown} row
 */
function stateMilesLabel(row) {
  if (!row || typeof row !== 'object') return ''
  const o = /** @type {Record<string, unknown>} */ (row)
  const st = o.state != null ? String(o.state) : ''
  const mp = o.mileagePerState
  const mi =
    typeof mp === 'number' && Number.isFinite(mp)
      ? String(mp)
      : mp != null
        ? String(mp)
        : ''
  if (!st && !mi) return ''
  if (!mi) return st
  if (!st) return `${mi} mi`
  return `${st}: ${mi} mi`
}

/**
 * @param {LedgerEntry} e
 * @returns {number | null}
 */
function tripPaidMiles(e) {
  const mb = mileageBlock(e)
  if (!mb?.total) return null
  const n = parseFloat(String(mb.total).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/**
 * @param {number} n
 */
function formatMilesSum(n) {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * @param {string} shiftDayKey YYYY-MM-DD
 */
function formatShiftDayHeading(shiftDayKey) {
  const parts = shiftDayKey.split('-').map((x) => parseInt(x, 10))
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return shiftDayKey
  const [y, mo, d] = parts
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0)
  if (isNaN(dt.getTime())) return shiftDayKey
  return dt.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * One-line mileage for headers (paid mi).
 * @param {number} sum
 * @param {number} withMi
 * @param {number} totalTrips
 */
function mileageHeaderLine(sum, withMi, totalTrips) {
  const s = Number.isFinite(sum) ? sum : 0
  return `${formatMilesSum(s)} mi · ${withMi}/${totalTrips} trips`
}

/**
 * Trip header: paid miles as plain text (0 when unknown).
 * @param {LedgerEntry} e
 */
function tripHeaderMiPlain(e) {
  const n = tripPaidMiles(e)
  const mi = n != null ? formatMilesSum(n) : '0'
  return `${mi} mi`
}

/**
 * Trip header: run time when known (plain text, no pill).
 * @param {LedgerEntry} e
 */
function tripHeaderRunPlain(e) {
  const mb = mileageBlock(e)
  if (mb?.run == null) return null
  return `~${mb.run} h`
}

/**
 * Hide dolly dl rows with empty / placeholder values.
 * @param {unknown} rows
 */
function filterDollyRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false
    const v = /** @type {{ value?: unknown }} */ (row).value
    const s = v == null ? '' : String(v).trim()
    if (!s) return false
    if (s === '—' || s === '-' || s === '–') return false
    return true
  })
}

/** Paid miles in [PAY_ROUND_BAND_MIN, PAY_ROUND_BAND_MAX] count as {@link PAY_ROUND_TO_MI} mi for pay estimate. */
const PAY_ROUND_BAND_MIN = 34
const PAY_ROUND_BAND_MAX = 50
const PAY_ROUND_TO_MI = 50

/**
 * Billable miles for the pay estimate ($1 / mi rule).
 * Only 34–50 mi paid bands up to 50; below 34 unchanged; above 50 unchanged.
 * @param {number} paidMi
 */
function billableMilesForPayEstimate(paidMi) {
  if (!Number.isFinite(paidMi)) return 0
  if (paidMi >= PAY_ROUND_BAND_MIN && paidMi <= PAY_ROUND_BAND_MAX) return PAY_ROUND_TO_MI
  return paidMi
}

/**
 * Leading numeric location id from dispatch labels like "84 · LINDEN".
 * @param {unknown} v
 */
function leadingLocationId(v) {
  const s = String(str(v) || '').trim()
  const m = s.match(/^\s*(\d+)/)
  return m ? m[1] : ''
}

/**
 * Origin → destination using location ids only (for pay breakdown rows).
 * @param {LedgerEntry} e
 */
function tripOdIdsOnly(e) {
  const o = leadingLocationId(e.dispatchHeader?.origin)
  const d = leadingLocationId(e.dispatchHeader?.destination)
  return `${o || '—'} → ${d || '—'}`
}

/**
 * Dispatched time plus trip leg when present (pay breakdown detail lines).
 * @param {LedgerEntry} e
 */
function tripPayWhenWithLeg(e) {
  const when = formatWhen(e.displayDate)
  const seq = String(e.dailyTripLegSequence || '').trim()
  if (/^\d+$/.test(seq)) return `${when} · Leg #${seq}`
  return when
}

/**
 * @param {LedgerEntry[]} items
 */
function computeWeekPayEstimate(items) {
  const sorted = [...items].sort((a, b) => b.displayDate - a.displayDate)
  let sumBillable = 0
  /** @type {{ id: string, od: string, when: string, paidMi: number | null, billableMi: number, rounded: boolean }[]} */
  const rows = []
  for (const e of sorted) {
    const paidMi = tripPaidMiles(e)
    const base = paidMi ?? 0
    const billableMi = billableMilesForPayEstimate(base)
    sumBillable += billableMi
    rows.push({
      id: e.id,
      od: tripOdIdsOnly(e),
      when: tripPayWhenWithLeg(e),
      paidMi,
      billableMi,
      rounded: base >= PAY_ROUND_BAND_MIN && base <= PAY_ROUND_BAND_MAX,
    })
  }
  return {
    rows,
    sumBillable,
    estimateUsd: sumBillable,
  }
}

/**
 * @param {number} n
 */
function formatUsdWhole(n) {
  if (!Number.isFinite(n)) return '$0'
  const r = Math.round(n)
  return `$${r.toLocaleString(undefined)}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const c = await getCredentials()
    const ws = typeof c.workWeekStartDay === 'number' ? c.workWeekStartDay : 0
    const we = typeof c.workWeekEndDay === 'number' ? c.workWeekEndDay : 6
    const ssm =
      typeof c.shiftStartMins === 'number' && !Number.isNaN(c.shiftStartMins)
        ? Math.max(0, Math.min(1439, Math.floor(c.shiftStartMins)))
        : 0
    const sem =
      typeof c.shiftEndMins === 'number' && !Number.isNaN(c.shiftEndMins)
        ? Math.max(0, Math.min(1439, Math.floor(c.shiftEndMins)))
        : 1439
    workWeekFromCred.value = {
      workWeekStartDay: Math.min(6, Math.max(0, Math.floor(ws))),
      workWeekEndDay: Math.min(6, Math.max(0, Math.floor(we))),
      shiftStartMins: ssm,
      shiftEndMins: sem,
    }
  } catch {
    /* use defaults */
  }
  try {
    const a = await getAssignment()
    const raw = a?.tripHistoryLedger
    if (!Array.isArray(raw)) {
      entries.value = []
    } else {
      /** @type {Map<string, LedgerEntry>} */
      const byLeg = new Map()
      for (const x of raw) {
        if (!x || typeof x !== 'object') continue
        const comp =
          typeof x.completedAt === 'number' && Number.isFinite(x.completedAt)
            ? x.completedAt
            : 0
        const rec =
          typeof x.recordedAt === 'number' && Number.isFinite(x.recordedAt)
            ? x.recordedAt
            : 0
        const sourceStr = typeof x.source === 'string' ? x.source : 'complete'
        const displayDate =
          sourceStr === 'linehaul' && rec > 0
            ? rec
            : comp > 0
              ? comp
              : rec > 0
                ? rec
                : 0
        const seq = String(x.dailyTripLegSequence ?? '').trim()
        const legKey = /^\d+$/.test(seq) ? seq : ''
        const oRaw = /** @type {any} */ (x)
        const rawO =
          typeof oRaw.outcome === 'string' && oRaw.outcome
            ? normalizeOutcome(oRaw.outcome)
            : typeof oRaw.dispatchHeader === 'object' && oRaw.dispatchHeader
              ? normalizeOutcome(/** @type {any} */ (oRaw.dispatchHeader).historyOutcome)
              : ''
        const o = rawO || 'delivered'
        const e = {
          id: String(x.id ?? ''),
          source: sourceStr,
          displayDate,
          completedAt: comp,
          dailyTripLegSequence: seq,
          outcome: o,
          dispatchHeader:
            x.dispatchHeader && typeof x.dispatchHeader === 'object'
              ? /** @type {Record<string, unknown>} */ (x.dispatchHeader)
              : {},
          tripDetails:
            x.tripDetails && typeof x.tripDetails === 'object'
              ? /** @type {Record<string, unknown>} */ (x.tripDetails)
              : {},
        }
        if (!e.id) continue
        if (!legKey) {
          byLeg.set(e.id, e)
          continue
        }
        const cur = byLeg.get(legKey)
        if (!cur) {
          byLeg.set(legKey, e)
        } else {
          const tNew = e.displayDate
          const tCur = cur.displayDate
          const tN = typeof tNew === 'number' && tNew > 0 ? tNew : Infinity
          const tC = typeof tCur === 'number' && tCur > 0 ? tCur : Infinity
          if (tN < tC) byLeg.set(legKey, e)
        }
      }
      entries.value = /** @type {LedgerEntry[]} */ (
        Array.from(byLeg.values()).filter((e) => e && e.id)
      )
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    entries.value = []
  } finally {
    if (!calendarMonthInitDone.value) {
      const list = entries.value.filter(
        (e) => typeof e.displayDate === 'number' && e.displayDate > 0,
      )
      if (list.length > 0) {
        let best = list[0].displayDate
        for (let i = 1; i < list.length; i += 1) {
          const t = list[i].displayDate
          if (typeof t === 'number' && t > best) best = t
        }
        const { y, m0 } = monthKeyFromMs(best)
        viewYear.value = y
        viewMonth0.value = m0
      }
      calendarMonthInitDone.value = true
    }
    loading.value = false
  }
}

const sorted = computed(() =>
  [...entries.value]
    .filter(
      (e) => typeof e.displayDate === 'number' && e.displayDate > 0,
    )
    .sort((a, b) => b.displayDate - a.displayDate),
)

/**
 * @param {number} y
 * @param {number} m0
 */
function monthKey(y, m0) {
  return `${y}-${String(m0 + 1).padStart(2, '0')}`
}

/**
 * @param {number} tMs
 */
function monthKeyFromMs(tMs) {
  const d = new Date(tMs)
  if (isNaN(d.getTime())) return { y: 1970, m0: 0, key: '1970-01' }
  const y = d.getFullYear()
  const m0 = d.getMonth()
  return { y, m0, key: monthKey(y, m0) }
}

function prevMonthFrom(y, m0) {
  if (m0 <= 0) return { y: y - 1, m0: 11 }
  return { y, m0: m0 - 1 }
}

function nextMonthFrom(y, m0) {
  if (m0 >= 11) return { y: y + 1, m0: 0 }
  return { y, m0: m0 + 1 }
}

const monthByKey = computed(() => {
  const list = sorted.value
  const m = new Map()
  for (const e of list) {
    const t = e.displayDate
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) {
      if (!m.has('unknown')) {
        m.set('unknown', { key: 'unknown', y: 0, m0: 0, groupLabel: 'No date', items: [] })
      }
      m.get('unknown').items.push(e)
      continue
    }
    const { y, m0, key } = monthKeyFromMs(t)
    if (!m.has(key)) {
      const d0 = new Date(y, m0, 1, 12, 0, 0, 0)
      const groupLabel = d0.toLocaleString('en-US', { month: 'long', year: 'numeric' })
      m.set(key, { key, y, m0, groupLabel, items: [] })
    }
    m.get(key).items.push(e)
  }
  for (const g of m.values()) {
    g.items.sort((a, b) => b.displayDate - a.displayDate)
  }
  return m
})

const viewMonthInfo = computed(() => {
  const y = viewYear.value
  const m0 = viewMonth0.value
  const k = monthKey(y, m0)
  const g = monthByKey.value.get(k)
  const d0 = new Date(y, m0, 1, 12, 0, 0, 0)
  const longTitle = d0.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  return {
    key: k,
    y,
    m0,
    groupLabel: longTitle,
    weekStartMs: d0.getTime(),
    items: g?.items && Array.isArray(g.items) ? g.items : [],
  }
})

const weekFilteredItems = computed(() => {
  const w = viewMonthInfo.value
  if (!filterDayKey.value) return w.items
  return w.items.filter((e) => {
    if (!e.displayDate) return false
    const t = /** @type {number} */(e.displayDate)
    const k2 = shiftDateKeyForEventMs(
      t,
      workWeekFromCred.value.shiftStartMins,
      workWeekFromCred.value.shiftEndMins,
    )
    return k2 === filterDayKey.value
  })
})

/**
 * @typedef {{
 *   shiftDayKey: string,
 *   dayLabel: string,
 *   items: LedgerEntry[],
 *   tripCount: number,
 *   tripsWithMileage: number,
 *   mileageSum: number,
 * }} HistoryDayGroup
 */

/**
 * @typedef {{
 *   key: string,
 *   groupLabel: string,
 *   weekStartMs: number,
 *   items: LedgerEntry[],
 *   tripCount: number,
 *   tripsWithMileage: number,
 *   mileageSum: number,
 *   days: HistoryDayGroup[],
 * }} HistoryWeekGroup
 */

/** Month list grouped by configured work week → shift days; newest week first. */
const tripsByWorkWeek = computed(() => {
  /** @type {HistoryWeekGroup[]} */
  const out = []
  const items = weekFilteredItems.value
  if (!items.length) return out

  const wwOpts = {
    workWeekStartDay: workWeekFromCred.value.workWeekStartDay,
    workWeekEndDay: workWeekFromCred.value.workWeekEndDay,
    shiftStartMins: workWeekFromCred.value.shiftStartMins,
    shiftEndMins: workWeekFromCred.value.shiftEndMins,
  }

  /** @type {Map<string, { meta: NonNullable<ReturnType<typeof workWeekGroupMeta>>, items: LedgerEntry[] }>} */
  const map = new Map()
  for (const e of items) {
    const t = e.displayDate
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue
    const meta = workWeekGroupMeta(t, wwOpts)
    if (!meta) continue
    let g = map.get(meta.key)
    if (!g) {
      g = { meta, items: [] }
      map.set(meta.key, g)
    }
    g.items.push(e)
  }

  for (const g of map.values()) {
    g.items.sort((a, b) => b.displayDate - a.displayDate)
  }

  const ordered = Array.from(map.entries()).sort(
    (a, b) => b[1].meta.weekStart - a[1].meta.weekStart,
  )

  for (const [key, g] of ordered) {
    /** @type {Map<string, LedgerEntry[]>} */
    const byDay = new Map()
    for (const e of g.items) {
      const t = e.displayDate
      const dk =
        typeof t === 'number' && Number.isFinite(t) && t > 0
          ? shiftDateKeyForEventMs(
              t,
              workWeekFromCred.value.shiftStartMins,
              workWeekFromCred.value.shiftEndMins,
            )
          : ''
      const dayKey = dk || '_unknown'
      const arr = byDay.get(dayKey) || []
      arr.push(e)
      byDay.set(dayKey, arr)
    }
    for (const arr of byDay.values()) {
      arr.sort((a, b) => b.displayDate - a.displayDate)
    }

    const dayKeysSorted = Array.from(byDay.keys()).sort((a, b) => {
      if (a === '_unknown') return 1
      if (b === '_unknown') return -1
      return b.localeCompare(a)
    })

    /** @type {HistoryDayGroup[]} */
    const days = []
    let mileageSum = 0
    let tripsWithMileage = 0

    for (const dk of dayKeysSorted) {
      const dayItems = byDay.get(dk) || []
      let dSum = 0
      let dWith = 0
      for (const e of dayItems) {
        const mi = tripPaidMiles(e)
        if (mi != null) {
          dSum += mi
          dWith += 1
        }
      }
      mileageSum += dSum
      tripsWithMileage += dWith
      days.push({
        shiftDayKey: dk === '_unknown' ? '' : dk,
        dayLabel:
          dk === '_unknown'
            ? 'Unknown day'
            : formatShiftDayHeading(dk),
        items: dayItems,
        tripCount: dayItems.length,
        tripsWithMileage: dWith,
        mileageSum: dSum,
      })
    }

    out.push({
      key,
      groupLabel: g.meta.groupLabel,
      weekStartMs: g.meta.weekStart,
      items: g.items,
      tripCount: g.items.length,
      tripsWithMileage,
      mileageSum,
      days,
    })
  }
  return out
})

/** Sum of paid miles for the visible month list. */
const monthPaidMilesTotal = computed(() => {
  let sum = 0
  let count = 0
  for (const w of tripsByWorkWeek.value) {
    sum += w.mileageSum
    count += w.tripsWithMileage
  }
  return { sum, count }
})

/** Per work-week pay estimate ($1 / billable mi); keyed like {@link tripsByWorkWeek}. */
const weekPayEstimateByKey = computed(() => {
  /** @type {Record<string, ReturnType<typeof computeWeekPayEstimate>>} */
  const out = {}
  for (const wg of tripsByWorkWeek.value) {
    out[wg.key] = computeWeekPayEstimate(wg.items)
  }
  return out
})

/** Per shift-day pay estimate: key `${weekKey}|${shiftDayKey || 'unk'}`. */
const dayPayEstimateByWeekDayKey = computed(() => {
  /** @type {Record<string, ReturnType<typeof computeWeekPayEstimate>>} */
  const out = {}
  for (const wg of tripsByWorkWeek.value) {
    for (const dg of wg.days) {
      const dk = dg.shiftDayKey ? String(dg.shiftDayKey) : 'unk'
      out[`${wg.key}|${dk}`] = computeWeekPayEstimate(dg.items)
    }
  }
  return out
})

/**
 * @param {string} weekKey
 * @param {string} [shiftDayKey]
 */
function dayPayEstimateFor(weekKey, shiftDayKey) {
  const dk = shiftDayKey ? String(shiftDayKey) : 'unk'
  return dayPayEstimateByWeekDayKey.value[`${String(weekKey)}|${dk}`] || { estimateUsd: 0 }
}

/** Expand week/day `<details>` when user picks a calendar shift day. */
const wwDetailsElByKey = /** @type {Record<string, HTMLDetailsElement | undefined>} */ ({})
const dayDetailsElByKey = /** @type {Record<string, HTMLDetailsElement | undefined>} */ ({})

function bindWwDetailsEl(weekKey) {
  return (/** @type {unknown} */ el) => {
    const k = String(weekKey)
    if (el instanceof HTMLDetailsElement) wwDetailsElByKey[k] = el
    else delete wwDetailsElByKey[k]
  }
}

function bindDayDetailsEl(weekKey, shiftDayKey) {
  const dk = shiftDayKey ? String(shiftDayKey) : 'unk'
  const mapKey = `${String(weekKey)}|${dk}`
  return (/** @type {unknown} */ el) => {
    if (el instanceof HTMLDetailsElement) dayDetailsElByKey[mapKey] = el
    else delete dayDetailsElByKey[mapKey]
  }
}

watch(filterDayKey, async (k) => {
  const dayKey = String(k || '').trim()
  if (!dayKey) return
  await nextTick()
  for (const wg of tripsByWorkWeek.value) {
    const dg = wg.days.find((d) => d.shiftDayKey === dayKey)
    if (!dg) continue
    const wwEl = wwDetailsElByKey[wg.key]
    const dayMapKey = `${wg.key}|${dg.shiftDayKey ? String(dg.shiftDayKey) : 'unk'}`
    const dayEl = dayDetailsElByKey[dayMapKey]
    if (wwEl) wwEl.open = true
    if (dayEl) {
      dayEl.open = true
      dayEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    break
  }
})

const viewMonthGrid = computed(() => {
  const g = viewMonthInfo.value
  if (g == null) {
    return { year: 0, monthIndex0: 0, monthLabel: '', headers: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], cells: [] }
  }
  const counts = {}
  for (const e of g.items) {
    if (!e.displayDate) continue
    const k = shiftDateKeyForEventMs(
      /** @type {number} */(e.displayDate),
      workWeekFromCred.value.shiftStartMins,
      workWeekFromCred.value.shiftEndMins,
    )
    if (!k) continue
    counts[k] = (counts[k] || 0) + 1
  }
  return monthGridForCalendarMonth(/** @type {number} */(g.y), g.m0, counts, {
    shiftStartMins: workWeekFromCred.value.shiftStartMins,
    shiftEndMins: workWeekFromCred.value.shiftEndMins,
  })
})

function goPrevViewMonth() {
  filterDayKey.value = ''
  const p = prevMonthFrom(viewYear.value, viewMonth0.value)
  viewYear.value = p.y
  viewMonth0.value = p.m0
}

function goNextViewMonth() {
  filterDayKey.value = ''
  const p = nextMonthFrom(viewYear.value, viewMonth0.value)
  viewYear.value = p.y
  viewMonth0.value = p.m0
}

function formatWhen(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function str(v) {
  if (v == null || v === '') return ''
  return String(v)
}

function sourceLabel(src) {
  if (src === 'linehaul') return 'From Linehaul'
  if (src === 'complete') return 'Marked complete'
  return 'Saved'
}

const outcomeLabel = (o) => {
  const t = str(o)
  if (t === 'delivered') return 'Delivered'
  if (t === 'rejected') return 'Rejected'
  if (t === 'removed') return 'Removed'
  if (t === 'none') return 'None'
  return ''
}

/**
 * @param {LedgerEntry} e
 * @returns {'none' | 'delivered' | 'rejected' | 'removed'}
 */
function outcomeSelectValue(e) {
  const t = (e.outcome && String(e.outcome).trim().toLowerCase()) || 'delivered'
  if (t === 'delivered' || t === 'rejected' || t === 'removed' || t === 'none') return t
  return 'delivered'
}

const historySavingId = ref('')

async function setOutcome(legSeq, o) {
  if (!/^\d+$/.test(legSeq)) return
  historySavingId.value = `seq-${legSeq}`
  try {
    await patchTripHistoryOutcome({ dailyTripLegSequence: legSeq, outcome: o })
    const idx = entries.value.findIndex((e) => e.dailyTripLegSequence === legSeq)
    if (idx >= 0) {
      const e = { ...entries.value[idx], outcome: o }
      if (e.dispatchHeader && typeof e.dispatchHeader === 'object') {
        e.dispatchHeader = { ...e.dispatchHeader, historyOutcome: o, historyOutcomeAt: Date.now() }
      } else {
        e.dispatchHeader = { historyOutcome: o, historyOutcomeAt: Date.now() }
      }
      entries.value[idx] = e
    } else {
      void load()
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    historySavingId.value = ''
  }
}

function closeOutcomeMenu() {
  outcomeMenuOpen.value = ''
  outcomeRowForMenu.value = null
  outcomeMenuPos.value = null
}

/**
 * @param {LedgerEntry} row
 * @param {string} id
 * @param {Event} [ev]
 */
function toggleOutcomeMenu(row, id, ev) {
  ev?.stopPropagation()
  if (!/^\d+$/.test(row.dailyTripLegSequence)) return
  if (outcomeMenuOpen.value === id) {
    closeOutcomeMenu()
    return
  }
  outcomeMenuOpen.value = id
  outcomeRowForMenu.value = row
  if (typeof document === 'undefined' || !ev?.currentTarget) return
  const place = () => {
    const el = /** @type {HTMLElement} */(ev.currentTarget)
    if (!el?.getBoundingClientRect) return
    const r = el.getBoundingClientRect()
    const w = 180
    let left = Math.min(
      r.left,
      (typeof window !== 'undefined' ? window.innerWidth : 400) - w - 8,
    )
    left = Math.max(8, left)
    outcomeMenuPos.value = {
      top: r.bottom + 6,
      left,
      minWidth: Math.max(140, Math.min(w, r.width)),
    }
  }
  place()
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(place)
  }
}

/**
 * @param {LedgerEntry} e
 * @param {string} o
 * @param {Event} [ev]
 */
function pickOutcomeFromMenu(e, o, ev) {
  ev?.stopPropagation()
  if (!/^\d+$/.test(e.dailyTripLegSequence)) return
  if (o === 'none' || o === 'delivered' || o === 'rejected' || o === 'removed') {
    void setOutcome(e.dailyTripLegSequence, o)
  }
  nextTick(() => {
    closeOutcomeMenu()
  })
}

let lastDblT = 0
let lastDblSeq = ''

/**
 * @param {LedgerEntry} e
 */
function onRowDoubleClick(e) {
  if (!/^\d+$/.test(e.dailyTripLegSequence)) return
  const now = Date.now()
  if (
    lastDblT &&
    now - lastDblT < DOUBLE_CLICK_MS &&
    lastDblSeq === e.dailyTripLegSequence
  ) {
    lastDblT = 0
    lastDblSeq = ''
    void cycleOutcome(e)
    return
  }
  lastDblT = now
  lastDblSeq = e.dailyTripLegSequence
}

/**
 * @param {LedgerEntry} e
 */
function cycleOutcome(e) {
  const s = e.dailyTripLegSequence
  if (!/^\d+$/.test(s)) return
  const cur = outcomeSelectValue(e)
  const next =
    cur === 'none'
      ? 'delivered'
      : cur === 'delivered'
        ? 'rejected'
        : cur === 'rejected'
          ? 'removed'
          : cur === 'removed'
            ? 'none'
            : 'none'
  void setOutcome(s, next)
}

let docClickOutcome = (/** @type {Event} */ e) => {
  const t = e.target
  if (t && typeof t === 'object' && 'closest' in /** @type {any} */ (t)) {
    if (/** @type {Element} */ (t).closest('.history-outcome-wrap')) return
    if (/** @type {Element} */ (t).closest('.history-outcome-pop-layer')) return
  }
  closeOutcomeMenu()
}

function onOutcomeMenuViewport() {
  if (outcomeMenuOpen.value) closeOutcomeMenu()
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('click', docClickOutcome, true)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', onOutcomeMenuViewport, true)
    window.addEventListener('resize', onOutcomeMenuViewport, true)
  }
  void load()
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', docClickOutcome, true)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('scroll', onOutcomeMenuViewport, true)
    window.removeEventListener('resize', onOutcomeMenuViewport, true)
  }
})
</script>

<template>
  <div class="history-view">
    <p v-if="error" class="history-err">{{ error }}</p>
    <div
      v-else
      v-show="!loading"
      class="history-content"
    >
      <p v-if="!sorted.length" class="history-empty">No trips</p>
      <div class="history-month-body">
      <div class="history-month-nav" role="group" aria-label="Month">
        <button
          type="button"
          class="history-mnav tap"
          title="Previous month"
          :disabled="loading"
          @click="goPrevViewMonth"
        >
          ←
        </button>
        <h2 class="history-month-h2">{{ viewMonthInfo.groupLabel }}</h2>
        <button
          type="button"
          class="history-mnav tap"
          title="Next month"
          :disabled="loading"
          @click="goNextViewMonth"
        >
          →
        </button>
      </div>
      <div
        v-if="viewMonthGrid.cells.length"
        class="history-cal-surface"
        :aria-label="`Month grid ${viewMonthInfo.groupLabel}`"
      >
        <div class="history-month-grid" role="grid" :aria-colcount="7" :aria-rowcount="6">
          <div class="history-month-dow" role="row" aria-label="Weekdays">
            <div
              v-for="(h, hi) in viewMonthGrid.headers"
              :key="`h-mgrid-${hi}`"
              class="history-dow"
              role="columnheader"
            >{{ h }}</div>
          </div>
          <div class="history-month-cells" role="row">
            <button
              v-for="c in viewMonthGrid.cells"
              :key="`d-${c.key}`"
              type="button"
              class="history-day-cell tap"
              :class="{
                'history-day-cell--in-ww': c.inMonth,
                'history-day-cell--on': c.inMonth && filterDayKey === c.key,
                'history-day-cell--empty': c.inMonth && !c.tripCount,
                'history-day-cell--has': c.tripCount > 0,
                'history-day-cell--today': c.isToday,
                'history-day-cell--faint': !c.inMonth,
              }"
              :title="`Trips: ${c.tripCount}`"
              :aria-pressed="c.inMonth && filterDayKey === c.key"
              :disabled="!c.inMonth"
              @click="c.inMonth && (filterDayKey = filterDayKey === c.key ? '' : c.key)"
            >
              <span class="history-day-num">{{ c.dayNum }}</span>
              <span
                v-if="c.tripCount > 0"
                class="history-day-badge"
                aria-hidden="true"
              >{{ c.tripCount > 9 ? '9+' : c.tripCount }}</span
              >
            </button>
          </div>
        </div>
        <p v-if="filterDayKey" class="history-cal-filt">
          Day <strong>{{ filterDayKey }}</strong>
          &nbsp;·&nbsp;
          <button type="button" class="history-link tap" @click="filterDayKey = ''">Show month</button>
        </p>
      </div>
      <h2 v-if="weekFilteredItems.length" class="history-trips-h2">Trips</h2>
      <p
        v-if="weekFilteredItems.length && !filterDayKey"
        class="history-month-mile-sum"
      >
        Paid miles this month ({{ monthPaidMilesTotal.count }}
        {{ monthPaidMilesTotal.count === 1 ? 'trip' : 'trips' }} with data):
        <strong>{{ formatMilesSum(monthPaidMilesTotal.sum) }} mi</strong>
      </p>
      <p v-else-if="filterDayKey && !weekFilteredItems.length" class="history-no-month">
        No trips on this shift day.
      </p>
      <p v-else-if="!weekFilteredItems.length" class="history-no-month">No trips this month</p>
      <template v-if="tripsByWorkWeek.length">
        <div class="history-hierarchy">
          <details
            v-for="wg in tripsByWorkWeek"
            :key="wg.key"
            :ref="bindWwDetailsEl(wg.key)"
            class="history-ww-section history-fold"
            :aria-label="wg.groupLabel"
          >
            <summary class="history-ww-head history-fold__summary">
              <div class="history-ww-head-row">
                <h3 class="history-ww-title">{{ wg.groupLabel }}</h3>
                <div class="history-head-metrics">
                  <span class="history-mile-pill">{{
                    mileageHeaderLine(wg.mileageSum, wg.tripsWithMileage, wg.tripCount)
                  }}</span>
                  <span class="history-pay-head-pill">{{
                    formatUsdWhole((weekPayEstimateByKey[wg.key] || { estimateUsd: 0 }).estimateUsd)
                  }}</span>
                </div>
              </div>
            </summary>

            <div class="history-day-stack">
              <details
                v-for="dg in wg.days"
                :key="`${wg.key}-${dg.shiftDayKey || 'unk'}`"
                :ref="bindDayDetailsEl(wg.key, dg.shiftDayKey)"
                class="history-day-card history-fold"
                :data-shift-day="dg.shiftDayKey || ''"
              >
                <summary class="history-day-head history-fold__summary">
                  <div class="history-day-head-row">
                    <h4 class="history-day-title">{{ dg.dayLabel }}</h4>
                    <div class="history-head-metrics">
                      <span class="history-mile-pill history-mile-pill--sm">{{
                        mileageHeaderLine(dg.mileageSum, dg.tripsWithMileage, dg.tripCount)
                      }}</span>
                      <span class="history-pay-head-pill history-pay-head-pill--sm">{{
                        formatUsdWhole(dayPayEstimateFor(wg.key, dg.shiftDayKey).estimateUsd)
                      }}</span>
                    </div>
                  </div>
                </summary>

                <ul class="history-list history-list--nested history-list--day" :aria-label="`${dg.dayLabel} trips`">
                  <li
                    v-for="e in dg.items"
                    :id="`history-card-${e.id}`"
                    :key="e.id"
                    class="history-card"
                  >
                    <details class="history-drop history-trip-fold">
                      <summary
                        class="history-card-summary history-trip-summary history-fold__summary"
                        @dblclick.stop.prevent="onRowDoubleClick(e)"
                      >
                        <div class="history-trip-head">
                          <div class="history-trip-row-a">
                            <p
                              class="history-trip-od-line"
                              :title="`${str(e.dispatchHeader?.origin) || '—'} → ${str(e.dispatchHeader?.destination) || '—'}`"
                            >
                              <span class="history-od-lab">Origin:</span>
                              <span class="history-od-id">{{ leadingLocationId(e.dispatchHeader?.origin) || '—' }}</span>
                              <span class="history-od-arrow" aria-hidden="true">→</span>
                              <span class="history-od-lab">Destination:</span>
                              <span class="history-od-id">{{ leadingLocationId(e.dispatchHeader?.destination) || '—' }}</span>
                              <span class="history-trip-od-sep" aria-hidden="true">·</span>
                              <span class="history-trip-inline-k">{{ tripHeaderMiPlain(e) }}</span>
                              <template v-if="tripHeaderRunPlain(e)">
                                <span class="history-trip-od-sep" aria-hidden="true">·</span>
                                <span class="history-trip-inline-k">{{ tripHeaderRunPlain(e) }}</span>
                              </template>
                            </p>
                            <div
                              v-if="e.dailyTripLegSequence"
                              class="history-trip-rightbar"
                            >
                              <div class="history-outcome-slot" @click.stop>
                                <div class="history-outcome-wrap" @click.stop>
                                  <button
                                    type="button"
                                    class="history-outcome-pill history-outcome-pill--trip tap"
                                    :class="`history-outcome--${outcomeSelectValue(e)}`"
                                    :disabled="historySavingId === `seq-${e.dailyTripLegSequence}`"
                                    :title="'Tap to change: ' + outcomeLabel(outcomeSelectValue(e))"
                                    :aria-expanded="outcomeMenuOpen === e.id"
                                    aria-haspopup="listbox"
                                    @click="toggleOutcomeMenu(e, e.id, $event)"
                                  >
                                    <span class="history-outcome-pill__txt">{{ outcomeLabel(outcomeSelectValue(e)) }}</span>
                                    <span class="history-outcome-pill__chev" aria-hidden="true">▾</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                          <p
                            class="history-trip-meta-strip"
                            :title="
                              e.dailyTripLegSequence
                                ? `Double-tap header: cycle status · Leg #${e.dailyTripLegSequence}`
                                : ''
                            "
                          >
                            <span class="history-trip-meta-strip__lab">{{
                              e.source === 'linehaul' ? 'Dispatched' : 'Time'
                            }}</span>
                            <span class="history-trip-meta-strip__sep" aria-hidden="true">·</span>
                            <time
                              class="history-trip-meta-strip__when"
                              :datetime="new Date(e.displayDate).toISOString()"
                              >{{ formatWhen(e.displayDate) }}</time
                            >
                            <template v-if="e.dailyTripLegSequence">
                              <span class="history-trip-meta-strip__sep" aria-hidden="true">·</span>
                              <span class="history-trip-meta-strip__leg">Leg #{{ e.dailyTripLegSequence }}</span>
                              <span class="history-trip-meta-strip__sep" aria-hidden="true">·</span>
                              <span>{{ sourceLabel((str(e.dispatchHeader?.source) || e.source) || '') }}</span>
                            </template>
                          </p>
                        </div>
                      </summary>
                    <div class="history-dispatch">
                      <p v-if="str(e.dispatchHeader?.tripStatusText)" class="history-meta">
                        Status: {{ str(e.dispatchHeader.tripStatusText) }}
                      </p>
                      <p v-if="str(e.dispatchHeader?.instructions)" class="history-instr">
                        {{ str(e.dispatchHeader.instructions) }}
                      </p>
                    </div>
                    <div class="history-body">
                      <template v-for="mb in [mileageBlock(e)]" :key="e.id + '-mileage'">
                        <div class="history-mileage">
                          <div class="history-mileage-top">
                            <span class="history-body-label history-body-label--inline">Paid mileage</span>
                            <p class="history-mileage-vals">
                              <span class="history-mileage-mi">
                                <template v-if="mb && mb.total">{{ mb.total }} mi</template>
                                <template v-else>0 mi</template>
                              </span>
                              <template v-if="mb && mb.run != null">
                                <span class="history-mile-stat-sep" aria-hidden="true">·</span>
                                <span class="history-mile-run">~{{ mb.run }} h run</span>
                              </template>
                            </p>
                          </div>
                          <ul
                            v-if="mb && mb.directionList && mb.directionList.length"
                            class="history-mileage-by-state"
                          >
                            <li v-for="(row, mi) in mb.directionList" :key="mi">
                              {{ stateMilesLabel(row) }}
                            </li>
                          </ul>
                        </div>
                      </template>
                      <p
                        v-if="str(e.tripDetails?.tripStatus) || str(e.tripDetails?.tractorNumber)"
                        class="history-trip-meta"
                      >
                        <template v-if="str(e.tripDetails?.tripStatus)">
                          Trip status: {{ str(e.tripDetails.tripStatus) }}
                        </template>
                        <template v-if="str(e.tripDetails?.tractorNumber)">
                          <span v-if="str(e.tripDetails?.tripStatus)"> · </span>
                          Tractor {{ str(e.tripDetails.tractorNumber) }}
                        </template>
                      </p>
                      <div
                        v-if="
                          e.tripDetails?.dolly &&
                          Array.isArray(e.tripDetails.dolly.rows) &&
                          filterDollyRows(e.tripDetails.dolly.rows).length
                        "
                        class="history-dolly"
                      >
                        <span class="history-body-label">Dolly</span>
                        <dl class="history-mini-dl">
                          <template v-for="(row, idx) in filterDollyRows(e.tripDetails.dolly.rows)" :key="idx">
                            <dt>{{ row.label }}</dt>
                            <dd>{{ row.value }}</dd>
                          </template>
                        </dl>
                      </div>
                      <div
                        v-if="Array.isArray(e.tripDetails?.trailers) && e.tripDetails.trailers.length"
                        class="history-trailers"
                      >
                        <div
                          v-for="(t, ti) in e.tripDetails.trailers"
                          :key="ti"
                          class="history-trailer-block"
                        >
                          <div class="history-trailer-line">
                            <span class="history-trailer-title">Trailer {{ t.order }}</span>
                            <span v-if="t.trlrNbr" class="history-trailer-nbr">#{{ t.trlrNbr }}</span>
                            <span class="history-badge">{{ t.size }}</span>
                            <span class="history-badge history-badge--load">{{ t.loadType }}</span>
                          </div>
                          <ul
                            v-if="Array.isArray(t.summaryRows) && t.summaryRows.length"
                            class="history-trailer-rows"
                          >
                            <li v-for="(sr, si) in t.summaryRows" :key="si">
                              <span class="sr-label">{{ sr.label }}</span>
                              <span class="sr-val">{{ sr.value }}</span>
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </details>
                </li>
                </ul>

              </details>
            </div>

            <details class="history-pay-fold history-fold">
              <summary class="history-pay-fold__summary history-fold__summary">
                <span class="history-pay-fold__title">Pay breakdown estimate</span>
              </summary>
              <div class="history-pay-body">
                <p class="history-pay-rules">
                  $1 per billable mile (paid miles from {{ PAY_ROUND_BAND_MIN }}–{{ PAY_ROUND_BAND_MAX }} mi count as
                  {{ PAY_ROUND_TO_MI }} mi). Missing mileage counts as 0 mi.
                </p>
                <ul class="history-pay-list" aria-label="Pay estimate by trip">
                  <li
                    v-for="row in (weekPayEstimateByKey[wg.key] || { rows: [] }).rows"
                    :key="row.id"
                    class="history-pay-row"
                  >
                    <span class="history-pay-row__main">
                      <span class="history-pay-row__od">{{ row.od }}</span>
                      <span class="history-pay-row__when">{{ row.when }}</span>
                    </span>
                    <span class="history-pay-row__nums">
                      <span class="history-pay-row__bill">{{ row.billableMi }} mi → {{ formatUsdWhole(row.billableMi) }}</span>
                      <span v-if="row.rounded" class="history-pay-row__note"
                        >{{ PAY_ROUND_BAND_MIN }}–{{ PAY_ROUND_BAND_MAX }} mi → {{ PAY_ROUND_TO_MI }} mi</span
                      >
                      <span v-else-if="row.paidMi == null" class="history-pay-row__note">no paid mi</span>
                    </span>
                  </li>
                </ul>
                <div class="history-pay-total">
                  <span>Estimated total</span>
                  <strong>{{
                    formatUsdWhole((weekPayEstimateByKey[wg.key] || { estimateUsd: 0 }).estimateUsd)
                  }}</strong>
                </div>
              </div>
            </details>
          </details>
        </div>
      </template>
      </div>
    </div>
    <Teleport to="body">
      <ul
        v-if="outcomeRowForMenu && outcomeMenuPos && outcomeMenuOpen"
        class="history-outcome-pop history-outcome-pop--fixed history-outcome-pop-layer"
        role="listbox"
        :style="{
          top: outcomeMenuPos.top + 'px',
          left: outcomeMenuPos.left + 'px',
          minWidth: outcomeMenuPos.minWidth + 'px',
        }"
        @click.stop
        @pointerdown.stop
      >
        <li
          v-for="opt in outcomeMenuOpts"
          :key="opt.k"
          role="option"
          :aria-selected="outcomeSelectValue(outcomeRowForMenu) === opt.k"
        >
          <button
            type="button"
            class="history-outcome-mi"
            :disabled="historySavingId === 'seq-' + (outcomeRowForMenu.dailyTripLegSequence || '')"
            :class="{
              'history-outcome-mi--on': outcomeSelectValue(outcomeRowForMenu) === opt.k,
            }"
            @click="pickOutcomeFromMenu(outcomeRowForMenu, opt.k, $event)"
          >
            {{ opt.t }}
          </button>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.history-view {
  padding: var(--space-4, 1rem) 0 var(--space-8, 2rem);
  max-width: var(--app-content-max, 40rem);
  margin-inline: auto;
  width: 100%;
  box-sizing: border-box;
}

.history-content {
  display: block;
  width: 100%;
  border-radius: 14px;
  border: 1px solid #26262e;
  background: #0c0c10;
  padding: 0.5rem 0.45rem 0.75rem;
  box-sizing: border-box;
}

.history-err {
  color: #f87171;
  font-size: var(--text-sm, 0.8125rem);
  margin: 0 0 0.5rem;
}

.history-empty {
  color: var(--color-text-tertiary, #6e6e7e);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.5;
  margin: 0 0 0.5rem;
}

.history-month-nav {
  flex: 0 0 auto;
  min-width: 2.4rem;
  min-height: 2.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(167, 139, 250, 0.35);
  background: linear-gradient(180deg, rgba(88, 52, 140, 0.55) 0%, rgba(42, 26, 72, 0.95) 100%);
  color: #eee8ff;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset;
}

.history-mnav:hover:not(:disabled) {
  border-color: rgba(196, 181, 253, 0.55);
  background: linear-gradient(180deg, rgba(109, 71, 165, 0.65) 0%, rgba(52, 32, 88, 0.98) 100%);
}

.history-mnav:active:not(:disabled) {
  transform: translateY(1px);
}

.history-mnav:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-month-h2 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-primary, #f0f0f8);
  line-height: 1.2;
  text-align: center;
  flex: 1;
  min-width: 0;
  padding: 0 0.2rem;
}

.history-month-body {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.history-no-month {
  margin: 0.35rem 0 0.5rem;
  font-size: 0.8rem;
  color: #7a7a8a;
}

.history-cal-surface {
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.45rem 0.4rem;
  border-radius: 12px;
  background: #14141a;
  border: 1px solid #2a2a32;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}
.history-month-grid {
  user-select: none;
}
.history-month-dow {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.15rem;
  margin-bottom: 0.2rem;
}
.history-dow {
  text-align: center;
  font-size: 0.5rem;
  font-weight: 800;
  color: #5a5a6a;
  text-transform: uppercase;
  padding: 0.1rem 0;
}
.history-month-cells {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.2rem;
}
.history-day-cell {
  position: relative;
  min-height: 2.1rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.15rem 0.1rem 0.25rem;
  border-radius: 7px;
  border: 1px solid #2a2a32;
  background: #0f0f12;
  color: #3a3a4a;
  font-size: 0.6rem;
  line-height: 1;
  cursor: default;
  font-variant-numeric: tabular-nums;
}
.history-day-cell:disabled {
  cursor: not-allowed;
  opacity: 0.4;
  border-color: #1e1e20;
  background: #0a0a0c;
}
.history-day-cell--in-ww:not(:disabled) {
  color: #e0e0f0;
  background: rgba(34, 197, 94, 0.08);
  border-color: rgba(34, 197, 94, 0.28);
  cursor: pointer;
  opacity: 1;
}

.history-day-cell--in-ww:hover:not(:disabled) {
  border-color: rgba(52, 211, 153, 0.55);
  background: rgba(34, 197, 94, 0.12);
}
.history-day-cell--on {
  border-color: rgba(52, 211, 153, 0.85) !important;
  background: rgba(34, 197, 94, 0.18) !important;
  color: #f0fdf4 !important;
  box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.38);
}
.history-day-cell--empty {
  opacity: 0.85;
}
.history-day-cell--has .history-day-num {
  color: #e0e0f0;
  font-weight: 800;
}
.history-day-cell--today:not(.history-day-cell--on) {
  box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.45);
}
.history-day-num {
  font-size: 0.78rem;
  font-weight: 700;
}
.history-day-badge {
  position: absolute;
  right: 2px;
  bottom: 2px;
  min-width: 0.85rem;
  padding: 0.05rem 0.2rem;
  font-size: 0.5rem;
  font-weight: 800;
  border-radius: 4px;
  background: #14532d;
  color: #86efac;
  border: 1px solid #166534;
  line-height: 1.1;
}
.history-cal-filt {
  margin: 0.45rem 0 0;
  font-size: 0.62rem;
  color: #6a6a7a;
}
.history-cal-filt .history-link {
  background: none;
  border: none;
  color: #a78bfa;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  font-size: inherit;
  font-weight: 600;
  padding: 0;
  margin: 0;
}
.history-trips-h2 {
  margin: 0.65rem 0 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #8a8a98;
}

.history-month-mile-sum {
  margin: 0 0 0.55rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--color-text-secondary, #b8b8c8);
}

.history-month-mile-sum strong {
  color: var(--color-text-primary, #f0f0f8);
  font-weight: 700;
}

.history-month-mile-sum--muted {
  font-size: 0.72rem;
  color: var(--color-text-tertiary, #7a7a8a);
}

.history-hierarchy {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.history-fold {
  border-radius: 12px;
  border: 1px solid #2c2c38;
  background: linear-gradient(180deg, #16161e 0%, #121218 100%);
  overflow: hidden;
}

.history-fold > summary.history-fold__summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.history-fold > summary.history-fold__summary::-webkit-details-marker {
  display: none;
}

.history-fold > summary.history-fold__summary::after {
  content: '▾';
  flex-shrink: 0;
  margin-left: 0.35rem;
  font-size: 0.65rem;
  color: #9a9aaa;
  line-height: 1;
}

.history-fold[open] > summary.history-fold__summary::after {
  content: '▴';
}

.history-ww-section.history-fold > .history-fold__summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  background: rgba(124, 92, 255, 0.06);
  border-bottom: 1px solid #2a2a34;
}

.history-day-card.history-fold > .history-fold__summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
  padding: 0.42rem 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid #25252f;
}

.history-ww-head-row,
.history-day-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem 0.55rem;
  flex: 1;
  min-width: 0;
}

.history-head-metrics {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.35rem;
  flex-shrink: 0;
}

.history-mile-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  min-height: 1.65rem;
  padding: 0.18rem 0.42rem;
  border-radius: 999px;
  font-size: 0.6rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  background: rgba(124, 92, 255, 0.14);
  border: 1px solid rgba(167, 139, 250, 0.35);
  color: #ddd6fe;
  white-space: nowrap;
}

.history-mile-pill--sm {
  font-size: 0.56rem;
  padding: 0.14rem 0.36rem;
  min-height: 1.55rem;
}

.history-pay-head-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  min-height: 1.65rem;
  padding: 0.18rem 0.42rem;
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.38);
  color: #bbf7d0;
  white-space: nowrap;
}

.history-pay-head-pill--sm {
  font-size: 0.54rem;
  padding: 0.14rem 0.34rem;
  min-height: 1.55rem;
}

.history-ww-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-primary, #ececf4);
}

.history-day-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #c8c8d8;
}

.history-mile-pill--muted {
  background: rgba(255, 255, 255, 0.04);
  border-color: #363648;
  color: #7c7c8c;
  font-weight: 600;
}

.history-day-stack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.45rem 0.45rem 0.55rem;
}

.history-pay-fold {
  margin: 0 0.45rem 0.55rem;
  border-radius: 10px;
  border: 1px solid #2f2f3a;
  background: rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.history-pay-fold > .history-pay-fold__summary {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.5rem;
  padding: 0.42rem 0.55rem;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid #2a2a32;
}

.history-pay-fold__title {
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #a8a8b8;
}

.history-pay-body {
  padding: 0.45rem 0.55rem 0.55rem;
}

.history-pay-rules {
  margin: 0 0 0.45rem;
  font-size: 0.62rem;
  line-height: 1.45;
  color: #7a7a8a;
}

.history-pay-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  border-top: 1px solid #2c2c38;
}

.history-pay-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.55rem;
  padding: 0.42rem 0;
  border-bottom: 1px solid #2a2a34;
  background: transparent;
}

.history-pay-row:last-child {
  border-bottom: none;
}

.history-pay-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.history-pay-row__od {
  font-size: 0.65rem;
  font-weight: 650;
  color: #d8d8e6;
  line-height: 1.25;
  word-break: break-word;
}

.history-pay-row__when {
  font-size: 0.58rem;
  font-variant-numeric: tabular-nums;
  color: #7c7c8c;
}

.history-pay-row__nums {
  flex-shrink: 0;
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  align-items: flex-end;
}

.history-pay-row__bill {
  font-size: 0.62rem;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  color: #e8e8f2;
  white-space: nowrap;
}

.history-pay-row__note {
  font-size: 0.54rem;
  font-weight: 600;
  color: #8b8b9b;
  max-width: 11rem;
}

.history-pay-total {
  margin-top: 0.45rem;
  padding-top: 0.45rem;
  border-top: 1px solid #2c2c38;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.68rem;
  color: #9a9aaa;
}

.history-pay-total strong {
  font-size: 0.78rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #f4f4fa;
}

.history-list--day {
  padding: 0 !important;
  gap: 0.45rem !important;
}

.history-day-card .history-card {
  border-color: #32323c;
  background: #181820;
}

.history-trip-mi-pill {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 0;
  box-sizing: border-box;
  font-size: 0.54rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #c4b5fd;
  padding: 0.1rem 0.34rem;
  border-radius: 6px;
  background: rgba(124, 92, 255, 0.12);
  border: 1px solid rgba(167, 139, 250, 0.28);
  white-space: nowrap;
  text-align: right;
  line-height: 1.2;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
}

.history-list--nested {
  margin: 0;
  padding: 0.4rem 0.25rem 0.5rem;
  gap: 0.5rem;
  background: transparent;
  border: none;
  border-radius: 0;
}

.history-card {
  border: 1px solid #34343e;
  border-radius: 12px;
  background: #1a1a22;
  overflow: visible;
}

.history-drop {
  list-style: none;
}

.history-trip-fold {
  position: relative;
}

.history-trip-summary.history-fold__summary {
  display: block;
  padding: 0.26rem 1.65rem 0.22rem 0.44rem;
}

.history-trip-summary.history-fold__summary::after {
  top: 50%;
  transform: translateY(-50%);
}

.history-trip-head {
  display: flex;
  flex-direction: column;
  gap: 0.14rem;
  width: 100%;
}

.history-trip-row-a {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem;
  width: 100%;
}

.history-trip-rightbar {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 0.32rem;
  flex-shrink: 0;
  padding-top: 0.02rem;
}

.history-trip-rightbar .history-outcome-slot {
  flex-shrink: 0;
}

.history-trip-od-line {
  margin: 0;
  min-width: 0;
  flex: 1 1 auto;
  font-size: 0.64rem;
  font-weight: 600;
  line-height: 1.22;
  color: var(--color-text-primary, #ececf4);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.1rem 0.24rem;
}

.history-trip-od-sep {
  color: #4e4e58;
  font-weight: 700;
  padding: 0 0.04rem;
}

.history-trip-inline-k {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #dedeea;
}

.history-trip-meta-strip {
  margin: 0;
  font-size: 0.54rem;
  font-weight: 600;
  line-height: 1.18;
  letter-spacing: 0.015em;
  color: var(--color-text-tertiary, #7a7a88);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.18rem 0.28rem;
}

.history-trip-meta-strip__lab {
  font-size: 0.48rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #6f6f7c;
}

.history-trip-meta-strip__when {
  font-size: 0.56rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #c8c4dc;
}

.history-trip-meta-strip__leg {
  font-variant-numeric: tabular-nums;
}

.history-trip-meta-strip__sep {
  color: #4e4e58;
  font-weight: 700;
}

.history-od-lab {
  font-size: 0.54rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #8b8b98;
  flex: 0 0 auto;
}

.history-od-id {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #f0f0f8;
}

.history-od-arrow {
  color: #6b6b78;
  font-weight: 700;
  padding: 0 0.05rem;
}

.history-card-summary {
  list-style: none;
  position: relative;
  background: #22222c;
  border-bottom: 1px solid #2e2e38;
  cursor: pointer;
  user-select: none;
}

.history-card-summary::-webkit-details-marker {
  display: none;
}

.history-drop {
  list-style: none;
}

.history-drop:not(.history-trip-fold) .history-card-summary {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
  padding: 0.65rem 0.75rem 0.55rem;
}

.history-drop:not(.history-trip-fold) .history-card-summary::after {
  content: '▾';
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7rem;
  color: #8a8a98;
  pointer-events: none;
}

.history-drop:not(.history-trip-fold)[open] .history-card-summary::after {
  content: '▴';
}

.history-drop:not(.history-trip-fold) {
  position: relative;
}

.history-trip-fold .history-card-summary::after {
  content: '▾';
  position: absolute;
  right: 0.65rem;
  top: 0.5rem;
  transform: none;
  font-size: 0.68rem;
  color: #9a9aaa;
  pointer-events: none;
}

.history-trip-fold[open] .history-card-summary::after {
  content: '▴';
}

.history-od-lane {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.25rem 0.35rem;
  width: 100%;
  min-width: 0;
  padding-right: 1.1rem;
}

.history-od-compact {
  flex: 1 1 0;
  min-width: 0;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-primary, #f0f0f6);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.history-od-mid {
  flex: 0 0 auto;
  color: #6b6b78;
  font-size: 0.9rem;
  line-height: 1.2;
  padding: 0 0.1rem;
}

.summary-tag {
  display: inline-block;
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #9ca3af;
  margin-right: 0.2rem;
  vertical-align: 0.1em;
}

.history-time-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  min-width: 0;
  flex: 0 1 auto;
}

.history-time-lab {
  font-size: 0.5rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6e6e7e;
}

.history-date {
  font-size: 0.78rem;
  font-weight: 800;
  color: #e4dff8;
  font-variant-numeric: tabular-nums;
  align-self: flex-start;
}
.history-row-tr {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 0.4rem;
  min-width: 0;
  width: 100%;
  justify-content: space-between;
}
.history-top-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-end;
}
.history-outcome-wrap {
  position: relative;
  flex: 0 0 auto;
  max-width: min(10rem, 100%);
}
.history-outcome-pill {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem;
  width: 100%;
  min-height: 1.45rem;
  min-width: 0;
  padding: 0.08rem 0.35rem 0.08rem 0.38rem;
  line-height: 1.15;
  border: 1px solid;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: #a8a8b8;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.history-outcome-pill:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.history-outcome-pill__txt {
  font-size: 0.58rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-outcome-pill__chev {
  font-size: 0.5rem;
  line-height: 1;
  opacity: 0.7;
  flex-shrink: 0;
}

/* Trip card header: compact pill (base rule above uses taller default for day/week rows) */
.history-outcome-pill.history-outcome-pill--trip {
  width: auto;
  min-width: 4.45rem;
  max-width: min(10rem, 42vw);
  min-height: 1.22rem;
  padding: 0.05rem 0.28rem 0.05rem 0.3rem;
}

.history-outcome-pop {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 10090;
  min-width: 7.5rem;
  max-width: 12rem;
  margin: 0;
  padding: 0.2rem;
  list-style: none;
  border: 1px solid #3f3f4c;
  border-radius: 8px;
  background: #1a1a22;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.history-outcome-pop--fixed {
  position: fixed;
  right: auto;
  top: auto;
  z-index: 10090;
  max-width: min(12rem, calc(100vw - 16px));
}
.history-day-cell--faint {
  opacity: 0.35;
}
.history-day-cell--faint:disabled {
  pointer-events: none;
}
.history-outcome-pop li {
  margin: 0;
  padding: 0;
}
.history-outcome-mi {
  width: 100%;
  text-align: left;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.4rem 0.55rem;
  border: none;
  background: transparent;
  color: #d8d8e6;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.25;
}
.history-outcome-mi:hover:not(:disabled) {
  background: #2a2a32;
}
.history-outcome-mi:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.history-outcome-mi--on {
  color: #c4b5fd;
  background: rgba(123, 77, 181, 0.2);
}
.history-outcome-pill.history-outcome--none {
  border-color: #3f3f4a;
  color: #7a7a8a;
  background: rgba(0, 0, 0, 0.15);
}
.history-outcome-pill.history-outcome--delivered {
  border-color: #166534;
  color: #86efac;
  background: rgba(22, 101, 52, 0.25);
}
.history-outcome-pill.history-outcome--rejected {
  border-color: #991b1b;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
}
.history-outcome-pill.history-outcome--removed {
  border-color: #52525b;
  color: #d4d4d8;
  background: rgba(63, 63, 70, 0.4);
}


.history-outcome--none {
  display: none;
}

.history-outcome-row {
  padding: 0.4rem 0.75rem 0.5rem;
  background: #1a1a22;
  border-bottom: 1px solid #2e2e36;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.history-dbl-hint {
  margin: 0;
  font-size: 0.6rem;
  line-height: 1.3;
  color: #5c5c6a;
}

.history-outcome-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.35rem;
  align-items: center;
}

.history-o-btn {
  font-size: 0.6rem;
  font-weight: 600;
  padding: 0.25rem 0.4rem;
  border-radius: 5px;
  border: 1px solid #3a3a46;
  background: #1f1f28;
  color: #b4b4c0;
  cursor: pointer;
}

.history-o-btn:hover {
  background: #25252e;
  border-color: #4a4a58;
}

.history-o-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.history-o-btn--active {
  border-color: #7b4db5;
  color: #e4d4ff;
  background: rgba(123, 77, 181, 0.2);
}

.history-dispatch {
  padding: 0.42rem 0.55rem 0.38rem;
  border-bottom: 1px solid #2a2a34;
}

.history-od {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.5rem;
  font-size: 0.82rem;
  line-height: 1.35;
  color: var(--color-text-primary, #f4f4f8);
}

.history-od-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary, #6e6e7e);
}

.history-od-val {
  font-weight: 600;
}

.history-od-arrow {
  color: var(--color-text-tertiary, #6e6e7e);
  padding: 0 0.15rem;
}

.history-meta {
  margin: 0.28rem 0 0;
  font-size: 0.68rem;
  line-height: 1.3;
  color: var(--color-text-secondary, #a8a8b8);
}

.history-instr {
  margin: 0.38rem 0 0;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--color-text-secondary, #c4c4d0);
  white-space: pre-wrap;
}

.history-body {
  padding: 0.45rem 0.55rem 0.55rem;
}

.history-mileage {
  margin-bottom: 0.45rem;
  padding: 0.38rem 0.48rem;
  border-radius: 6px;
  background: rgba(124, 92, 255, 0.05);
  border: 1px solid rgba(124, 92, 255, 0.18);
}

.history-mileage-top {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.55rem;
  justify-content: space-between;
}

.history-body-label--inline {
  display: inline;
  margin: 0;
  margin-right: 0.35rem;
}

.history-mileage-vals {
  margin: 0;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-primary, #f0f0f8);
}

.history-mileage-mi {
  font-variant-numeric: tabular-nums;
}

.history-mile-stat-sep {
  color: #5c5c68;
  font-weight: 700;
}

.history-mile-run {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--color-text-secondary, #b4b4c4);
  font-variant-numeric: tabular-nums;
}

.history-mileage-by-state {
  margin: 0.32rem 0 0;
  padding-left: 0.95rem;
  font-size: 0.68rem;
  line-height: 1.28;
  color: var(--color-text-secondary, #a8a8b8);
}

.history-trip-meta {
  margin: 0 0 0.45rem;
  font-size: 0.68rem;
  line-height: 1.3;
  color: var(--color-text-secondary, #a8a8b8);
}

.history-body-label {
  display: block;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary, #6e6e7e);
  margin-bottom: 0.35rem;
}

.history-mini-dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.14rem 0.55rem;
  margin: 0;
  font-size: 0.7rem;
}

.history-mini-dl dt {
  color: var(--color-text-tertiary, #8e8e9e);
  font-weight: 500;
}

.history-mini-dl dd {
  margin: 0;
  color: var(--color-text-primary, #f0f0f8);
}

.history-dolly {
  margin-bottom: 0.45rem;
}

.history-trailers {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.history-trailer-block {
  padding: 0.38rem 0.45rem;
  border-radius: 6px;
  background: #14141a;
  border: 1px solid #2a2a34;
}

.history-trailer-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.28rem;
}

.history-trailer-title {
  font-weight: 700;
  font-size: 0.74rem;
  color: var(--color-text-primary, #f4f4f8);
}

.history-trailer-nbr {
  font-weight: 700;
  font-size: 0.74rem;
  font-family: ui-monospace, monospace;
  color: var(--color-text-primary, #f4f4f8);
}

.history-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.32rem;
  border-radius: 4px;
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: #2a3a4a;
  color: #7dd3fc;
  border: 1px solid #3d5a80;
}

.history-badge--muted {
  background: #2e2e38;
  color: #9898a8;
  border-color: #3e3e48;
}

.history-badge--load {
  background: rgba(156, 163, 175, 0.1);
  color: #9ca3af;
  border-color: rgba(156, 163, 175, 0.25);
}

.history-trailer-rows {
  list-style: none;
  margin: 0.32rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  font-size: 0.66rem;
}

.history-trailer-rows li {
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.sr-label {
  color: var(--color-text-tertiary, #8e8e9e);
  flex-shrink: 0;
}

.sr-val {
  color: var(--color-text-primary, #eaeaf0);
  text-align: right;
  word-break: break-word;
}
</style>
