<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { getAssignment } from '../api.js'
import { weekGroupMeta } from '../utils/historyWeekGroup.js'

/**
 * @typedef {object} LedgerEntry
 * @property {string} id
 * @property {string} [source]
 * @property {number} displayDate
 * @property {number} completedAt
 * @property {string} dailyTripLegSequence
 * @property {Record<string, unknown>} dispatchHeader
 * @property {Record<string, unknown>} tripDetails
 */

const loading = ref(true)
const error = ref('')
/** @type {import('vue').Ref<LedgerEntry[]>} */
const entries = ref([])

const openId = ref('')
const openWeekKey = ref('')

async function load() {
  loading.value = true
  error.value = ''
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
        const e = {
          id: String(x.id ?? ''),
          source: typeof x.source === 'string' ? x.source : 'complete',
          displayDate,
          completedAt: comp,
          dailyTripLegSequence: seq,
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
}

const sorted = computed(() =>
  [...entries.value].sort((a, b) => b.displayDate - a.displayDate),
)

/** @typedef {{ key: string, groupLabel: string, sortKey: number, items: LedgerEntry[]}} WeekGroup */
const weekGroups = computed(() => {
  const list = sorted.value
  /** @type {Map<string, { key: string, groupLabel: string, endMs: number, items: LedgerEntry[] }>} */
  const m = new Map()
  for (const e of list) {
    const w = weekGroupMeta(e.displayDate)
    const key = w ? w.key : 'unknown'
    const groupLabel = w
      ? w.groupLabel
      : 'No date or invalid timestamp'
    const endMs = w ? w.endMs : 0
    if (!m.has(key)) {
      m.set(key, { key, groupLabel, endMs, items: [] })
    }
    m.get(key).items.push(e)
  }
  const arr = [...m.values()]
  for (const g of arr) {
    g.items.sort((a, b) => b.displayDate - a.displayDate)
  }
  arr.sort((a, b) => {
    const aMax = a.items[0]?.displayDate ?? 0
    const bMax = b.items[0]?.displayDate ?? 0
    if (aMax !== bMax) return bMax - aMax
    if (a.endMs !== b.endMs) return b.endMs - a.endMs
    return b.key.localeCompare(a.key)
  })
  return arr.map((g) => ({
    key: g.key,
    groupLabel: g.groupLabel,
    sortKey: g.items[0]?.displayDate ?? 0,
    items: g.items,
  }))
})

watch(
  weekGroups,
  (groups) => {
    if (!groups.length) {
      openId.value = ''
      openWeekKey.value = ''
      return
    }
    if (!groups.some((g) => g.key === openWeekKey.value)) {
      openWeekKey.value = groups[0].key
    }
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

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="history-view">
    <header class="history-head">
      <h1 class="history-title">History</h1>
      <p class="history-sub">
        Trip snapshots from the Linehaul API (updated on refresh) and entries when you mark a trip complete.
      </p>
      <button type="button" class="history-refresh tap" :disabled="loading" @click="load">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="history-err">{{ error }}</p>
    <p v-else-if="!loading && weekGroups.length === 0" class="history-empty">
      No history yet. History fills when we receive trip data from the API, or when you mark a trip complete.
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
                if (!g.items.some((x) => x.id === openId)) {
                  openId = g.items[0]?.id || ''
                }
              } else if (openWeekKey === g.key) {
                openWeekKey = ''
              }
            }
          "
        >
          <summary class="history-week-summary">
            <span class="history-week-title">{{ g.groupLabel }}</span>
            <span class="history-week-count">{{ g.items.length }} trip(s)</span>
          </summary>
          <ul
            class="history-list history-list--nested"
            :aria-label="`Trips in ${g.groupLabel}`"
          >
            <li
              v-for="e in g.items"
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
          <summary class="history-card-summary">
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
            <time
              class="history-date"
              :datetime="new Date(e.displayDate).toISOString()"
              >{{ formatWhen(e.displayDate) }}</time
            >
            <span class="history-seq" v-if="e.dailyTripLegSequence"
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

.history-week-count {
  font-size: 0.72rem;
  font-weight: 600;
  color: #9ca3af;
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

.history-seq {
  font-size: 0.65rem;
  color: var(--color-text-tertiary, #6e6e7e);
  line-height: 1.3;
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
