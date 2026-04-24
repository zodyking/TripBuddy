<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { getAssignment, getCredentials, patchTripHistoryOutcome, getDollyRegistry, patchDollyRating } from '../api.js'
import { workWeekGroupMeta, dayStripForWeek, localDateKey } from '../utils/workWeekGroup.js'
import { copyTextToClipboard } from '../utils/copyToClipboard.js'

/**
 * @typedef {object} LedgerEntry
 * @property {string} id
 * @property {string} [source]
 * @property {number} displayDate
 * @property {number} completedAt
 * @property {string} dailyTripLegSequence
 * @property {string} [outcome]
 * @property {Record<string, unknown>} dispatchHeader
 * @property {Record<string, unknown>} tripDetails
 */

const workWeekFromCred = ref({ workWeekStartDay: 0, workWeekEndDay: 6 })

const loading = ref(true)
const error = ref('')
/** @type {import('vue').Ref<LedgerEntry[]>} */
const entries = ref([])

const openId = ref('')
const openWeekKey = ref('')

const DOUBLE_CLICK_MS = 500

/** YYYY-MM-DD; empty = show all days in selected work week */
const filterDayKey = ref('')
const outcomeMenuOpen = ref('')

const dollyList = ref(/** @type {Array<{ nbr: string, rating?: string, lastSeenAt?: number }>} */ ([]))

/**
 * @param {unknown} x
 */
