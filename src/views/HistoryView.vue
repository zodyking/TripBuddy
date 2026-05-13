<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, Teleport } from 'vue'
import {
  getAssignment,
  getCredentials,
  patchTripHistoryOutcome,
  patchTripHistoryAuditBucket,
  appendTripHistoryManual,
  deleteTripHistoryEntry,
  fetchDispatchProof,
} from '../api.js'
import {
  tripPhase,
  linehaulTripsBody,
  tripBodyDailySeq,
  stableTripState,
  linehaulDriverBody,
  linehaulTractorBody,
  hiddenDailyTripLegSequences,
} from '../stores/linehaulSnapshotStore.js'
import { downloadHistoryWeekTotalsPdf } from '../utils/historyWeekTotalsPdf.js'
import {
  monthGridForCalendarMonth,
  workWeekGroupMeta,
  workWeekInclusiveDayCount,
} from '../utils/workWeekGroup.js'
import { shiftDateKeyForEventMs } from '../utils/shiftCalendar.js'
import {
  formatTripEquipmentPdfBlock,
  resolveHistoryTrailerLoadBadge,
} from '../utils/tripDetailsDisplay.js'

/**
 * @typedef {object} LedgerEntry
 * @property {string} id
 * @property {string} [source]
 * @property {number} displayDate (grouping/sorting; audit bucket overrides FedEx times when set)
 * @property {number} ledgerEventMs FedEx/story time anchor for same-leg dedup (not overridden by audit bucket)
 * @property {number} [historyAuditBucketMs]
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

/** `workWeek`: Settings work week. `paySchedule`: Sun–Sat (FedEx-style payout window), same shift boundaries. */
const historyWeekViewMode = ref(/** @type {'workWeek' | 'paySchedule'} */ ('workWeek'))

const historyGroupingOpts = computed(() => {
  const sh = workWeekFromCred.value.shiftStartMins
  const eh = workWeekFromCred.value.shiftEndMins
  if (historyWeekViewMode.value === 'paySchedule') {
    return {
      workWeekStartDay: 0,
      workWeekEndDay: 6,
      shiftStartMins: sh,
      shiftEndMins: eh,
      groupLabelMode: /** @type {'fedexPaySchedule'} */ ('fedexPaySchedule'),
    }
  }
  return {
    workWeekStartDay: workWeekFromCred.value.workWeekStartDay,
    workWeekEndDay: workWeekFromCred.value.workWeekEndDay,
    shiftStartMins: sh,
    shiftEndMins: eh,
    groupLabelMode: /** @type {'default'} */ ('default'),
  }
})

/** FedEx pay-period estimate card — off until we bring per-period totals back */
const SHOW_PAY_TOTAL_SECTION = false

const loading = ref(true)
const error = ref('')
/** @type {import('vue').Ref<LedgerEntry[]>} */
const entries = ref([])

const storedUsername = ref('')
const pdfCredMeta = ref(
  /** @type {{ employeeNumber?: string, driverName?: string }} */ ({}),
)
const pdfWeekBusyKey = ref('')

/** Viewed calendar month (prev/next, no year cap). */
const viewYear = ref(/** @type {number} */(new Date().getFullYear()))
const viewMonth0 = ref(/** @type {number} */(new Date().getMonth()))
/** Long-press duration (ms) on trip card header to open delete confirmation. */
const HISTORY_HEADER_LONG_PRESS_MS = 550
/** Ignore stray clicks after long-press (details toggle). */
const HISTORY_HEADER_SUPPRESS_CLICK_MS = 900
/** Cancel long-press if pointer moves beyond this (px) from start. */
const HISTORY_HEADER_LONG_PRESS_MOVE_PX = 14

/** @type {ReturnType<typeof setTimeout> | null} */
let historyHeaderLongPressTimer = null
/** @type {number} */
let historyHeaderLongPressStartX = 0
/** @type {number} */
let historyHeaderLongPressStartY = 0
/** @type {number} */
let suppressHistorySummaryToggleUntil = 0

/** YYYY-MM-DD; empty = show all days in the month / full weeks */
const filterDayKey = ref('')
/** First load: open calendar on month of most recent trip (not "today" filter). */
const calendarMonthInitDone = ref(false)
const outcomeMenuOpen = ref('')
const outcomeMenuPos = ref(/** @type {null | { top: number, left: number, minWidth: number }} */ (null))
const outcomeRowForMenu = ref(/** @type {null | LedgerEntry} */ (null))

const outcomeMenuOpts = [
  { k: 'delivered', t: 'Delivered' },
  { k: 'rejected', t: 'Rejected' },
  { k: 'removed', t: 'Removed' },
]

/** Delete confirmation modal state */
const deleteTarget = ref(/** @type {LedgerEntry | null} */ (null))
const deleteUsernameInput = ref('')
const deleteError = ref('')
const deleteBusy = ref(false)

const manualTripModalOpen = ref(false)
const manualTripOrigin = ref('')
const manualTripDestination = ref('')
const manualTripNotes = ref('')
/** YYYY-MM-DD — bucket day for grouping (local noon UTC ms sent to server). */
const manualTripAuditDate = ref('')
const manualTripBusy = ref(false)
const manualTripError = ref('')

const auditDayModalOpen = ref(false)
/** @type {import('vue').Ref<LedgerEntry | null>} */
const auditDayTarget = ref(null)
const auditDayDateStr = ref('')
const auditDayBusy = ref(false)
const auditDayError = ref('')

/** Leg # FedEx reports as active on Home (same as History row). */
const activeTripLegSeqForHistory = computed(() => {
  // Use stableTripState first (more reliable), fallback to raw body
  const stableSeq = stableTripState.value.dailyTripLegSequence
  if (stableSeq && /^\d+$/.test(String(stableSeq).trim())) {
    return String(stableSeq).trim()
  }
  const s = tripBodyDailySeq(linehaulTripsBody.value)
  return s && /^\d+$/.test(String(s).trim()) ? String(s).trim() : ''
})

function isHistoryRowActiveOngoingTrip(e) {
  const leg = String(e?.dailyTripLegSequence ?? '').trim()
  if (!leg || !activeTripLegSeqForHistory.value) return false
  if (leg !== activeTripLegSeqForHistory.value) return false
  const hidden = hiddenDailyTripLegSequences.value.map((s) => String(s).trim())
  if (hidden.includes(leg)) return false
  return tripPhase.value === 'assigned' || tripPhase.value === 'dispatched'
}

/**
 * Pill value for styling / menus: ongoing API trip shows as `current` when outcome still default.
 * @param {LedgerEntry} e
 */
function historyOutcomeUiSelectKey(e) {
  if (isHistoryRowActiveOngoingTrip(e)) {
    const o = outcomeSelectValue(e)
    if (o === 'delivered' || o === 'none') return 'current'
  }
  return outcomeSelectValue(e)
}

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
  // Only include delivered trips in totals (not rejected/removed/current)
  const outcome = historyOutcomeUiSelectKey(e)
  if (outcome !== 'delivered') return null
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
 * One-line mileage for headers (paid mi sum and delivered trip count).
 * @param {number} sum
 * @param {number} deliveredTrips - only trips marked delivered
 */
function mileageHeaderLine(sum, deliveredTrips) {
  const s = Number.isFinite(sum) ? sum : 0
  const n = Number.isFinite(deliveredTrips) ? Math.max(0, Math.floor(deliveredTrips)) : 0
  return `${formatMilesSum(s)} mi · ${n} ${n === 1 ? 'trip' : 'trips'}`
}

