<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick, Teleport } from 'vue'
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

/** YYYY-MM-DD; empty = show all days in selected work week */
const filterDayKey = ref('')
/** First successful load: pin calendar + day filter to "today" (shift-aware). */
const dayFilterInitDone = ref(false)
const outcomeMenuOpen = ref('')
const outcomeMenuPos = ref(/** @type {null | { top: number, left: number, minWidth: number }} */ (null))
const outcomeRowForMenu = ref(/** @type {null | LedgerEntry} */ (null))

const outcomeMenuOpts = [
  { k: 'none', t: 'None' },
  { k: 'delivered', t: 'Delivered' },
  { k: 'rejected', t: 'Rejected' },
  { k: 'removed', t: 'Removed' },
]

const HISTORY_VIEW_STORAGE = 'historyViewMode'

/** @type {import('vue').Ref<'calendar' | 'week'>} */
const historyViewMode = ref(
  typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem(HISTORY_VIEW_STORAGE) === 'week'
    ? 'week'
    : 'calendar',
)

watch(historyViewMode, (v) => {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(HISTORY_VIEW_STORAGE, v)
  }
})

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
 * Planned route mileage from Linehaul `viewTripInfoDetails` (stored under tripDetails.mileage).
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
function tripPlannedMiles(e) {
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
 * One-line mileage for headers (planned mi only).
 * @param {number} sum
 * @param {number} withMi
 * @param {number} totalTrips
 */
function mileageHeaderLine(sum, withMi, totalTrips) {
  if (withMi > 0) {
    return `${formatMilesSum(sum)} mi · ${withMi}/${totalTrips} trips`
  }
  return `No mi · ${totalTrips} ${totalTrips === 1 ? 'trip' : 'trips'}`
}

/**
 * Short trip mileage for collapsed card header.
 * @param {LedgerEntry} e
 */
function tripHeaderMileageText(e) {
  const mb = mileageBlock(e)
  if (!mb?.total) return ''
  const parts = [`${mb.total} mi`]
  if (mb.run != null) parts.push(`~${mb.run}h`)
  return parts.join(' · ')
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
    if (!dayFilterInitDone.value) {
      const k = shiftDateKeyForEventMs(
        Date.now(),
        workWeekFromCred.value.shiftStartMins,
        workWeekFromCred.value.shiftEndMins,
      )
      if (k) {
        filterDayKey.value = k
        const ymd = k.split('-')
        if (ymd.length === 3) {
          const y = Number(ymd[0])
          const mo = Number(ymd[1])
          if (Number.isFinite(y) && Number.isFinite(mo) && mo >= 1 && mo <= 12) {
            viewYear.value = y
            viewMonth0.value = mo - 1
          }
        }
      }
      dayFilterInitDone.value = true
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
        const mi = tripPlannedMiles(e)
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

/** Sum of planned miles for the visible month list (only trips with mileage data). */
const monthPlannedMilesTotal = computed(() => {
  let sum = 0
  let count = 0
  for (const w of tripsByWorkWeek.value) {
    if (w.tripsWithMileage > 0) {
      sum += w.mileageSum
      count += w.tripsWithMileage
    }
  }
  return { sum, count }
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

function goToToday() {
  const k = shiftDateKeyForEventMs(
    Date.now(),
    workWeekFromCred.value.shiftStartMins,
    workWeekFromCred.value.shiftEndMins,
  )
  if (k) {
    const parts = k.split('-')
    if (parts.length === 3) {
      const y = Number(parts[0])
      const m = Number(parts[1])
      if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
        viewYear.value = y
        viewMonth0.value = m - 1
      }
    }
    filterDayKey.value = k
  }
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
    <header class="history-head">
      <div class="history-head-top">
        <h1 class="history-title">History</h1>
        <button
          type="button"
          class="btn secondary history-refresh tap"
          :disabled="loading"
          @click="load"
        >
          {{ loading ? 'Loading' : 'Refresh' }}
        </button>
      </div>
      <p class="history-sub">
        List time is <strong>dispatch</strong> (first Linehaul save) or
        <strong>when you marked complete</strong> — it does not change when status updates.
      </p>
    </header>

    <p v-if="error" class="history-err">{{ error }}</p>
    <div
      v-else
      v-show="!loading"
      class="history-content"
    >
      <p v-if="!sorted.length" class="history-empty">No trips</p>
      <div class="history-month-body">
      <div class="history-view-tabs" role="tablist" aria-label="History layout">
        <button
          type="button"
          role="tab"
          class="history-view-tab tap"
          :class="{ 'history-view-tab--on': historyViewMode === 'calendar' }"
          :aria-selected="historyViewMode === 'calendar'"
          @click="historyViewMode = 'calendar'"
        >
          Calendar
        </button>
        <button
          type="button"
          role="tab"
          class="history-view-tab tap"
          :class="{ 'history-view-tab--on': historyViewMode === 'week' }"
          :aria-selected="historyViewMode === 'week'"
          @click="historyViewMode = 'week'"
        >
          Week view
        </button>
      </div>
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
        <button
          type="button"
          class="btn secondary history-today tap"
          title="Jump to today and filter to this shift day"
          :disabled="loading"
          @click="goToToday"
        >
          Today
        </button>
      </div>
      <div
        v-if="historyViewMode === 'calendar' && viewMonthGrid.cells.length"
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
          <button type="button" class="history-link tap" @click="goToToday">Today</button>
          &nbsp;·&nbsp;
          <button type="button" class="history-link tap" @click="filterDayKey = ''">Show month</button>
        </p>
      </div>
      <h2 v-if="weekFilteredItems.length" class="history-trips-h2">Trips</h2>
      <p
        v-if="
          weekFilteredItems.length &&
          !filterDayKey &&
          historyViewMode === 'calendar' &&
          monthPlannedMilesTotal.count > 0
        "
        class="history-month-mile-sum"
      >
        Planned miles this month ({{ monthPlannedMilesTotal.count }}
        {{ monthPlannedMilesTotal.count === 1 ? 'trip' : 'trips' }}):
        <strong>{{ formatMilesSum(monthPlannedMilesTotal.sum) }} mi</strong>
      </p>
      <p
        v-else-if="
          weekFilteredItems.length &&
          !filterDayKey &&
          historyViewMode === 'calendar'
        "
        class="history-month-mile-sum history-month-mile-sum--muted"
      >
        No planned mileage saved for trips this month yet (dispatched trips populate from Linehaul).
      </p>
      <p v-else-if="filterDayKey && !weekFilteredItems.length" class="history-no-month">
        No trips on this shift day.
      </p>
      <p v-else-if="!weekFilteredItems.length" class="history-no-month">No trips this month</p>
      <template v-if="tripsByWorkWeek.length">
        <section
          v-for="wg in tripsByWorkWeek"
          :key="wg.key"
          class="history-ww-section"
          :aria-label="wg.groupLabel"
        >
          <header class="history-ww-head">
            <div class="history-ww-head-row">
              <h3 class="history-ww-title">{{ wg.groupLabel }}</h3>
              <span
                class="history-mile-pill"
                :class="{ 'history-mile-pill--muted': wg.tripsWithMileage === 0 }"
              >
                {{ mileageHeaderLine(wg.mileageSum, wg.tripsWithMileage, wg.tripCount) }}
              </span>
            </div>
          </header>

          <div class="history-day-stack">
            <section
              v-for="dg in wg.days"
              :key="`${wg.key}-${dg.shiftDayKey || 'unk'}`"
              class="history-day-card"
            >
              <header class="history-day-head">
                <div class="history-day-head-row">
                  <h4 class="history-day-title">{{ dg.dayLabel }}</h4>
                  <span
                    class="history-mile-pill history-mile-pill--sm"
                    :class="{ 'history-mile-pill--muted': dg.tripsWithMileage === 0 }"
                  >
                    {{ mileageHeaderLine(dg.mileageSum, dg.tripsWithMileage, dg.tripCount) }}
                  </span>
                </div>
              </header>

              <ul class="history-list history-list--nested history-list--day" :aria-label="`${dg.dayLabel} trips`">
                <li
                  v-for="e in dg.items"
                  :id="`history-card-${e.id}`"
                  :key="e.id"
                  class="history-card"
                >
                  <details class="history-drop">
                    <summary class="history-card-summary" @dblclick.stop.prevent="onRowDoubleClick(e)">
                      <span class="history-od-lane">
                        <span class="history-od-compact" :title="str(e.dispatchHeader?.origin) || '—'">
                          <span class="summary-tag">O</span>
                          {{ str(e.dispatchHeader?.origin) || '—' }}
                        </span>
                        <span class="history-od-mid" aria-hidden="true">→</span>
                        <span class="history-od-compact" :title="str(e.dispatchHeader?.destination) || '—'">
                          <span class="summary-tag">D</span>
                          {{ str(e.dispatchHeader?.destination) || '—' }}
                        </span>
                      </span>
                      <div class="history-row-tr">
                        <div class="history-time-block">
                          <span class="history-time-lab">{{
                            e.source === 'linehaul' ? 'Dispatched' : 'Time'
                          }}</span>
                          <time
                            class="history-date"
                            :datetime="new Date(e.displayDate).toISOString()"
                            >{{ formatWhen(e.displayDate) }}</time
                          >
                        </div>
                        <div class="history-summary-right">
                          <span v-if="tripHeaderMileageText(e)" class="history-trip-mi-pill">{{
                            tripHeaderMileageText(e)
                          }}</span>
                          <div v-if="e.dailyTripLegSequence" class="history-top-actions" @click.stop>
                            <div class="history-outcome-wrap" @click.stop>
                              <button
                                type="button"
                                class="history-outcome-pill tap"
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
                      <span
                        v-if="e.dailyTripLegSequence"
                        class="history-seq"
                        :title="`Double-tap header: cycle status · Leg #${e.dailyTripLegSequence}`"
                        >Leg #{{ e.dailyTripLegSequence }} ·
                        {{ sourceLabel((str(e.dispatchHeader?.source) || e.source) || '') }}</span
                      >
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
                        <div v-if="mb" class="history-mileage">
                          <span class="history-body-label">Trip mileage</span>
                          <p v-if="mb.total || mb.run != null" class="history-mileage-total">
                            <template v-if="mb.total">{{ mb.total }} mi planned</template>
                            <template v-if="mb.run != null">
                              <template v-if="mb.total">&nbsp;·&nbsp;</template>~{{ mb.run }} h run time
                            </template>
                          </p>
                          <ul v-if="mb.directionList.length" class="history-mileage-by-state">
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
                          e.tripDetails.dolly.rows.length
                        "
                        class="history-dolly"
                      >
                        <span class="history-body-label">Dolly</span>
                        <dl class="history-mini-dl">
                          <template v-for="(row, idx) in e.tripDetails.dolly.rows" :key="idx">
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
                            <span class="history-badge history-badge--muted">{{ t.statusLabel }}</span>
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
            </section>
          </div>
        </section>
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

.history-head {
  margin-bottom: var(--space-3, 0.75rem);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.45rem;
}

.history-head-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 0.75rem;
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

.history-title {
  margin: 0;
  font-size: var(--text-xl, 1.25rem);
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
}

.history-sub {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--color-text-tertiary, #8a8a9a);
}

.history-sub strong {
  color: #c4b5fd;
  font-weight: 700;
}

.history-month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.history-view-tabs {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.55rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: #12121a;
  border: 1px solid #2a2a34;
}

.history-view-tab {
  flex: 1;
  min-height: 2.35rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #8e8e9e;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.history-view-tab:hover:not(.history-view-tab--on) {
  background: rgba(255, 255, 255, 0.04);
  color: #c8c8d8;
}

.history-view-tab--on {
  background: rgba(123, 77, 181, 0.35);
  color: #f0e8ff;
  box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.35);
}

.history-mnav {
  flex: 0 0 auto;
  min-width: 2.4rem;
  min-height: 2.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid #3a3a46;
  background: #1c1c24;
  color: #e0e0ee;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
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

.history-today {
  flex: 0 0 auto;
  min-height: 2.4rem;
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.35rem 0.55rem;
}

.history-month-body {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.history-refresh {
  padding: 0.4rem 0.85rem;
  border-radius: var(--radius-md, 0.5rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary, #f4f4f8);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.history-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.history-refresh.btn.secondary,
.btn.secondary.history-refresh {
  min-height: 2.25rem;
  padding: 0.4rem 1rem;
  background: var(--color-bg-surface, #16161d);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
  color: var(--color-text-primary, #e8e8f0);
}
.btn.secondary.history-refresh:hover:not(:disabled) {
  background: var(--color-hover, rgba(255, 255, 255, 0.04));
  border-color: var(--color-accent-purple, #7b4db5);
}

.history-err {
  color: #f87171;
  font-size: var(--text-sm, 0.8125rem);
}

.history-empty {
  color: var(--color-text-tertiary, #6e6e7e);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.5;
  margin: 0 0 0.5rem;
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
  color: #9a9ab0;
  background: #15151a;
  border-color: #3a3a48;
  cursor: pointer;
  opacity: 1;
}
.history-day-cell--in-ww:hover:not(:disabled) {
  border-color: #7b4db5;
  background: rgba(123, 77, 181, 0.1);
}
.history-day-cell--on {
  border-color: #a78bfa !important;
  background: rgba(123, 77, 181, 0.2) !important;
  color: #f0e6ff;
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

.history-ww-section {
  margin-bottom: 1rem;
}

.history-ww-section:last-child {
  margin-bottom: 0;
}

.history-ww-head {
  margin: 0 0 0.45rem;
  padding: 0;
}

.history-ww-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem 0.65rem;
  flex-wrap: wrap;
}

.history-ww-title {
  margin: 0;
  flex: 1 1 10rem;
  min-width: 0;
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1.35;
  color: var(--color-text-primary, #ececf4);
}

.history-mile-pill {
  flex: 0 0 auto;
  max-width: 100%;
  padding: 0.22rem 0.45rem;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  background: rgba(124, 92, 255, 0.14);
  border: 1px solid rgba(167, 139, 250, 0.35);
  color: #ddd6fe;
  white-space: nowrap;
}

.history-mile-pill--sm {
  font-size: 0.58rem;
  padding: 0.18rem 0.4rem;
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
  gap: 0.65rem;
}

.history-day-card {
  border-radius: 12px;
  border: 1px solid #2c2c38;
  background: linear-gradient(180deg, #14141c 0%, #111118 100%);
  overflow: hidden;
}

.history-day-head {
  padding: 0.45rem 0.55rem 0.35rem;
  border-bottom: 1px solid #25252f;
  background: rgba(255, 255, 255, 0.02);
}

.history-day-head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.45rem 0.55rem;
  flex-wrap: wrap;
}

.history-day-title {
  margin: 0;
  flex: 1 1 8rem;
  min-width: 0;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #c4c4d4;
}

.history-list--day {
  padding: 0.45rem 0.45rem 0.55rem !important;
  gap: 0.45rem !important;
}

.history-day-card .history-card {
  border-color: #2f2f3a;
  background: #16161e;
}

.history-summary-right {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-end;
}

.history-trip-mi-pill {
  font-size: 0.58rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #c4b5fd;
  padding: 0.12rem 0.38rem;
  border-radius: 6px;
  background: rgba(124, 92, 255, 0.12);
  border: 1px solid rgba(167, 139, 250, 0.22);
  white-space: nowrap;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
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

.history-card-summary {
  list-style: none;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
  padding: 0.65rem 0.75rem 0.55rem;
  background: #22222c;
  border-bottom: 1px solid #2e2e38;
  cursor: pointer;
  user-select: none;
}

.history-card-summary::-webkit-details-marker {
  display: none;
}

.history-card-summary::after {
  content: '▾';
  position: absolute;
  right: 0.9rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.7rem;
  color: #8a8a98;
  pointer-events: none;
}

.history-drop[open] .history-card-summary::after {
  content: '▴';
}

.history-drop {
  position: relative;
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
  min-height: 1.65rem;
  min-width: 0;
  padding: 0.1rem 0.35rem 0.1rem 0.4rem;
  line-height: 1.1;
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

.history-seq {
  font-size: 0.65rem;
  color: var(--color-text-tertiary, #6e6e7e);
  line-height: 1.3;
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
  padding: 0.75rem 0.85rem 0.5rem;
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
  margin: 0.4rem 0 0;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #a8a8b8);
}

.history-instr {
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--color-text-secondary, #c4c4d0);
  white-space: pre-wrap;
}

.history-body {
  padding: 0.75rem 0.85rem 0.85rem;
}

.history-mileage {
  margin-bottom: 0.75rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  background: rgba(124, 92, 255, 0.06);
  border: 1px solid rgba(124, 92, 255, 0.22);
}

.history-mileage-total {
  margin: 0 0 0.45rem;
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--color-text-primary, #f0f0f8);
}

.history-mileage-by-state {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--color-text-secondary, #b8b8c8);
}

.history-trip-meta {
  margin: 0 0 0.65rem;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #a8a8b8);
}

.history-body-label {
  display: block;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary, #6e6e7e);
  margin-bottom: 0.35rem;
}

.history-mini-dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 0.75rem;
  margin: 0;
  font-size: 0.75rem;
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
  margin-bottom: 0.75rem;
}

.history-trailers {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.history-trailer-block {
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  background: #14141a;
  border: 1px solid #2e2e38;
}

.history-trailer-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.history-trailer-title {
  font-weight: 700;
  font-size: 0.8rem;
  color: var(--color-text-primary, #f4f4f8);
}

.history-trailer-nbr {
  font-weight: 700;
  font-size: 0.8rem;
  font-family: ui-monospace, monospace;
  color: var(--color-text-primary, #f4f4f8);
}

.history-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.62rem;
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
  margin: 0.45rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
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