function normalizeOutcome(x) {
  if (x == null) return ''
  const t = String(x).trim().toLowerCase()
  if (t === 'delivered' || t === 'rejected' || t === 'removed' || t === 'none') return t
  return ''
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const c = await getCredentials()
    const ws = typeof c.workWeekStartDay === 'number' ? c.workWeekStartDay : 0
    const we = typeof c.workWeekEndDay === 'number' ? c.workWeekEndDay : 6
    workWeekFromCred.value = {
      workWeekStartDay: Math.min(6, Math.max(0, Math.floor(ws))),
      workWeekEndDay: Math.min(6, Math.max(0, Math.floor(we))),
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
        const displayDate = comp || rec
        const seq = String(x.dailyTripLegSequence ?? '').trim()
        const legKey = /^\d+$/.test(seq) ? seq : ''
        const oRaw = /** @type {any} */ (x)
        const o =
          typeof oRaw.outcome === 'string' && oRaw.outcome
            ? normalizeOutcome(oRaw.outcome)
            : typeof oRaw.dispatchHeader === 'object' && oRaw.dispatchHeader
              ? normalizeOutcome(/** @type {any} */ (oRaw.dispatchHeader).historyOutcome)
              : ''
        const e = {
          id: String(x.id ?? ''),
          source: typeof x.source === 'string' ? x.source : 'complete',
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
        if (!cur || (e.displayDate || 0) > (cur.displayDate || 0)) {
          byLeg.set(legKey, e)
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
    loading.value = false
  }
  void loadDolly()
}

const sorted = computed(() =>
  [...entries.value].sort((a, b) => b.displayDate - a.displayDate),
)

/** @typedef {{ key: string, groupLabel: string, sortKey: number, items: LedgerEntry[]}} WeekGroup */
const weekGroups = computed(() => {
  const list = sorted.value
  const wwm = { ...workWeekFromCred.value }
  /** @type {Map<string, { key: string, groupLabel: string, endMs: number, weekStart: number, items: LedgerEntry[] }>} */
  const m = new Map()
  for (const e of list) {
    const w = workWeekGroupMeta(e.displayDate, wwm)
    const key = w ? w.key : 'unknown'
    const groupLabel = w
      ? w.groupLabel
      : 'No date or invalid timestamp'
    const endMs = w ? w.endMs : 0
    const wkStart = w ? w.weekStart : 0
    if (!m.has(key)) {
      m.set(key, { key, groupLabel, endMs, weekStart: wkStart, items: [] })
    }
    m.get(key).items.push(e)
  }
  const arr = [...m.values()]
  for (const g of arr) {
    g.items.sort((a, b) => b.displayDate - a.displayDate)
  }
  arr.sort((a, b) => b.weekStart - a.weekStart)
  return arr.map((g) => ({
    key: g.key,
    groupLabel: g.groupLabel,
    sortKey: g.items[0]?.displayDate ?? 0,
    weekStartMs: g.weekStart,
    items: g.items,
  }))
})

const activeWeekGroup = computed(() => {
  if (!weekGroups.value.length) return null
  const w = weekGroups.value.find((g) => g.key === openWeekKey.value)
  return w || weekGroups.value[0]
})

const dayStrip = computed(() => {
  const w = activeWeekGroup.value
  if (w == null || typeof w.weekStartMs !== 'number') return []
  return dayStripForWeek(/** @type {number} */ (w.weekStartMs))
})

const weekFilteredItems = computed(() => {
  const w = activeWeekGroup.value
  if (!w) return []
  if (!filterDayKey.value) return w.items
  return w.items.filter(
    (e) =>
      e.displayDate && localDateKey(/** @type {number} */(e.displayDate)) === filterDayKey.value,
  )
})

function closeOutcomeMenu() {
  outcomeMenuOpen.value = ''
}

function toggleOutcomeMenu(id) {
  outcomeMenuOpen.value = outcomeMenuOpen.value === id ? '' : id
}

async function loadDolly() {
  try {
    const d = await getDollyRegistry()
    const it = d?.items && typeof d.items === 'object' ? d.items : {}
    dollyList.value = Object.values(it)
      .filter((x) => x && typeof (/** @type {any} */(x).nbr) === 'string')
      .map((x) => ({
        nbr: String((/** @type {any} */(x)).nbr),
        rating: (/** @type {any} */(x)).rating,
        lastSeenAt: (/** @type {any} */(x)).lastSeenAt,
      }))
      .sort(
        (a, b) =>
          (b.lastSeenAt || 0) - (a.lastSeenAt || 0),
      )
  } catch {
    dollyList.value = []
  }
}

/**
 * @param {string} n
 * @param {'none' | 'good' | 'bad'} r
 */
async function rateDolly(n, r) {
  if (!/^\d{6}$/.test(n)) return
  try {
    await patchDollyRating({ dollyNbr: n, rating: r })
    await loadDolly()
  } catch {
    /* */
  }
}

/**
 * @param {string} n
 */
function copyDollyN(n) {
  const t = String(n).replace(/\D/g, '').slice(0, 6)
  if (t.length !== 6) return
  void copyTextToClipboard(t)
}

watch(
  weekGroups,
  (groups) => {
    if (!groups.length) {
      openId.value = ''
      openWeekKey.value = ''
      filterDayKey.value = ''
      return
    }
    if (!groups.some((g) => g.key === openWeekKey.value)) {
      openWeekKey.value = groups[0].key
    }
    filterDayKey.value = ''
    if (!sorted.value.some((e) => e.id === openId.value)) {
      const firstG = groups.find((g) => g.key === openWeekKey.value) || groups[0]
      openId.value = firstG?.items[0]?.id || ''
    }
  },
  { immediate: true },
)

function formatWhen(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString()
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

/**
 * @param {LedgerEntry} e
 * @param {string} o
 * @param {Event} [ev]
 */
function pickOutcome(e, o, ev) {
  ev?.stopPropagation()
  if (!/^\d+$/.test(e.dailyTripLegSequence)) return
  void setOutcome(e.dailyTripLegSequence, o)
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
  const o = (e.outcome && String(e.outcome)) || 'none'
  const next =
    o === 'none'
      ? 'delivered'
      : o === 'delivered'
        ? 'rejected'
        : o === 'rejected'
          ? 'removed'
          : o === 'removed'
            ? 'none'
            : 'delivered'
  void setOutcome(s, next)
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeOutcomeMenu)
  }
  void load()
  void loadDolly()
})

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', closeOutcomeMenu)
  }
})
</script>