/**
 * Trip header: paid miles value only (numeric string; 0 when unknown).
 * @param {LedgerEntry} e
 */
function tripHeaderMilesValue(e) {
  const n = tripPaidMiles(e)
  return n != null ? formatMilesSum(n) : '0'
}

/**
 * Trip header: run duration as "1h 42m" when mileage API provides decimal hours.
 * @param {LedgerEntry} e
 */
function tripHeaderDurationHm(e) {
  const mb = mileageBlock(e)
  const h = mb?.run
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return null
  const totalMin = Math.round(h * 60)
  const hrs = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  const parts = []
  if (hrs > 0) parts.push(`${hrs}h`)
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`)
  return parts.join(' ')
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

/**
 * Trailers on a ledger entry with resolved empty/load badge (computed once per row).
 * @param {LedgerEntry} e
 */
function tripTrailersDecorated(e) {
  const arr = e?.tripDetails?.trailers
  if (!Array.isArray(arr)) return []
  return arr.map((t) => ({
    ...t,
    loadBadge: resolveHistoryTrailerLoadBadge(t),
  }))
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
  const when = formatWhenWithWeekday(e.displayDate)
  const seq = String(e.dailyTripLegSequence || '').trim()
  if (/^\d+$/.test(seq)) return `${when} · Leg #${seq}`
  return when
}

/**
 * Split dispatch timestamp + leg for PDF columns (WinAnsi-safe strings).
 * @param {LedgerEntry} e
 */
function tripPdfDispatchColumns(e) {
  const ts = e.displayDate
  const seq = String(e.dailyTripLegSequence || '').trim()
  const legLabel = /^\d+$/.test(seq) ? seq : '-'
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
    return {
      weekday: '-',
      dispatchDate: '-',
      dispatchTime: '-',
      legLabel,
    }
  }
  const d = new Date(ts)
  if (isNaN(d.getTime())) {
    return {
      weekday: '-',
      dispatchDate: '-',
      dispatchTime: '-',
      legLabel,
    }
  }
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'long' }),
    dispatchDate: d.toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    }),
    dispatchTime: d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }),
    legLabel,
  }
}

/**
 * Tractor saved on ledger `tripDetails` (from Linehaul trip snapshot).
 * @param {LedgerEntry} e
 */
function tripPdfTractor(e) {
  const td =
    e.tripDetails && typeof e.tripDetails === 'object'
      ? /** @type {Record<string, unknown>} */ (e.tripDetails)
      : {}
  const t = td.tractorNumber
  const s = t != null ? String(t).trim() : ''
  return s || '-'
}

/**
 * @param {LedgerEntry[]} items
 */
function computeWeekPayEstimate(items) {
  const sorted = [...items].sort((a, b) => b.displayDate - a.displayDate)
  let sumBillable = 0
  /** @type {{
   *   id: string,
   *   dailyTripLegSequence: string,
   *   od: string,
   *   when: string,
   *   originId: string,
   *   destId: string,
   *   routeOd: string,
   *   weekday: string,
   *   dispatchDate: string,
   *   dispatchTime: string,
   *   legLabel: string,
   *   tractorNumber: string,
   *   paidMi: number | null,
   *   billableMi: number,
   *   rounded: boolean,
   *   equipmentPdfBlock: string,
   * }[]} */
  const rows = []
  for (const e of sorted) {
    const paidMi = tripPaidMiles(e)
    const base = paidMi ?? 0
    const billableMi = billableMilesForPayEstimate(base)
    sumBillable += billableMi
    const dispatchCols = tripPdfDispatchColumns(e)
    rows.push({
      id: e.id,
      dailyTripLegSequence: e.dailyTripLegSequence || '',
      od: tripOdIdsOnly(e),
      when: tripPayWhenWithLeg(e),
      originId: leadingLocationId(e.dispatchHeader?.origin) || '-',
      destId: leadingLocationId(e.dispatchHeader?.destination) || '-',
      routeOd: (() => {
        const a = leadingLocationId(e.dispatchHeader?.origin) || '-'
        const b = leadingLocationId(e.dispatchHeader?.destination) || '-'
        return `${a} \u2192 ${b}`
      })(),
      weekday: dispatchCols.weekday,
      dispatchDate: dispatchCols.dispatchDate,
      dispatchTime: dispatchCols.dispatchTime,
      legLabel: dispatchCols.legLabel,
      tractorNumber: tripPdfTractor(e),
      paidMi,
      billableMi,
      rounded: base >= PAY_ROUND_BAND_MIN && base <= PAY_ROUND_BAND_MAX,
      equipmentPdfBlock: formatTripEquipmentPdfBlock(e.tripDetails),
    })
  }
  return {
    rows,
    sumBillable,
    estimateUsd: sumBillable,
  }
}

/** FedEx Ground-style pay period: local Sun 00:00 → Sat 23:59:59.999 (paycheck Fri covers prior completed period). */
function fedExPayPeriodContaining(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  const dow = d.getDay()
  const daysBackToSunday = dow
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBackToSunday, 0, 0, 0, 0)
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
  const sk = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  return {
    periodStartMs: start.getTime(),
    periodEndMs: end.getTime(),
    key: `fedex-pp-${sk}`,
    labelShort: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
  }
}

/** Friday paycheck date for work completed in pay period ending `periodEndMs` (first Friday after Sat night). */
function fedExPaycheckFridayMs(periodEndMs) {
  if (typeof periodEndMs !== 'number' || !Number.isFinite(periodEndMs)) return null
  let d = new Date(periodEndMs + 1)
  if (isNaN(d.getTime())) return null
  while (d.getDay() !== 5) {
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12, 0, 0, 0)
  }
  return d.getTime()
}

/**
 * Group ledger entries by FedEx pay period (each trip counted once by dispatch time).
 * @param {LedgerEntry[]} items
 */
function entriesByFedExPayPeriod(items) {
  /** @type {Map<string, { meta: NonNullable<ReturnType<typeof fedExPayPeriodContaining>>, items: LedgerEntry[] }>} */
  const map = new Map()
  for (const e of items) {
    const p = fedExPayPeriodContaining(e.displayDate)
    if (!p) continue
    const cur = map.get(p.key)
    if (!cur) map.set(p.key, { meta: p, items: [e] })
    else cur.items.push(e)
  }
  const list = Array.from(map.values()).sort((a, b) => b.meta.periodStartMs - a.meta.periodStartMs)
  for (const g of list) {
    g.items.sort((a, b) => b.displayDate - a.displayDate)
  }
  return list
}

/**
 * @param {number} n
 */
function formatUsdWhole(n) {
  if (!Number.isFinite(n)) return '$0'
  const r = Math.round(n)
  return `$${r.toLocaleString(undefined)}`
}

/**
 * @param {number} ms
 */
