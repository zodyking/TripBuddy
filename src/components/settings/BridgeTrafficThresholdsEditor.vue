<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  BRIDGE_PROFILE_CATALOG,
  BRIDGE_TIER_FIELD_DEFS,
  BRIDGE_STANDSTILL_FIELD_DEFS,
  BRIDGE_TRAFFIC_PROFILES,
  mergeBridgeTrafficProfile,
} from '../../utils/bridgeTrafficProfiles.js'
import {
  STANDSTILL_ABSOLUTE_MINUTES,
  STANDSTILL_CRAWL_MAX_SPEED_MPH,
} from '../../utils/bridgeTrafficCondition.js'
import {
  bridgeProfileOverridesDraft,
  bridgeProfilesLoading,
  bridgeProfilesSaveMsg,
  bridgeProfilesSaveError,
  hydrateBridgeTrafficProfilesFromServer,
  saveBridgeTrafficProfileOverrides,
} from '../../stores/bridgeTrafficProfilesStore.js'

/** @type {import('vue').Ref<'ToNY' | 'ToNJ'>} */
const direction = ref('ToNY')

/** @type {import('vue').Ref<Record<string, Record<string, number>>>} */
const edits = ref({})
const dirty = ref(false)

const crossingsForDirection = computed(() =>
  BRIDGE_PROFILE_CATALOG.filter((c) => c.directionSlug === direction.value),
)

const bridgeGroups = computed(() => {
  /** @type {Map<string, typeof BRIDGE_PROFILE_CATALOG>} */
  const map = new Map()
  for (const row of crossingsForDirection.value) {
    const list = map.get(row.bridge) || []
    list.push(row)
    map.set(row.bridge, list)
  }
  return [...map.entries()].map(([bridge, rows]) => ({
    bridge,
    rows: rows.sort((a, b) => {
      if (a.deck === b.deck) return 0
      if (a.deck === 'Upper') return -1
      if (b.deck === 'Upper') return 1
      return a.deck.localeCompare(b.deck)
    }),
  }))
})

const allFieldKeys = [
  ...BRIDGE_TIER_FIELD_DEFS.map((f) => f.key),
  ...BRIDGE_STANDSTILL_FIELD_DEFS.map((f) => f.key),
]

/**
 * @param {string} profileKey
 */
function effectiveProfile(profileKey) {
  const base = BRIDGE_TRAFFIC_PROFILES[profileKey]
  if (!base) return null
  const saved = bridgeProfileOverridesDraft.value[profileKey]
  const pending = edits.value[profileKey]
  let p = saved ? mergeBridgeTrafficProfile(base, saved) : { ...base }
  if (pending) {
    p = mergeBridgeTrafficProfile(p, /** @type {Partial<typeof p>} */ (pending))
  }
  return p
}

/**
 * @param {string} profileKey
 * @param {string} fieldKey
 */
function displayValue(profileKey, fieldKey) {
  const p = effectiveProfile(profileKey)
  if (!p) return ''
  const v = /** @type {Record<string, number>} */ (p)[fieldKey]
  return Number.isFinite(v) ? String(v) : ''
}

/**
 * @param {string} profileKey
 * @param {string} fieldKey
 */
function defaultValue(profileKey, fieldKey) {
  const base = BRIDGE_TRAFFIC_PROFILES[profileKey]
  if (!base) return ''
  const v = /** @type {Record<string, number>} */ (base)[fieldKey]
  return Number.isFinite(v) ? String(v) : ''
}

/**
 * @param {string} profileKey
 * @param {string} fieldKey
 */
function isFieldCustomized(profileKey, fieldKey) {
  return displayValue(profileKey, fieldKey) !== defaultValue(profileKey, fieldKey)
}

/**
 * @param {string} profileKey
 * @param {string} fieldKey
 * @param {string} raw
 */
function onFieldInput(profileKey, fieldKey, raw) {
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n) || n < 0) return
  const base = BRIDGE_TRAFFIC_PROFILES[profileKey]
  if (!base) return
  const def = /** @type {Record<string, number>} */ (base)[fieldKey]
  const next = { ...(edits.value[profileKey] || {}) }
  if (n === def) {
    delete next[fieldKey]
  } else {
    next[fieldKey] = n
  }
  if (Object.keys(next).length === 0) {
    const { [profileKey]: _, ...rest } = edits.value
    edits.value = rest
  } else {
    edits.value = { ...edits.value, [profileKey]: next }
  }
  dirty.value = true
}