<template>
  <div class="history-view">
    <header class="history-head">
      <h1 class="history-title">History</h1>
      <p class="history-sub">
        Work weeks come from Settings. Use the <strong>calendar strip</strong> to focus one day, or All week.
        Double-click a trip’s header to cycle the stop outcome. Dolly list is your registry — tap a number to copy, rate
        with 👍/👎, sync updates from the active load automatically.
      </p>
      <button type="button" class="history-refresh tap" :disabled="loading" @click="load">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="history-err">{{ error }}</p>
    <p v-else-if="!loading && weekGroups.length === 0" class="history-empty">
      No history yet. Trips are saved automatically from the API after each Linehaul refresh.
    </p>

    <ul v-else class="history-weeks" aria-label="Trip history by week">
      <li v-for="g in weekGroups" :key="g.key" class="history-week">
        <details
          :open="openWeekKey === g.key"
          class="history-week-drop"
          @toggle="
            (ev) => {
              const d = /** @type {HTMLDetailsElement} */ (ev.target)
              if (d.open) {
                openWeekKey = g.key
                filterDayKey = ''
                if (!g.items.some((x) => x.id === openId)) {
                  openId = g.items[0]?.id || ''
                }
              } else if (openWeekKey === g.key) {
                openWeekKey = ''
                filterDayKey = ''
              }
            }
          "
        >
          <summary class="history-week-summary">
            <div class="history-week-head-titles">
              <span class="history-week-title">{{ g.groupLabel }}</span>
              <span v-if="typeof g.weekStartMs === 'number'" class="history-week-iso-badge">
                Week of {{ new Date(/** @type {number} */(g.weekStartMs)).toLocaleDateString() }}
              </span>
            </div>
            <div class="history-week-meta">
              <span class="history-week-count">{{ g.items.length }} in week</span>
            </div>
          </summary>
          <div v-if="g.key === openWeekKey && dayStrip.length" class="history-day-rail" role="group" aria-label="Filter by day in this work week">
            <button
              type="button"
              class="history-day-chip history-day-chip--all tap"
              :class="{ 'history-day-chip--on': !filterDayKey }"
              @click="filterDayKey = ''"
            >
              <span class="dow">All</span>
              <span class="dom">All week</span>
            </button>
            <button
              v-for="d in dayStrip"
              :key="d.key"
              type="button"
              class="history-day-chip tap"
              :class="{
                'history-day-chip--on': filterDayKey === d.key,
                'history-day-chip--today': d.key === localDateKey(Date.now()),
              }"
              @click="filterDayKey = d.key"
            >
              <span class="dow">{{ d.dowLabel }}</span>
              <span class="dom">{{ d.label }}</span>
            </button>
          </div>
          <p v-if="g.key === openWeekKey" class="history-trips-count">
            <template v-if="filterDayKey">Showing {{ weekFilteredItems.length }} on selected day (of {{ g.items.length }})</template>
            <template v-else>Showing all {{ g.items.length }} in this work week</template>
          </p>
          <aside
            v-if="g.key === openWeekKey && dollyList.length"
            class="history-dolly-aside"
            @click.stop
            @keydown.stop
          >
            <h2 class="history-dolly-h">Your dollies (tap to copy · 👍/👎)</h2>
            <ul class="history-dolly-ul">
              <li v-for="d in dollyList.slice(0, 20)" :key="d.nbr" class="history-dolly-row">
                <button type="button" class="history-dolly-nbr tap" @click="copyDollyN(d.nbr)">#{{ d.nbr }}</button>
                <span
                  v-if="d.rating && d.rating !== 'none'"
                  class="history-dolly-stat"
                >{{ d.rating === 'good' ? '· good' : '· bad' }}</span>
                <div class="history-dolly-acts" @click.stop>
                  <button type="button" class="history-dolly-ico tap" title="Good" @click="rateDolly(d.nbr, 'good')">👍</button>
                  <button type="button" class="history-dolly-ico tap" title="Bad" @click="rateDolly(d.nbr, 'bad')">👎</button>
                  <button type="button" class="history-dolly-ico tap" title="Clear" @click="rateDolly(d.nbr, 'none')">·</button>
                </div>
              </li>
            </ul>
          </aside>
          <ul
            class="history-list history-list--nested"
            :aria-label="`Trips in ${g.groupLabel}`"
          >
            <li
              v-for="e in (g.key === openWeekKey ? weekFilteredItems : g.items)"
              :id="`history-card-${e.id}`"
              :key="e.id"
              class="history-card"
            >
        <details
          :open="openId === e.id"
          class="history-drop"
          @toggle="
            (ev) => {
              const d = /** @type {HTMLDetailsElement} */ (ev.target)
              if (d.open) {
                openId = e.id
                openWeekKey = g.key
              } else if (openId === e.id) openId = ''
            }
          "
        >
          <summary
            class="history-card-summary"
            @dblclick.stop.prevent="onRowDoubleClick(e)"
            @click.stop
          >
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
            <time
              class="history-date"
              :datetime="new Date(e.displayDate).toISOString()"
              >{{ formatWhen(e.displayDate) }}</time
            >
            <div v-if="e.dailyTripLegSequence" class="history-top-actions" @click.stop>
              <span
                v-if="e.outcome && e.outcome !== 'none'"
                class="history-outcome"
                :class="`history-outcome--${e.outcome}`"
                >{{ outcomeLabel(e.outcome) }}</span
              >
              <div class="history-gearbox">
                <div
                  v-if="outcomeMenuOpen === e.id"
                  class="history-outcome-menu"
                  @click.stop
                  @pointerdown.stop
                  @pointerup.stop
                >
                  <button
                    v-for="opt in [
                      { k: 'delivered', t: 'Delivered' },
                      { k: 'rejected', t: 'Rejected' },
                      { k: 'removed', t: 'Removed' },
                      { k: 'none', t: 'None' },
                    ]"
                    :key="opt.k"
                    type="button"
                    class="history-outcome-mi"
                    :disabled="historySavingId === `seq-${e.dailyTripLegSequence}`"
                    @click="pickOutcome(e, opt.k, $event)"
                  >
                    {{ opt.t }}
                  </button>
                </div>
                <button
                  type="button"
                  class="history-gear tap"
                  :title="`Set stop outcome`"
                  @click="toggleOutcomeMenu(e.id); $event.stopPropagation()"
                >
                  ⛭
                </button>
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
        </details>
      </li>
    </ul>
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
  margin-bottom: var(--space-4, 1rem);
}

