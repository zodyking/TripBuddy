<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  BRIDGE_PROFILE_CATALOG,
  BRIDGE_THRESHOLD_FIELD_DEFS,
  BRIDGE_TRAFFIC_PROFILES,
  mergeBridgeTrafficProfile,
} from '../../utils/bridgeTrafficProfiles.js'
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

/** profileKey → partial edits (only keys user touched) */
/** @type {import('vue').Ref<Record<string, Record<string, number>>>} */
const edits = ref({})

const dirty = ref(false)

const crossingsForDirection = computed(() =>
  BRIDGE_PROFILE_CATALOG.filter((c) => c.directionSlug === direction.value),
)

/** Group by bridge name for cleaner layout */
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
    <div class="bth-head">
      <div>
        <h3 class="bth-title">Crossing delay thresholds</h3>
        <p class="bth-lead">
          Set when each bridge shows
          <span class="tier-chip tier-chip--green">green</span>,
          <span class="tier-chip tier-chip--orange">orange</span>, or
          <span class="tier-chip tier-chip--red">red</span>
          on the Traffic tab. Values apply per direction.
        </p>
      </div>
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
    </div>

    <p v-if="bridgeProfilesSaveError" class="cred-msg cred-msg--error">{{ bridgeProfilesSaveError }}</p>
    <p v-else-if="bridgeProfilesSaveMsg" class="cred-msg">{{ bridgeProfilesSaveMsg }}</p>

    <div v-if="bridgeProfilesLoading && !bridgeGroups.length" class="bth-loading">Loading thresholds…</div>

    <div v-else class="bth-list">
      <article v-for="group in bridgeGroups" :key="group.bridge" class="bth-card">
        <header class="bth-card-head">
          <h4 class="bth-card-title">{{ group.bridge }}</h4>
        </header>

        <div
          v-for="row in group.rows"
          :key="row.key"
          class="bth-row"
        >
          <p v-if="row.deck" class="bth-deck">{{ row.deck }} deck · {{ row.direction }}</p>

          <div class="bth-grid">
            <label
              v-for="field in BRIDGE_THRESHOLD_FIELD_DEFS"
              :key="`${row.key}-${field.key}`"
              class="bth-field"
              :class="`bth-field--${field.tier}`"
              :title="field.hint"
            >
              <span class="bth-field-label">{{ field.label }}</span>
              <span class="bth-field-input-wrap">
                <input
                  type="number"
                  class="bth-field-input inp tap"
                  step="0.5"
                  min="0"
                  :value="displayValue(row.key, field.key)"
                  :aria-label="`${group.bridge} ${row.deck || ''} ${field.label}`"
                  @input="onFieldInput(row.key, field.key, ($event.target).value)"
                />
                <span class="bth-field-unit">{{ field.unit }}</span>
              </span>
              <span
                v-if="isFieldCustomized(row.key, field.key)"
                class="bth-custom"
              >custom</span>
            </label>
          </div>

          <button
            type="button"
            class="bth-reset-link tap"
            @click="resetProfile(row.key)"
          >
            Reset {{ row.deck ? `${row.deck} ` : '' }}to defaults
          </button>
        </div>
      </article>
    </div>

    <div class="bth-actions">
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
        Reset {{ direction === 'ToNY' ? 'To NY' : 'To NJ' }} to defaults
      </button>
    </div>
  </div>
</template>

<style scoped>
.bth {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.bth-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem 1.25rem;
}

.bth-title {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary, #f4f4f8);
}

.bth-lead {
  margin: 0;
  max-width: 36rem;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--color-text-secondary, #b8b8c6);
}

.tier-chip {
  display: inline-block;
  padding: 0.05rem 0.35rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
}
.tier-chip--green {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}
.tier-chip--orange {
  background: rgba(249, 115, 22, 0.2);
  color: #fb923c;
}
.tier-chip--red {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.bth-dir {
  display: inline-flex;
  padding: 0.2rem;
  border-radius: 0.55rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.bth-dir-btn {
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #b8b8c6);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border-radius: 0.4rem;
  cursor: pointer;
}
.bth-dir-btn.is-active {
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
}

.bth-loading {
  font-size: 0.8rem;
  color: var(--color-text-tertiary, #8b8b98);
  padding: 1rem 0;
}

.bth-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bth-card {
  border-radius: 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;
}

.bth-card-head {
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.15);
}

.bth-card-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.bth-row {
  padding: 0.65rem 0.75rem 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.bth-row:first-of-type {
  border-top: none;
}

.bth-deck {
  margin: 0 0 0.5rem;
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary, #8b8b98);
}

.bth-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.5rem 0.65rem;
}

.bth-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  position: relative;
}

.bth-field-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.bth-field--green .bth-field-label { color: #4ade80; }
.bth-field--orange .bth-field-label { color: #fb923c; }
.bth-field--red .bth-field-label { color: #f87171; }
.bth-field--standstill .bth-field-label { color: #c084fc; }

.bth-field-input-wrap {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.bth-field-input {
  width: 100%;
  min-width: 0;
  padding: 0.35rem 0.45rem;
  font-size: 0.85rem;
}

.bth-field-unit {
  flex-shrink: 0;
  font-size: 0.68rem;
  color: var(--color-text-tertiary, #8b8b98);
}

.bth-custom {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 0.55rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--color-accent-purple, #a78bfa);
  letter-spacing: 0.04em;
}

.bth-reset-link {
  margin-top: 0.45rem;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.68rem;
  color: var(--color-text-tertiary, #8b8b98);
  text-decoration: underline;
  cursor: pointer;
}
.bth-reset-link:hover {
  color: var(--color-text-secondary, #c8c8d4);
}

.bth-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

@media (max-width: 480px) {
  .bth-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