/**
 * @param {string} profileKey
 */
function resetProfile(profileKey) {
  const { [profileKey]: _e, ...restEdits } = edits.value
  edits.value = restEdits
  const { [profileKey]: _o, ...restOverrides } = bridgeProfileOverridesDraft.value
  bridgeProfileOverridesDraft.value = restOverrides
  dirty.value = true
}

function resetAllVisible() {
  for (const row of crossingsForDirection.value) {
    resetProfile(row.key)
  }
}

function buildOverridesPayload() {
  /** @type {Record<string, import('../../utils/bridgeTrafficProfiles.js').BridgeTrafficProfile>} */
  const out = { ...bridgeProfileOverridesDraft.value }
  for (const [profileKey, patch] of Object.entries(edits.value)) {
    const base = BRIDGE_TRAFFIC_PROFILES[profileKey]
    if (!base) continue
    const prev = out[profileKey] || base
    out[profileKey] = mergeBridgeTrafficProfile(prev, /** @type {Partial<typeof base>} */ (patch))
  }
  return out
}

async function save() {
  const overrides = buildOverridesPayload()
  const ok = await saveBridgeTrafficProfileOverrides(overrides)
  if (ok) {
    edits.value = {}
    dirty.value = false
  }
}

/**
 * @param {string} profileKey
 */
function profileHasCustom(profileKey) {
  return allFieldKeys.some((k) => isFieldCustomized(profileKey, k))
}

watch(direction, () => {
  edits.value = {}
  dirty.value = false
})

onMounted(() => {
  void hydrateBridgeTrafficProfilesFromServer({ force: true })
})
</script>