function isoDateFromMs(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Local calendar day → ms at noon (audit bucket; avoids DST midnight edges).
 * @param {string} iso YYYY-MM-DD
 */
function localNoonMsFromIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim())
  if (!m) return Date.now()
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const da = Number(m[3])
  return new Date(y, mo, da, 12, 0, 0, 0).getTime()
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
    storedUsername.value = typeof c.username === 'string' ? c.username.trim() : ''
    pdfCredMeta.value = {
      employeeNumber:
        typeof c.employeeNumber === 'string' ? c.employeeNumber.trim() : '',
      driverName: typeof c.driverName === 'string' ? c.driverName.trim() : '',
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
        const sourceStr0 = typeof x.source === 'string' ? x.source : 'complete'
        const comp =
          typeof x.completedAt === 'number' && Number.isFinite(x.completedAt)
            ? x.completedAt
            : 0
        const rec =
          typeof x.recordedAt === 'number' && Number.isFinite(x.recordedAt)
            ? x.recordedAt
            : 0
        const sourceStr = sourceStr0
        const ledgerEventMs =
          sourceStr === 'linehaul' && rec > 0
            ? rec
            : comp > 0
              ? comp
              : rec > 0
                ? rec
                : 0
        const oRaw = /** @type {any} */ (x)
        const auditMsRaw = oRaw.historyAuditBucketMs
        const auditMs =
          typeof auditMsRaw === 'number' &&
          Number.isFinite(auditMsRaw) &&
          auditMsRaw > 0
            ? auditMsRaw
            : 0
        const displayDate = auditMs > 0 ? auditMs : ledgerEventMs
        const seq = String(x.dailyTripLegSequence ?? '').trim()
        const legKey = /^\d+$/.test(seq) ? seq : ''
        const rawO =
          typeof oRaw.outcome === 'string' && oRaw.outcome
            ? normalizeOutcome(oRaw.outcome)
            : typeof oRaw.dispatchHeader === 'object' && oRaw.dispatchHeader
              ? normalizeOutcome(/** @type {any} */ (oRaw.dispatchHeader).historyOutcome)
              : ''
        const o = rawO || 'delivered'
        /** @type {LedgerEntry} */
        const e = {
          id: String(x.id ?? ''),
          source: sourceStr,
          ledgerEventMs,
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
        if (auditMs > 0) {
          e.historyAuditBucketMs = auditMs
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
          const tNew = e.ledgerEventMs
          const tCur = cur.ledgerEventMs
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

/**
 * Calendar months (YYYY-MM keys) that overlap the configured work-week block containing this trip.
 * Ensures a week split across two months appears in both month views with the same full week bucket.
 * @param {LedgerEntry} e
 * @param {{
 *   workWeekStartDay: number,
 *   workWeekEndDay: number,
 *   shiftStartMins?: number,
 *   shiftEndMins?: number
 * }} opts
 * @returns {string[]}
 */
function monthKeysOverlappingTripWorkWeek(e, opts) {
  const t = e.displayDate
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return []
  const meta = workWeekGroupMeta(t, opts)
  if (!meta) {
    const { key } = monthKeyFromMs(t)
    return key ? [key] : []
  }
  const span =
    typeof meta.spanDays === 'number' &&
    Number.isFinite(meta.spanDays) &&
    meta.spanDays >= 1 &&
    meta.spanDays <= 7
      ? meta.spanDays
      : 7
  const dayMs = 24 * 60 * 60 * 1000
  /** @type {Set<string>} */
  const keys = new Set()
  for (let i = 0; i < span; i += 1) {
    const d = new Date(meta.weekStart + i * dayMs)
    if (isNaN(d.getTime())) continue
    keys.add(monthKey(d.getFullYear(), d.getMonth()))
  }
  return keys.size ? Array.from(keys) : [monthKeyFromMs(t).key]
}

const monthByKey = computed(() => {
  const list = sorted.value
  const wwOpts = { ...historyGroupingOpts.value }
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
    const monthKeys = monthKeysOverlappingTripWorkWeek(e, wwOpts)
    for (const key of monthKeys) {
      const parsed = /^(\d{4})-(\d{2})$/.exec(key)
      const y = parsed ? parseInt(parsed[1], 10) : monthKeyFromMs(t).y
      const m0 = parsed ? parseInt(parsed[2], 10) - 1 : monthKeyFromMs(t).m0
      if (!m.has(key)) {
        const d0 = new Date(y, m0, 1, 12, 0, 0, 0)
        const groupLabel = d0.toLocaleString('en-US', { month: 'long', year: 'numeric' })
        m.set(key, { key, y, m0, groupLabel, items: [] })
      }
      const bucket = m.get(key)
      if (!bucket.items.some((x) => x.id === e.id)) {
        bucket.items.push(e)
      }
    }
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
      historyGroupingOpts.value.shiftStartMins,
      historyGroupingOpts.value.shiftEndMins,
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
 *   spanDays: number,
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

  const wwOpts = { ...historyGroupingOpts.value }

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
              historyGroupingOpts.value.shiftStartMins,
              historyGroupingOpts.value.shiftEndMins,
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
      spanDays:
        typeof g.meta.spanDays === 'number' &&
        Number.isFinite(g.meta.spanDays) &&
        g.meta.spanDays >= 1 &&
        g.meta.spanDays <= 7
          ? g.meta.spanDays
          : 7,
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

/** Per work-week FedEx pay-period buckets for Estimate pay (trips partitioned by Sun–Sat). */
const fedExEstimatePayRowsForWeek = computed(() => {
  /** @type {Record<string, { paycheckLabel: string, periodLabel: string, splitNote: string | null, estimateUsd: number, rows: ReturnType<typeof computeWeekPayEstimate>['rows'] }[]>} */
  const out = {}
  for (const wg of tripsByWorkWeek.value) {
    const periods = entriesByFedExPayPeriod(wg.items)
    const ws = wg.weekStartMs
    const spanDays =
      typeof wg.spanDays === 'number' && Number.isFinite(wg.spanDays) && wg.spanDays >= 1 && wg.spanDays <= 7
        ? wg.spanDays
        : 7
    const we = ws + spanDays * 24 * 60 * 60 * 1000 - 1
    out[wg.key] = periods.map((g) => {
      const est = computeWeekPayEstimate(g.items)
      const fri = fedExPaycheckFridayMs(g.meta.periodEndMs)
      const paycheckLabel = fri
        ? `Paycheck ${new Date(fri).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`
        : 'Paycheck —'
      let splitNote = null
      if (g.meta.periodStartMs < ws) {
        splitNote =
          'This FedEx pay period began before this work week — trips from the prior week are listed here (each trip counted once).'
      } else if (g.meta.periodEndMs > we) {
        splitNote =
          'This FedEx pay period continues after this work week — additional trips appear under the next work week (each trip counted once).'
      }
      return {
        paycheckLabel,
        periodLabel: `Period ${g.meta.labelShort}`,
        splitNote,
        estimateUsd: est.estimateUsd,
        rows: est.rows,
      }
    })
  }
  return out
})

/** Sum of FedEx pay-period estimates touching this work week ($1/mi per trip counted once). */
const payTotalEstimateUsdByWeekKey = computed(() => {
  const src = fedExEstimatePayRowsForWeek.value
  /** @type {Record<string, number>} */
  const out = {}
  for (const k of Object.keys(src)) {
    const buckets = src[k]
    let sum = 0
    for (const b of buckets) {
      sum += typeof b.estimateUsd === 'number' ? b.estimateUsd : 0
    }
    out[k] = sum
  }
  return out
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
  return dayPayEstimateByWeekDayKey.value[`${String(weekKey)}|${dk}`] || {
    estimateUsd: 0,
    sumBillable: 0,
    rows: [],
  }
}

const pdfGroupingLabel = computed(() => {
  if (historyWeekViewMode.value === 'paySchedule') {
    return 'FedEx pay schedule (Sun-Sat)'
  }
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const ws = workWeekFromCred.value.workWeekStartDay
  const we = workWeekFromCred.value.workWeekEndDay
  const a = DOW[Math.min(6, Math.max(0, ws))] ?? String(ws)
  const b = DOW[Math.min(6, Math.max(0, we))] ?? String(we)
  return `Configured work week (${a} - ${b})`
})

const pdfDriverInfoBlock = computed(() => {
  const lines = []
  const id =
    storedUsername.value.trim() ||
    String(pdfCredMeta.value.employeeNumber ?? '').trim()
  const name = String(pdfCredMeta.value.driverName ?? '').trim()
  if (id) lines.push(`Login / ID: ${id}`)
  if (name) lines.push(`Name: ${name}`)
  const d = linehaulDriverBody.value
  if (d && typeof d === 'object') {
    const loc =
      d.driverLocation != null ? String(d.driverLocation).trim() : ''
    const da =
      d.driverActvStat != null ? String(d.driverActvStat).trim() : ''
    const ds =
      d.driverAvlStat != null ? String(d.driverAvlStat).trim() : ''
    if (loc) lines.push(`Location: ${loc}`)
    if (da) lines.push(`Active: ${da}`)
    if (ds) lines.push(`Avail. status: ${ds}`)
  }
  return lines.length
    ? lines.join('\n')
    : 'Driver details not loaded - open Home after sign-in to refresh Linehaul.'
})

const pdfTruckInfoBlock = computed(() => {
  const lines = []
  const t = linehaulTractorBody.value
  if (t && typeof t === 'object') {
    const tn = t.tractorNbr != null ? String(t.tractorNbr).trim() : ''
    const lid = t.locationId != null ? String(t.locationId).trim() : ''
    const dom =
      t.tractorDomicileAbbrv != null
        ? String(t.tractorDomicileAbbrv).trim()
        : ''
    const act =
      t.detlCodeActvStat != null ? String(t.detlCodeActvStat).trim() : ''
    const avl =
      t.detlCodeAvailStat != null ? String(t.detlCodeAvailStat).trim() : ''
    if (tn) lines.push(`Tractor: ${tn}`)
    if (lid) lines.push(`Location ID: ${lid}`)
    if (dom) lines.push(`Domicile: ${dom}`)
    if (act) lines.push(`Active: ${act}`)
    if (avl) lines.push(`Avail. status: ${avl}`)
  }
  return lines.length
    ? lines.join('\n')
    : 'Tractor details not loaded - open Home after sign-in to refresh Linehaul.'
})

/**
 * @param {{
 *   key: string,
 *   groupLabel: string,
 *   days: { dayLabel: string, shiftDayKey: string, items: LedgerEntry[] }[],
 * }} wg
 */
async function onDownloadWeekTotalsPdf(wg) {
  const key = String(wg.key)
  if (pdfWeekBusyKey.value === key) return
  pdfWeekBusyKey.value = key
  try {
    const allRows = []
    const days = []
    for (const dg of wg.days) {
      const dk = dg.shiftDayKey ? String(dg.shiftDayKey) : 'unk'
      const est = dayPayEstimateFor(key, dk)
      const mappedRows = est.rows.map((r) => ({
        od: r.od,
        when: r.when,
        billableMi: r.billableMi,
        rounded: r.rounded,
        originId: r.originId,
        destId: r.destId,
        routeOd: r.routeOd,
        weekday: r.weekday,
        dispatchDate: r.dispatchDate,
        dispatchTime: r.dispatchTime,
        legLabel: r.legLabel,
        tractorNumber: r.tractorNumber,
        equipmentBlock: r.equipmentPdfBlock,
        dailyTripLegSequence: r.dailyTripLegSequence || '',
        proofScreenshots: /** @type {{ label: string, jpeg: string, ts: number }[] | undefined} */ (
          undefined
        ),
      }))
      days.push({ dayLabel: dg.dayLabel, sumBillable: est.sumBillable, rows: mappedRows })
      allRows.push(...mappedRows)
    }

    const legSeqs = [...new Set(allRows.map((r) => r.dailyTripLegSequence).filter(Boolean))]
    if (legSeqs.length) {
      const proofResults = await Promise.allSettled(legSeqs.map((s) => fetchDispatchProof(s)))
      /** @type {Map<string, { label: string, jpeg: string, ts: number }[]>} */
      const proofMap = new Map()
      proofResults.forEach((res, i) => {
        if (res.status === 'fulfilled' && res.value?.ok && Array.isArray(res.value.screenshots) && res.value.screenshots.length) {
          proofMap.set(legSeqs[i], res.value.screenshots)
        }
      })
      if (proofMap.size) {
        for (const r of allRows) {
          if (r.dailyTripLegSequence && proofMap.has(r.dailyTripLegSequence)) {
            r.proofScreenshots = proofMap.get(r.dailyTripLegSequence)
          }
        }
      }
    }

    const cal = viewMonthInfo.value.groupLabel || 'Calendar view'
    const estWeek =
      weekPayEstimateByKey.value[key] || {
        sumBillable: 0,
        rows: [],
      }
    downloadHistoryWeekTotalsPdf({
      documentTitle:
        historyWeekViewMode.value === 'paySchedule'
          ? 'FedEx pay schedule mileage report'
          : 'Weekly Mileage Report',
      driverBlock: pdfDriverInfoBlock.value,
      truckBlock: pdfTruckInfoBlock.value,
      weekRangeLabel: wg.groupLabel,
      calendarContext: cal,
      groupingModeLabel: pdfGroupingLabel.value,
      generatedAtMs: Date.now(),
      roundingBandMin: PAY_ROUND_BAND_MIN,
      roundingBandMax: PAY_ROUND_BAND_MAX,
      roundingToMi: PAY_ROUND_TO_MI,
      days,
      sumBillable: estWeek.sumBillable,
    })
  } catch (e) {
    console.error('[weekTotalsPdf]', e)
    window.alert(
      e instanceof Error ? e.message : 'Could not generate PDF. Try again.',
    )
  } finally {
    pdfWeekBusyKey.value = ''
  }
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

watch(historyWeekViewMode, () => {
  filterDayKey.value = ''
})

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
      historyGroupingOpts.value.shiftStartMins,
      historyGroupingOpts.value.shiftEndMins,
    )
    if (!k) continue
    counts[k] = (counts[k] || 0) + 1
  }
  return monthGridForCalendarMonth(/** @type {number} */(g.y), g.m0, counts, {
    shiftStartMins: historyGroupingOpts.value.shiftStartMins,
    shiftEndMins: historyGroupingOpts.value.shiftEndMins,
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

/** Dispatch time with weekday (for week totals / pay rows). */
function formatWhenWithWeekday(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString(undefined, {
      weekday: 'long',
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
  if (t === 'current') return 'Current'
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
  if (isHistoryRowActiveOngoingTrip(row)) return
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
  if (o === 'delivered' || o === 'rejected' || o === 'removed') {
    void setOutcome(e.dailyTripLegSequence, o)
  }
  nextTick(() => {
    closeOutcomeMenu()
  })
}

function clearHistoryHeaderLongPressTimer() {
  if (historyHeaderLongPressTimer != null) {
    clearTimeout(historyHeaderLongPressTimer)
    historyHeaderLongPressTimer = null
  }
}

/**
 * @param {LedgerEntry} e
 * @param {PointerEvent} ev
 */
function onHistoryTripSummaryPointerDown(e, ev) {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return
  if (!/^\d+$/.test(e.dailyTripLegSequence)) return
  if (isHistoryRowActiveOngoingTrip(e)) return
  const t = ev.target
  if (t instanceof Element && t.closest?.('button, a, input, select, textarea, .history-outcome-wrap')) {
    return
  }
  clearHistoryHeaderLongPressTimer()
  historyHeaderLongPressStartX = ev.clientX
  historyHeaderLongPressStartY = ev.clientY
  const el = ev.currentTarget
  if (el instanceof HTMLElement) {
    try {
      el.setPointerCapture(ev.pointerId)
    } catch {
      /* ignore */
    }
  }
  historyHeaderLongPressTimer = setTimeout(() => {
    historyHeaderLongPressTimer = null
    openDeleteModal(e)
    suppressHistorySummaryToggleUntil = Date.now() + HISTORY_HEADER_SUPPRESS_CLICK_MS
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(35)
      } catch {
        /* ignore */
      }
    }
  }, HISTORY_HEADER_LONG_PRESS_MS)
}

/** @param {PointerEvent} ev */
function onHistoryTripSummaryPointerMove(ev) {
  if (historyHeaderLongPressTimer == null) return
  const dx = ev.clientX - historyHeaderLongPressStartX
  const dy = ev.clientY - historyHeaderLongPressStartY
  if (dx * dx + dy * dy > HISTORY_HEADER_LONG_PRESS_MOVE_PX * HISTORY_HEADER_LONG_PRESS_MOVE_PX) {
    clearHistoryHeaderLongPressTimer()
  }
}

/** @param {PointerEvent} ev */
function onHistoryTripSummaryPointerEnd(ev) {
  clearHistoryHeaderLongPressTimer()
  const el = ev.currentTarget
  if (el instanceof HTMLElement) {
    try {
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Prevent `<details>` from toggling when delete modal was opened via long-press.
 * @param {MouseEvent} ev
 */
function onHistoryTripSummaryClickCapture(ev) {
  const t = ev.target
  if (t instanceof Element) {
    if (t.closest?.('button, a, input, select, textarea, .history-outcome-wrap')) return
  }
  if (Date.now() < suppressHistorySummaryToggleUntil) {
    ev.preventDefault()
    ev.stopPropagation()
  }
}

/**
 * Open the delete confirmation modal for a trip.
 * @param {LedgerEntry} e
 */
function openDeleteModal(e) {
  deleteTarget.value = e
  deleteUsernameInput.value = ''
  deleteError.value = ''
  deleteBusy.value = false
}

function closeDeleteModal() {
  deleteTarget.value = null
  deleteUsernameInput.value = ''
  deleteError.value = ''
  deleteBusy.value = false
}

function openManualTripModal() {
  manualTripModalOpen.value = true
  manualTripOrigin.value = ''
  manualTripDestination.value = ''
  manualTripNotes.value = ''
  manualTripAuditDate.value = isoDateFromMs(Date.now())
  manualTripBusy.value = false
  manualTripError.value = ''
}

function closeManualTripModal() {
  manualTripModalOpen.value = false
  manualTripError.value = ''
}

async function submitManualTrip() {
  const o = manualTripOrigin.value.trim()
  const d = manualTripDestination.value.trim()
  if (!o || !d) {
    manualTripError.value = 'Enter origin and destination.'
    return
  }
  manualTripBusy.value = true
  manualTripError.value = ''
  try {
    const bucketMs = localNoonMsFromIsoDate(
      manualTripAuditDate.value.trim() || isoDateFromMs(Date.now()),
    )
    await appendTripHistoryManual({
      dispatchHeader: {
        origin: o,
        destination: d,
      },
      tripDetails: manualTripNotes.value.trim()
        ? { notes: manualTripNotes.value.trim() }
        : {},
      historyAuditBucketMs: bucketMs,
    })
    closeManualTripModal()
    await load()
  } catch (err) {
    manualTripError.value = err instanceof Error ? err.message : 'Failed to add trip'
  } finally {
    manualTripBusy.value = false
  }
}

/**
 * @param {LedgerEntry} row
 */
function openAuditDayModal(row) {
  auditDayTarget.value = row
  auditDayDateStr.value = isoDateFromMs(row.displayDate)
  auditDayBusy.value = false
  auditDayError.value = ''
  auditDayModalOpen.value = true
}

function closeAuditDayModal() {
  auditDayModalOpen.value = false
  auditDayTarget.value = null
  auditDayError.value = ''
}

async function submitAuditDayMove() {
  const row = auditDayTarget.value
  if (!row) return
  auditDayBusy.value = true
  auditDayError.value = ''
  try {
    const ms = localNoonMsFromIsoDate(
      auditDayDateStr.value.trim() || isoDateFromMs(row.displayDate),
    )
    await patchTripHistoryAuditBucket({
      id: row.id,
      dailyTripLegSequence: row.dailyTripLegSequence,
      historyAuditBucketMs: ms,
    })
    closeAuditDayModal()
    await load()
  } catch (err) {
    auditDayError.value =
      err instanceof Error ? err.message : 'Could not update audit day'
  } finally {
    auditDayBusy.value = false
  }
}

async function clearAuditDayBucket() {
  const row = auditDayTarget.value
  if (!row) return
  auditDayBusy.value = true
  auditDayError.value = ''
  try {
    await patchTripHistoryAuditBucket({
      id: row.id,
      dailyTripLegSequence: row.dailyTripLegSequence,
      historyAuditBucketMs: null,
    })
    closeAuditDayModal()
    await load()
  } catch (err) {
    auditDayError.value =
      err instanceof Error ? err.message : 'Could not clear audit day'
  } finally {
    auditDayBusy.value = false
  }
}

async function confirmDeleteTrip() {
  if (!deleteTarget.value) return
  const inputVal = deleteUsernameInput.value.trim().toLowerCase()
  const storedVal = storedUsername.value.trim().toLowerCase()
  if (!storedVal) {
    deleteError.value = 'No username found in Settings. Cannot verify.'
    return
  }
  if (inputVal !== storedVal) {
    deleteError.value = 'Username does not match. Please enter your Driver ID from Settings.'
    return
  }
  deleteBusy.value = true
  deleteError.value = ''
  try {
    const del = deleteTarget.value
    const seq = String(del.dailyTripLegSequence ?? '').trim()
    if (/^\d+$/.test(seq)) {
      await deleteTripHistoryEntry({ dailyTripLegSequence: seq })
    } else {
      await deleteTripHistoryEntry({ dailyTripLegSequence: '', id: del.id })
    }
    entries.value = entries.value.filter((x) => {
      if (/^\d+$/.test(seq)) return x.dailyTripLegSequence !== seq
      return x.id !== del.id
    })
    closeDeleteModal()
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : 'Failed to delete trip'
  } finally {
    deleteBusy.value = false
  }
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
          class="history-mnav"
          title="Previous month"
          :disabled="loading"
          @click="goPrevViewMonth"
        >
          ←
        </button>
        <h2 class="history-month-h2">{{ viewMonthInfo.groupLabel }}</h2>
        <button
          type="button"
          class="history-mnav"
          title="Next month"
          :disabled="loading"
          @click="goNextViewMonth"
        >
          →
        </button>
      </div>
      <div class="history-week-mode" role="group" aria-label="Week grouping">
        <span
          class="history-week-mode__lab"
          :class="{ 'history-week-mode__lab--on': historyWeekViewMode === 'workWeek' }"
        >Work week</span>
        <button
          type="button"
          class="history-week-mode__switch tap"
          role="switch"
          :aria-checked="historyWeekViewMode === 'paySchedule'"
          :title="
            historyWeekViewMode === 'workWeek'
              ? 'Switch to FedEx pay schedule (Sun–Sat)'
              : 'Switch to your Settings work week'
          "
          @click="
            historyWeekViewMode =
              historyWeekViewMode === 'workWeek' ? 'paySchedule' : 'workWeek'
          "
        >
          <span class="history-week-mode__thumb" aria-hidden="true" />
        </button>
        <span
          class="history-week-mode__lab"
          :class="{ 'history-week-mode__lab--on': historyWeekViewMode === 'paySchedule' }"
        >Pay schedule</span>
      </div>
      <div class="history-manual-toolbar">
        <button
          type="button"
          class="history-link tap"
          @click="openManualTripModal"
        >
          + Add manual trip
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
            v-for="(wg, wgi) in tripsByWorkWeek"
            :key="wg.key"
            :ref="bindWwDetailsEl(wg.key)"
            :open="wgi === 0"
            class="history-ww-section history-fold"
            :aria-label="wg.groupLabel"
          >
            <summary class="history-ww-head history-fold__summary">
              <div class="history-ww-head-row">
                <h3 class="history-ww-title">{{ wg.groupLabel }}</h3>
                <div class="history-head-metrics">
                  <button
                    type="button"
                    class="history-week-download-btn tap"
                    :disabled="pdfWeekBusyKey === wg.key"
                    title="Download PDF summary for this work week"
                    @click.stop="onDownloadWeekTotalsPdf(wg)"
                  >
                    {{ pdfWeekBusyKey === wg.key ? 'Working…' : 'Download' }}
                  </button>
                  <span class="history-mile-pill">{{
                    mileageHeaderLine(wg.mileageSum, wg.tripsWithMileage)
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
                        mileageHeaderLine(dg.mileageSum, dg.tripsWithMileage)
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
                        :title="
                          e.dailyTripLegSequence
                            ? 'Tap to expand. Press and hold this header about half a second to delete this trip (you will confirm with your Driver ID).'
                            : 'Tap to expand.'
                        "
                        @pointerdown="(ev) => onHistoryTripSummaryPointerDown(e, ev)"
                        @pointermove="onHistoryTripSummaryPointerMove"
                        @pointerup="onHistoryTripSummaryPointerEnd"
                        @pointercancel="onHistoryTripSummaryPointerEnd"
                        @pointerleave="clearHistoryHeaderLongPressTimer"
                        @click.capture="onHistoryTripSummaryClickCapture"
                        @contextmenu.prevent
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
                              <span class="history-od-lab">Miles:</span>
                              <span class="history-od-id">{{ tripHeaderMilesValue(e) }}</span>
                              <template v-if="tripHeaderDurationHm(e)">
                                <span class="history-trip-od-sep" aria-hidden="true">·</span>
                                <span class="history-od-lab">Duration:</span>
                                <span class="history-od-id">{{ tripHeaderDurationHm(e) }}</span>
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
                                    :class="`history-outcome--${historyOutcomeUiSelectKey(e)}`"
                                    :disabled="
                                      historySavingId === `seq-${e.dailyTripLegSequence}` ||
                                      isHistoryRowActiveOngoingTrip(e)
                                    "
                                    :title="
                                      isHistoryRowActiveOngoingTrip(e)
                                        ? 'This leg matches your current trip — set outcome after FedEx clears it'
                                        : 'Tap to change: ' + outcomeLabel(historyOutcomeUiSelectKey(e))
                                    "
                                    :aria-expanded="outcomeMenuOpen === e.id"
                                    aria-haspopup="listbox"
                                    @click="toggleOutcomeMenu(e, e.id, $event)"
                                  >
                                    <span class="history-outcome-pill__txt">{{ outcomeLabel(historyOutcomeUiSelectKey(e)) }}</span>
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
                                ? `Press & hold header to delete trip · Leg #${e.dailyTripLegSequence}`
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
                            <span class="history-trip-meta-strip__sep" aria-hidden="true">·</span>
                            <button
                              type="button"
                              class="history-link tap history-audit-day-btn"
                              @click.stop="openAuditDayModal(e)"
                            >
                              Audit day…
                            </button>
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
                          v-for="(t, ti) in tripTrailersDecorated(e)"
                          :key="ti"
                          class="history-trailer-block"
                        >
                          <div class="history-trailer-line">
                            <span class="history-trailer-title">Trailer {{ t.order }}</span>
                            <span v-if="t.trlrNbr" class="history-trailer-nbr">#{{ t.trlrNbr }}</span>
                            <span class="history-badge">{{ t.size }}</span>
                            <span
                              v-if="t.loadBadge.text && t.loadBadge.text !== '—'"
                              class="history-badge history-badge--load"
                              :class="{
                                'history-badge--load-full': t.loadBadge.variant === 'full',
                                'history-badge--load-empty': t.loadBadge.variant === 'empty',
                              }"
                              >{{ t.loadBadge.text }}</span
                            >
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

            <details class="history-pay-fold history-fold history-pay-card" open>
              <summary class="history-pay-fold__summary history-fold__summary">
                <span class="history-pay-fold__title">Week totals</span>
              </summary>
              <div class="history-pay-body">
                <p class="history-pay-rules">
                  Billable miles per trip (same rounding as pay:
                  {{ PAY_ROUND_BAND_MIN }}–{{ PAY_ROUND_BAND_MAX }} mi → {{ PAY_ROUND_TO_MI }} mi). Missing mileage counts as 0 mi.
                </p>
                <ul class="history-pay-list" aria-label="Week mileage by trip">
                  <li
                    v-for="row in (weekPayEstimateByKey[wg.key] || { rows: [] }).rows"
                    :key="row.id"
                    class="history-pay-row"
                  >
                    <span class="history-pay-row__main">
                      <span class="history-pay-row__od">{{ row.od }}</span>
                      <span class="history-pay-row__when">{{ row.when }}</span>
                    </span>
                    <span class="history-pay-row__nums history-pay-row__nums--week-mi">
                      <span class="history-od-lab">Miles:</span>
                      <span class="history-od-id">{{ formatMilesSum(row.billableMi) }}</span>
                      <span v-if="row.rounded" class="history-pay-row__note history-pay-row__note--below-mi"
                        >{{ PAY_ROUND_BAND_MIN }}–{{ PAY_ROUND_BAND_MAX }} mi → {{ PAY_ROUND_TO_MI }} mi</span
                      >
                    </span>
                  </li>
                </ul>
                <div class="history-pay-total history-pay-total--mi">
                  <span>Week billable miles</span>
                  <strong>{{ formatMilesSum((weekPayEstimateByKey[wg.key] || { sumBillable: 0 }).sumBillable) }} mi</strong>
                </div>
              </div>
            </details>

            <details
              v-if="SHOW_PAY_TOTAL_SECTION"
              class="history-pay-fold history-pay-fold--pay-total history-fold history-pay-card"
              open
            >
              <summary class="history-pay-fold__summary history-fold__summary history-pay-fold__summary--pay">
                <span class="history-pay-fold__title">Pay total</span>
                <span class="history-pay-fold__pill">{{
                  formatUsdWhole(payTotalEstimateUsdByWeekKey[wg.key] ?? 0)
                }}</span>
              </summary>
              <div class="history-pay-body">
                <p class="history-pay-rules history-pay-rules--fedex">
                  FedEx Ground pay is typically weekly on <strong>Friday</strong> for the prior completed period.
                  Pay period: <strong>Sunday 12:00 AM – Saturday 11:59 PM</strong> (local). Direct deposit may post a day or two early depending on the bank.
                  Estimate uses <strong>$1 per billable mile</strong> (same rounding as week totals). Trips are grouped by FedEx pay period; each trip counts once.
                </p>
                <template v-if="(fedExEstimatePayRowsForWeek[wg.key] || []).length">
                  <div
                    v-for="(bucket, bi) in fedExEstimatePayRowsForWeek[wg.key]"
                    :key="`${wg.key}-fedex-${bi}`"
                    class="history-fedex-pay-bucket"
                  >
                    <p class="history-fedex-pay-bucket__head">
                      <span class="history-fedex-pay-bucket__period">{{ bucket.periodLabel }}</span>
                      <span class="history-fedex-pay-bucket__pay">{{ bucket.paycheckLabel }}</span>
                    </p>
                    <p v-if="bucket.splitNote" class="history-fedex-pay-bucket__split">{{ bucket.splitNote }}</p>
                    <ul class="history-pay-list" :aria-label="`${bucket.periodLabel} trips`">
                      <li
                        v-for="row in bucket.rows"
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
                      <span>Estimated pay this period</span>
                      <strong>{{ formatUsdWhole(bucket.estimateUsd) }}</strong>
                    </div>
                  </div>
                </template>
                <p v-else class="history-pay-rules">No trips in this work week for pay estimate.</p>
                <div class="history-pay-total history-pay-total--grand">
                  <span>Estimated pay (this work week)</span>
                  <strong>{{ formatUsdWhole(payTotalEstimateUsdByWeekKey[wg.key] ?? 0) }}</strong>
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

    <Teleport to="body">
      <div
        v-if="manualTripModalOpen"
        class="delete-modal-overlay"
        @click.self="closeManualTripModal"
      >
        <div
          class="delete-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-trip-modal-title"
        >
          <h2 id="manual-trip-modal-title" class="delete-modal-title">Add manual trip</h2>
          <p class="delete-modal-desc">
            For notes or trips not from FedEx dispatch. FedEx timestamps on other entries are unchanged.
          </p>
          <label class="history-modal-field">
            <span class="history-modal-label">Origin</span>
            <input
              v-model="manualTripOrigin"
              type="text"
              class="delete-modal-input"
              autocomplete="off"
            />
          </label>
          <label class="history-modal-field">
            <span class="history-modal-label">Destination</span>
            <input
              v-model="manualTripDestination"
              type="text"
              class="delete-modal-input"
              autocomplete="off"
            />
          </label>
          <label class="history-modal-field">
            <span class="history-modal-label">Notes (optional)</span>
            <textarea
              v-model="manualTripNotes"
              class="delete-modal-input history-modal-textarea"
              rows="2"
            />
          </label>
          <label class="history-modal-field">
            <span class="history-modal-label">Show under work day</span>
            <input v-model="manualTripAuditDate" type="date" class="delete-modal-input" />
          </label>
          <p v-if="manualTripError" class="delete-modal-error">{{ manualTripError }}</p>
          <div class="delete-modal-actions">
            <button
              type="button"
              class="delete-modal-btn delete-modal-btn--cancel"
              :disabled="manualTripBusy"
              @click="closeManualTripModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="delete-modal-btn delete-modal-btn--confirm"
              :disabled="
                manualTripBusy ||
                !manualTripOrigin.trim() ||
                !manualTripDestination.trim()
              "
              @click="submitManualTrip"
            >
              {{ manualTripBusy ? 'Saving…' : 'Add trip' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="auditDayModalOpen && auditDayTarget"
        class="delete-modal-overlay"
        @click.self="closeAuditDayModal"
      >
        <div
          class="delete-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-day-modal-title"
        >
          <h2 id="audit-day-modal-title" class="delete-modal-title">Audit work day</h2>
          <p class="delete-modal-desc">
            Move this row between calendar days for your records only. FedEx dispatch and completion times stay the same.
          </p>
          <p class="delete-modal-trip">
            <strong>{{ str(auditDayTarget.dispatchHeader?.origin) || '—' }}</strong>
            →
            <strong>{{ str(auditDayTarget.dispatchHeader?.destination) || '—' }}</strong>
          </p>
          <label class="history-modal-field">
            <span class="history-modal-label">Work day (grouping)</span>
            <input v-model="auditDayDateStr" type="date" class="delete-modal-input" />
          </label>
          <p v-if="auditDayError" class="delete-modal-error">{{ auditDayError }}</p>
          <div class="delete-modal-actions delete-modal-actions--wrap">
            <button
              type="button"
              class="delete-modal-btn delete-modal-btn--cancel"
              :disabled="auditDayBusy"
              @click="closeAuditDayModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="delete-modal-btn delete-modal-btn--confirm"
              :disabled="auditDayBusy || !auditDayTarget?.historyAuditBucketMs"
              @click="clearAuditDayBucket"
            >
              Use FedEx dates
            </button>
            <button
              type="button"
              class="delete-modal-btn delete-modal-btn--confirm"
              :disabled="auditDayBusy"
              @click="submitAuditDayMove"
            >
              {{ auditDayBusy ? 'Saving…' : 'Apply' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="deleteTarget"
        class="delete-modal-overlay"
        @click.self="closeDeleteModal"
      >
        <div class="delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <h2 id="delete-modal-title" class="delete-modal-title">Delete Trip</h2>
          <p class="delete-modal-desc">
            Are you sure you want to delete this trip?
          </p>
          <p class="delete-modal-trip">
            <strong>{{ str(deleteTarget.dispatchHeader?.origin) || '—' }}</strong>
            →
            <strong>{{ str(deleteTarget.dispatchHeader?.destination) || '—' }}</strong>
            <span v-if="deleteTarget.dailyTripLegSequence" class="delete-modal-seq">
              (Leg {{ deleteTarget.dailyTripLegSequence }})
            </span>
          </p>
          <p class="delete-modal-warn">
            To confirm, enter your Driver ID (username from Settings):
          </p>
          <input
            v-model="deleteUsernameInput"
            type="text"
            class="delete-modal-input"
            placeholder="Enter your Driver ID"
            autocomplete="off"
            @keyup.enter="confirmDeleteTrip"
          />
          <p v-if="deleteError" class="delete-modal-error">{{ deleteError }}</p>
          <div class="delete-modal-actions">
            <button
              type="button"
              class="delete-modal-btn delete-modal-btn--cancel"
              :disabled="deleteBusy"
              @click="closeDeleteModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="delete-modal-btn delete-modal-btn--confirm"
              :disabled="deleteBusy || !deleteUsernameInput.trim()"
              @click="confirmDeleteTrip"
            >
              {{ deleteBusy ? 'Deleting…' : 'Delete Trip' }}
            </button>
          </div>
        </div>
      </div>
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  width: 100%;
  padding: 0.35rem 0.25rem;
  margin-bottom: 0.15rem;
}

.history-week-mode {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.15rem 0.35rem 0.45rem;
  flex-wrap: wrap;
}

.history-week-mode__lab {
  font-size: 0.58rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6e6e7e;
  white-space: nowrap;
}

.history-week-mode__lab--on {
  color: #c8c4dc;
}

.history-week-mode__switch {
  position: relative;
  width: 2.65rem;
  height: 1.35rem;
  padding: 0;
  border-radius: 999px;
  border: 1px solid #3a3a48;
  background: #1e1e28;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 120ms ease, border-color 120ms ease;
  -webkit-tap-highlight-color: transparent;
}

.history-week-mode__switch:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.55);
  outline-offset: 2px;
}

.history-week-mode__switch[aria-checked='true'] {
  background: rgba(99, 102, 241, 0.35);
  border-color: rgba(129, 140, 248, 0.65);
}

.history-week-mode__thumb {
  position: absolute;
  top: 50%;
  left: 0.12rem;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  background: #f4f4f8;
  transform: translateY(-50%);
  transition: transform 160ms ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}

.history-week-mode__switch[aria-checked='true'] .history-week-mode__thumb {
  transform: translate(1.28rem, -50%);
}

.history-mnav {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  min-height: 2.25rem;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  box-shadow: none;
  color: #ffffff;
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: opacity var(--duration-fast, 100ms) var(--ease-out, ease),
    transform var(--duration-fast, 100ms) var(--ease-out, ease);
}

.history-mnav:hover:not(:disabled) {
  opacity: 0.92;
}

.history-mnav:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.55);
  outline-offset: 2px;
}

.history-mnav:active:not(:disabled) {
  transform: scale(0.96);
  opacity: 0.85;
}

.history-mnav:disabled {
  opacity: 0.35;
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

.history-week-download-btn {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 0.32rem 0.65rem;
  border-radius: 8px;
  border: 1px solid rgba(124, 92, 255, 0.55);
  background: rgba(124, 92, 255, 0.16);
  color: #ece8ff;
  cursor: pointer;
}

.history-week-download-btn:hover:not(:disabled) {
  background: rgba(124, 92, 255, 0.26);
}

.history-week-download-btn:focus-visible {
  outline: 2px solid rgba(167, 139, 250, 0.85);
  outline-offset: 2px;
}

.history-week-download-btn:disabled {
  opacity: 0.55;
  cursor: wait;
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

.history-pay-card {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
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

.history-pay-fold__summary--pay {
  justify-content: space-between !important;
}

.history-week-download-btn {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.32rem 0.65rem;
  border-radius: 8px;
  border: 1px solid rgba(124, 92, 255, 0.55);
  background: rgba(124, 92, 255, 0.16);
  color: #ece8ff;
  cursor: pointer;
}

.history-week-download-btn:hover:not(:disabled) {
  background: rgba(124, 92, 255, 0.26);
  border-color: rgba(167, 139, 250, 0.75);
}

.history-week-download-btn:focus-visible {
  outline: 2px solid rgba(167, 139, 250, 0.85);
  outline-offset: 2px;
}

.history-week-download-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.history-pay-fold__pill {
  flex-shrink: 0;
  font-size: 0.62rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  padding: 0.14rem 0.42rem;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.14);
  border: 1px solid rgba(34, 197, 94, 0.45);
  color: #bbf7d0;
}

.history-pay-fold--pay-total > .history-pay-fold__summary {
  background: rgba(124, 92, 255, 0.08);
  border-bottom-color: #3a3a4a;
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

.history-pay-row__nums--week-mi {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.18rem 0.35rem;
  max-width: 11rem;
}

.history-pay-row__note--below-mi {
  flex-basis: 100%;
  text-align: right;
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

.history-pay-total--grand {
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top-width: 2px;
  border-top-color: #3d3d4c;
}

.history-pay-total--grand strong {
  font-size: 0.85rem;
  color: #86efac;
}

.history-pay-fold--estimate > .history-pay-fold__summary {
  background: rgba(124, 92, 255, 0.08);
  border-bottom-color: #3a3a4a;
}

.history-pay-rules--fedex {
  line-height: 1.45;
}

.history-fedex-pay-bucket {
  margin-top: 0.55rem;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  border: 1px solid #333340;
  background: rgba(0, 0, 0, 0.2);
}

.history-fedex-pay-bucket:first-of-type {
  margin-top: 0.25rem;
}

.history-fedex-pay-bucket__head {
  margin: 0 0 0.35rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.35rem 0.65rem;
  font-size: 0.65rem;
  font-weight: 700;
  color: #c4c4d4;
}

.history-fedex-pay-bucket__period {
  font-weight: 800;
  color: #e8e8f4;
}

.history-fedex-pay-bucket__pay {
  font-size: 0.58rem;
  font-weight: 700;
  color: #a7f3d0;
}

.history-fedex-pay-bucket__split {
  margin: 0 0 0.4rem;
  font-size: 0.58rem;
  line-height: 1.35;
  color: #8a8a9a;
  font-style: italic;
}

.history-pay-total--mi strong {
  color: #c4b5fd;
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
.history-outcome-pill.history-outcome--current {
  border-color: #6d28d9;
  color: #ddd6fe;
  background: rgba(109, 40, 217, 0.22);
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

.history-badge--load.history-badge--load-empty {
  background: rgba(156, 163, 175, 0.08);
  color: #b8bcc8;
  border-color: rgba(156, 163, 175, 0.22);
}

.history-badge--load.history-badge--load-full {
  background: rgba(34, 197, 94, 0.12);
  color: #86efac;
  border-color: rgba(34, 197, 94, 0.35);
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

.delete-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.delete-modal {
  background: #18181f;
  border-radius: 14px;
  border: 1px solid #3a3a48;
  padding: 1.25rem 1.35rem;
  max-width: 22rem;
  width: 100%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.delete-modal-title {
  margin: 0 0 0.65rem;
  font-size: 1rem;
  font-weight: 700;
  color: #f87171;
}

.delete-modal-desc {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  color: #c8c8d4;
  line-height: 1.4;
}

.delete-modal-trip {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  color: #e4e4f0;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.delete-modal-seq {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.68rem;
  color: #8a8a9c;
}

.delete-modal-warn {
  margin: 0 0 0.5rem;
  font-size: 0.72rem;
  color: #fbbf24;
  line-height: 1.4;
}

.delete-modal-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid #3a3a48;
  background: #0e0e14;
  color: #f4f4f8;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.delete-modal-input:focus {
  outline: none;
  border-color: #a78bfa;
}

.delete-modal-error {
  margin: 0 0 0.5rem;
  font-size: 0.72rem;
  color: #f87171;
  line-height: 1.35;
}

.delete-modal-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.75rem;
}

.delete-modal-btn {
  padding: 0.5rem 0.85rem;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
}

.delete-modal-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.delete-modal-btn--cancel {
  background: #2a2a34;
  color: #c8c8d4;
  border-color: #3a3a48;
}

.delete-modal-btn--confirm {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.4);
}

.delete-modal-btn--confirm:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.3);
}

.history-manual-toolbar {
  margin-top: var(--space-3, 0.75rem);
  margin-bottom: var(--space-2, 0.5rem);
}

.history-modal-field {
  display: block;
  margin-bottom: var(--space-3, 0.75rem);
}

.history-modal-label {
  display: block;
  font-size: 0.78rem;
  margin-bottom: var(--space-1, 0.25rem);
  color: var(--color-text-secondary, #a8a8b8);
}

.history-modal-textarea {
  min-height: 3.25rem;
  resize: vertical;
}

.delete-modal-actions--wrap {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.history-audit-day-btn {
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
}
</style>
