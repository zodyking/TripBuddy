<script setup>
import { ref, computed, onMounted } from 'vue'
import { getAssignment } from '../api.js'

/** @typedef {{ id: string, completedAt: number, dailyTripLegSequence: string, dispatchHeader: Record<string, unknown>, tripDetails: Record<string, unknown> }} LedgerEntry */

const loading = ref(true)
const error = ref('')
/** @type {import('vue').Ref<LedgerEntry[]>} */
const entries = ref([])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const a = await getAssignment()
    const raw = a?.tripHistoryLedger
    entries.value = Array.isArray(raw)
      ? raw
          .filter((x) => x && typeof x === 'object')
          .map((x) => ({
            id: String(x.id ?? ''),
            completedAt: typeof x.completedAt === 'number' ? x.completedAt : 0,
            dailyTripLegSequence: String(x.dailyTripLegSequence ?? ''),
            dispatchHeader:
              x.dispatchHeader && typeof x.dispatchHeader === 'object'
                ? /** @type {Record<string, unknown>} */ (x.dispatchHeader)
                : {},
            tripDetails:
              x.tripDetails && typeof x.tripDetails === 'object'
                ? /** @type {Record<string, unknown>} */ (x.tripDetails)
                : {},
          }))
          .filter((e) => e.id)
      : []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    entries.value = []
  } finally {
    loading.value = false
  }
}

const sorted = computed(() =>
  [...entries.value].sort((a, b) => b.completedAt - a.completedAt),
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

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="history-view">
    <header class="history-head">
      <h1 class="history-title">History</h1>
      <p class="history-sub">Completed trips (saved when you confirm “Mark trip complete”).</p>
      <button type="button" class="history-refresh tap" :disabled="loading" @click="load">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </header>

    <p v-if="error" class="history-err">{{ error }}</p>
    <p v-else-if="!loading && sorted.length === 0" class="history-empty">
      No completed trips yet. Double-tap Dispatch or Trip Details, then confirm completion.
    </p>

    <ul v-else class="history-list" aria-label="Trip history">
      <li v-for="e in sorted" :key="e.id" class="history-card">
        <div class="history-card-head">
          <time class="history-date" :datetime="new Date(e.completedAt).toISOString()">{{
            formatWhen(e.completedAt)
          }}</time>
          <span v-if="e.dailyTripLegSequence" class="history-seq"
            >Leg #{{ e.dailyTripLegSequence }}</span
          >
        </div>
        <div class="history-dispatch">
          <p class="history-od">
            <span class="history-od-label">Origin</span>
            <span class="history-od-val">{{ str(e.dispatchHeader?.origin) || '—' }}</span>
            <span class="history-od-arrow" aria-hidden="true">→</span>
            <span class="history-od-label">Destination</span>
            <span class="history-od-val">{{ str(e.dispatchHeader?.destination) || '—' }}</span>
          </p>
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

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
}

.history-card {
  border: 1px solid #34343e;
  border-radius: 12px;
  background: #1a1a22;
  overflow: hidden;
}

.history-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  background: #22222c;
  border-bottom: 1px solid #2e2e38;
}

.history-date {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-primary, #f4f4f8);
  font-variant-numeric: tabular-nums;
}

.history-seq {
  font-size: 0.68rem;
  color: var(--color-text-tertiary, #6e6e7e);
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