.history-title {
  margin: 0 0 0.35rem;
  font-size: var(--text-xl, 1.25rem);
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
}

.history-sub {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-text-secondary, #a8a8b8);
  line-height: 1.45;
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

.history-err {
  color: #f87171;
  font-size: var(--text-sm, 0.8125rem);
}

.history-empty {
  color: var(--color-text-tertiary, #6e6e7e);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.5;
}

.history-weeks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 0.75rem);
}

.history-week {
  list-style: none;
}

.history-week-drop {
  list-style: none;
  border: 1px solid #2e2e36;
  border-radius: 14px;
  background: #14141a;
  overflow: hidden;
}

.history-week-summary {
  list-style: none;
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  padding: 0.75rem 2.1rem 0.65rem 0.9rem;
  cursor: pointer;
  user-select: none;
  background: linear-gradient(180deg, #1e1e28 0%, #18181f 100%);
  border-bottom: 1px solid #2a2a34;
}

.history-week-summary::-webkit-details-marker {
  display: none;
}

.history-week-summary::after {
  content: '▾';
  position: absolute;
  right: 0.85rem;
  top: 0.8rem;
  font-size: 0.7rem;
  color: #8a8a98;
  pointer-events: none;
}

.history-week-drop[open] .history-week-summary::after {
  content: '▴';
}

.history-week-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-primary, #f0f0f8);
  line-height: 1.35;
  max-width: calc(100% - 5rem);
  padding-right: 0.5rem;
}
.history-week-head-titles {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  flex: 1;
}
.history-week-iso-badge {
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #7a7a8a;
}
.history-week-meta {
  flex: 0 0 auto;
}