<template>
  <div class="bth">
    <header class="bth-head">
      <p class="bth-lead">
        Tune when crossings show
        <span class="tier-pill tier-pill--green">green</span>
        <span class="tier-pill tier-pill--orange">orange</span>
        <span class="tier-pill tier-pill--red">red</span>
        on Traffic. Gridlock uses <strong>time and speed together</strong>, not a single minute cap.
      </p>
      <div class="bth-dir" role="tablist" aria-label="Travel direction">
        <button
          type="button"
          class="bth-dir-btn tap"
          role="tab"
          :aria-selected="direction === 'ToNY'"
          :class="{ 'is-active': direction === 'ToNY' }"
          @click="direction = 'ToNY'"
        >
          To NY
        </button>
        <button
          type="button"
          class="bth-dir-btn tap"
          role="tab"
          :aria-selected="direction === 'ToNJ'"
          :class="{ 'is-active': direction === 'ToNJ' }"
          @click="direction = 'ToNJ'"
        >
          To NJ
        </button>
      </div>
    </header>

    <p v-if="bridgeProfilesSaveError" class="bth-flash bth-flash--err">{{ bridgeProfilesSaveError }}</p>
    <p v-else-if="bridgeProfilesSaveMsg" class="bth-flash">{{ bridgeProfilesSaveMsg }}</p>

    <div v-if="bridgeProfilesLoading && !bridgeGroups.length" class="bth-skeleton" aria-busy="true">
      <span class="bth-skeleton-bar" />
      <span class="bth-skeleton-text">Loading thresholds…</span>
    </div>

    <div v-else class="bth-list">
      <article v-for="group in bridgeGroups" :key="group.bridge" class="bth-card">
        <header class="bth-card-head">
          <h4 class="bth-card-title">{{ group.bridge }}</h4>
        </header>

        <section
          v-for="row in group.rows"
          :key="row.key"
          class="bth-lane"
          :class="{ 'bth-lane--custom': profileHasCustom(row.key) }"
        >
          <div class="bth-lane-top">
            <span v-if="row.deck" class="bth-deck-pill">{{ row.deck }}</span>
            <span v-else class="bth-deck-pill bth-deck-pill--muted">{{ row.direction }}</span>
            <button type="button" class="bth-reset tap" @click="resetProfile(row.key)">
              Reset
            </button>
          </div>

          <div class="bth-tier-row" role="group" :aria-label="`${group.bridge} delay tiers`">
            <template v-for="(field, idx) in BRIDGE_TIER_FIELD_DEFS" :key="field.key">
              <span v-if="idx > 0" class="bth-sep" aria-hidden="true">·</span>
              <label
                class="bth-chip"
                :class="[`bth-chip--${field.tier}`, { 'bth-chip--custom': isFieldCustomized(row.key, field.key) }]"
                :title="field.hint"
              >
                <span class="bth-chip-tier">{{ field.label }}</span>
                <span class="bth-chip-inputs">
                  <span v-if="field.short" class="bth-chip-prefix">{{ field.short }}</span>
                  <input
                    type="number"
                    class="bth-inp tap"
                    step="0.5"
                    min="0"
                    :value="displayValue(row.key, field.key)"
                    :aria-label="`${group.bridge} ${field.label}`"
                    @input="onFieldInput(row.key, field.key, ($event.target).value)"
                  />
                  <span class="bth-chip-unit">{{ field.unit }}</span>
                </span>
              </label>
            </template>
          </div>

          <details class="bth-gridlock">
            <summary class="bth-gridlock-summary tap">
              Gridlock detection
              <span class="bth-gridlock-hint">speed + time rules</span>
            </summary>
            <p class="bth-gridlock-note">
              Also flags gridlock at ≥{{ STANDSTILL_ABSOLUTE_MINUTES }} min or ≤{{ STANDSTILL_CRAWL_MAX_SPEED_MPH }} mph with enough crawl time (global rules).
            </p>
            <div class="bth-gridlock-row">
              <label
                v-for="field in BRIDGE_STANDSTILL_FIELD_DEFS"
                :key="field.key"
                class="bth-chip bth-chip--gridlock"
                :class="{ 'bth-chip--custom': isFieldCustomized(row.key, field.key) }"
                :title="field.hint"
              >
                <span class="bth-chip-tier">{{ field.label }}</span>
                <span class="bth-chip-inputs">
                  <input
                    type="number"
                    class="bth-inp tap"
                    step="0.5"
                    min="0"
                    :value="displayValue(row.key, field.key)"
                    :aria-label="`${group.bridge} gridlock ${field.label}`"
                    @input="onFieldInput(row.key, field.key, ($event.target).value)"
                  />
                  <span class="bth-chip-unit">{{ field.unit }}</span>
                </span>
              </label>
            </div>
          </details>
        </section>
      </article>
    </div>

    <footer class="bth-foot">
      <button
        type="button"
        class="btn primary tap"
        :disabled="bridgeProfilesLoading || !dirty"
        @click="save"
      >
        {{ bridgeProfilesLoading ? 'Saving…' : 'Save thresholds' }}
      </button>
      <button
        type="button"
        class="btn tap"
        :disabled="bridgeProfilesLoading"
        @click="resetAllVisible"
      >
        Reset {{ direction === 'ToNY' ? 'To NY' : 'To NJ' }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.bth {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.bth-head {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.bth-lead {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.5;
  color: var(--color-text-secondary, #b8b8c6);
}

.bth-lead strong {
  color: var(--color-text-primary, #f0f0f6);
  font-weight: 600;
}

.tier-pill {
  display: inline-block;
  margin: 0 0.1rem;
  padding: 0.05rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
  font-weight: 700;
}
.tier-pill--green {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}
.tier-pill--orange {
  background: rgba(249, 115, 22, 0.18);
  color: #fb923c;
}
.tier-pill--red {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}

.bth-dir {
  display: inline-flex;
  align-self: flex-start;
  padding: 0.15rem;
  border-radius: var(--radius-md, 0.5rem);
  background: var(--color-bg-elevated, #0f0f14);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
}

.bth-dir-btn {
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #b8b8c6);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.4rem 0.9rem;
  border-radius: calc(var(--radius-md, 0.5rem) - 2px);
  cursor: pointer;
}
.bth-dir-btn.is-active {
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
}

.bth-flash {
  margin: 0;
  font-size: 0.78rem;
  color: var(--color-text-secondary, #b8b8c6);
}
.bth-flash--err {
  color: #f87171;
}

.bth-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
}
.bth-skeleton-bar {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    rgba(123, 77, 181, 0.15) 0%,
    rgba(123, 77, 181, 0.55) 50%,
    rgba(123, 77, 181, 0.15) 100%
  );
  background-size: 200% 100%;
  animation: bth-shimmer 1.2s ease-in-out infinite;
}
.bth-skeleton-text {
  font-size: 0.75rem;
  color: var(--color-text-tertiary, #8b8b98);
}

@keyframes bth-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.bth-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.bth-card {
  border-radius: var(--radius-lg, 0.75rem);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-elevated, #0f0f14);
  overflow: hidden;
}

.bth-card-head {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.06));
}

.bth-card-title {
  margin: 0;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--color-text-primary, #f4f4f8);
}

.bth-lane {
  padding: 0.55rem 0.75rem 0.65rem;
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.05));
}
.bth-lane--custom {
  background: rgba(123, 77, 181, 0.06);
}

.bth-lane-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.bth-deck-pill {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #c8c8d4);
}
.bth-deck-pill--muted {
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.72rem;
}

.bth-reset {
  border: none;
  background: none;
  font: inherit;
  font-size: 0.68rem;
  color: var(--color-text-tertiary, #8b8b98);
  text-decoration: underline;
  cursor: pointer;
  padding: 0.2rem;
}
.bth-reset:hover {
  color: var(--color-text-secondary, #c8c8d4);
}

.bth-tier-row,
.bth-gridlock-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.25rem;
}

.bth-sep {
  color: var(--color-text-tertiary, #6e6e7e);
  font-size: 0.85rem;
  user-select: none;
}

.bth-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.4rem;
  border: 1px solid transparent;
  cursor: default;
}
.bth-chip--custom {
  border-color: rgba(167, 139, 250, 0.35);
  background: rgba(123, 77, 181, 0.08);
}

.bth-chip-tier {
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.bth-chip--green .bth-chip-tier {
  color: #4ade80;
}
.bth-chip--orange .bth-chip-tier {
  color: #fb923c;
}
.bth-chip--red .bth-chip-tier {
  color: #f87171;
}
.bth-chip--gridlock .bth-chip-tier {
  color: #c4b5fd;
}

.bth-chip-inputs {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}

.bth-chip-prefix {
  font-size: 0.72rem;
  color: var(--color-text-tertiary, #8b8b98);
}

.bth-inp {
  width: 3.1rem;
  min-height: 1.85rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.35rem;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  background: var(--color-bg-base, #08080c);
  color: var(--color-text-primary, #f4f4f8);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}
.bth-inp:focus {
  outline: none;
  border-color: var(--color-accent-purple, #7b4db5);
  box-shadow: 0 0 0 2px rgba(123, 77, 181, 0.2);
}

.bth-chip-unit {
  font-size: 0.62rem;
  color: var(--color-text-tertiary, #8b8b98);
}

.bth-gridlock {
  margin-top: 0.45rem;
}

.bth-gridlock-summary {
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary, #c8c8d4);
  cursor: pointer;
}
.bth-gridlock-summary::-webkit-details-marker {
  display: none;
}
.bth-gridlock-summary::before {
  content: '▸';
  font-size: 0.65rem;
  color: var(--color-text-tertiary, #8b8b98);
}
.bth-gridlock[open] .bth-gridlock-summary::before {
  content: '▾';
}

.bth-gridlock-hint {
  font-size: 0.62rem;
  font-weight: 500;
  color: var(--color-text-tertiary, #8b8b98);
}

.bth-gridlock-note {
  margin: 0.35rem 0 0.45rem;
  font-size: 0.68rem;
  line-height: 1.4;
  color: var(--color-text-tertiary, #8b8b98);
}

.bth-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.15rem;
}

@media (max-width: 420px) {
  .bth-tier-row {
    gap: 0.25rem;
  }
  .bth-sep {
    display: none;
  }
  .bth-chip {
    flex: 1 1 calc(50% - 0.25rem);
    min-width: 8.5rem;
  }
}
</style>