.history-week-count {
  font-size: 0.72rem;
  font-weight: 600;
  color: #9ca3af;
}
.history-day-rail {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.5rem 0.65rem 0.3rem;
  background: #12121a;
  border-bottom: 1px solid #2a2a32;
  align-items: center;
}
.history-day-chip {
  min-width: 2.2rem;
  min-height: 2.4rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  border-radius: 8px;
  border: 1px solid #34343c;
  background: #1a1a20;
  color: #a8a8b8;
  font-size: 0.6rem;
  line-height: 1.1;
  font-weight: 600;
  cursor: pointer;
  padding: 0.2rem 0.28rem;
}
.history-day-chip .dow {
  font-size: 0.5rem;
  text-transform: uppercase;
  color: #6a6a78;
}
.history-day-chip .dom {
  font-size: 0.85rem;
  font-weight: 800;
  color: #e8e8f0;
}
.history-day-chip--on {
  border-color: #7b4db5;
  background: rgba(123, 77, 181, 0.22);
  color: #e0d0ff;
}
.history-day-chip--on .dow,
.history-day-chip--on .dom {
  color: #f0e6ff;
}
.history-day-chip--today:not(.history-day-chip--on) {
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.35);
}
.history-day-chip--all .dom {
  font-size: 0.6rem;
  text-transform: uppercase;
}
.history-trips-count {
  margin: 0;
  padding: 0.2rem 0.75rem 0.4rem;
  font-size: 0.6rem;
  color: #6a6a78;
}
.history-dolly-aside {
  margin: 0 0.55rem 0.4rem;
  padding: 0.5rem 0.6rem 0.55rem;
  border: 1px solid #2f2f3a;
  border-radius: 10px;
  background: #16161e;
}
.history-dolly-h {
  margin: 0 0 0.4rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9a9ab0;
  font-weight: 700;
}
.history-dolly-ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.history-dolly-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.45rem;
  font-size: 0.72rem;
  color: #b8b8c8;
}
.history-dolly-nbr {
  font-size: 0.85rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  border: 1px solid #3c3c48;
  background: #1b1b22;
  color: #f0f0f8;
  border-radius: 6px;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
}
.history-dolly-stat {
  color: #7a7a8a;
  font-size: 0.64rem;
}
.history-dolly-acts {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: auto;
}
.history-dolly-ico {
  min-width: 1.5rem;
  min-height: 1.5rem;
  font-size: 0.7rem;
  line-height: 1;
  border: 1px solid #3a3a44;
  border-radius: 5px;
  background: #1a1a1f;
  cursor: pointer;
  color: #c0c0d0;
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
  padding: 0.65rem 0.55rem 0.85rem;
  gap: 0.65rem;
  background: #0f0f14;
}

.history-card {
  border: 1px solid #34343e;
  border-radius: 12px;
  background: #1a1a22;
  overflow: hidden;
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

.history-date {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary, #b8b8c8);
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
.history-gear {
  min-width: 1.6rem;
  min-height: 1.6rem;
  line-height: 1;
  border-radius: 6px;
  border: 1px solid #3a3a46;
  background: #1e1e25;
  color: #9a9ab0;
  font-size: 0.7rem;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.history-outcome-menu {
  position: absolute;
  z-index: 4;
  display: flex;
  flex-direction: column;
  right: 0;
  top: auto;
  bottom: calc(100% + 6px);
  min-width: 9.5rem;
  border: 1px solid #3f3f4c;
  border-radius: 8px;
  background: #1c1c25;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
  padding: 0.2rem 0;
}
.history-outcome-mi {
  text-align: left;
  width: 100%;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.4rem 0.65rem;
  border: none;
  background: transparent;
  color: #d8d8e6;
  cursor: pointer;
}
.history-outcome-mi:hover {
  background: #2a2a35;
}
.history-outcome-mi:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.history-top-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  flex: 0 0 auto;
  max-width: 11rem;
}
.history-gearbox {
  position: relative;
  flex: 0 0 auto;
}

.history-seq {
  font-size: 0.65rem;
  color: var(--color-text-tertiary, #6e6e7e);
  line-height: 1.3;
}

.history-outcome {
  align-self: flex-end;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  border: 1px solid #3f3f4c;
  background: rgba(255, 255, 255, 0.04);
  color: #a8a8b8;
}

.history-outcome--delivered {
  border-color: #166534;
  color: #86efac;
  background: rgba(22, 101, 52, 0.25);
}

.history-outcome--rejected {
  border-color: #991b1b;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
}

.history-outcome--removed {
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
