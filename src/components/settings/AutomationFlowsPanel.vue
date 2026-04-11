<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getFlowScripts, putFlowScripts } from '../../api.js'
import { ensureFedexApiReady } from '../../composables/useApiHealth.js'
import { pushLiveLog } from '../../stores/liveLogStore.js'
import SettingsSection from './SettingsSection.vue'

/** @type {string[]} */
const FLOW_SCENARIO_IDS = [
  'navigate_home',
  'check_in',
  'begin_new_check_in',
  'arrive',
  'view_trip',
  'inspect_checkout',
]

const SCENARIO_LABELS = {
  navigate_home: 'Navigate home',
  check_in: 'Check in',
  begin_new_check_in: 'Begin new check-in',
  arrive: 'Arrive',
  view_trip: 'View trip & routing',
  inspect_checkout: 'Inspect & checkout',
}

/** Home Assistant–style: action type id → short label in the picker */
const OP_LABELS = {
  goto: 'Navigate',
  waitMs: 'Delay',
  waitLoadState: 'Wait for load state',
  clickMenu: 'Hamburger menu',
  fill: 'Fill field',
  click: 'Click',
  pressKey: 'Keyboard',
  builtin: 'Run built-in scenario',
}

const OPS = Object.keys(OP_LABELS)

const LOAD_STATE_LABELS = {
  load: 'load (full page)',
  domcontentloaded: 'DOM ready',
  networkidle: 'network idle',
}

const MENU_KEYS = [
  'checkIn',
  'beginNewCheckIn',
  'arrive',
  'inspectAndCheckOut',
  'reviewAndStartTrip',
  'viewTripAndRouting',
]

/** Menu key → label shown next to the raw key */
const MENU_KEY_LABELS = {
  checkIn: 'Check In',
  beginNewCheckIn: 'Begin New Check In',
  arrive: 'Arrive',
  inspectAndCheckOut: 'Inspect & Check Out',
  reviewAndStartTrip: 'Review & Start Trip',
  viewTripAndRouting: 'View Trip & Routing',
}

const LOAD_STATES = ['load', 'domcontentloaded', 'networkidle']

/**
 * Read-only phases for the hard-coded `check_in` path (matches runner + checkInFlow).
 * Shown so “one builtin step” maps to real behavior.
 */
const CHECK_IN_BUILTIN_PHASES = [
  {
    title: 'Dispatch app ready',
    detail:
      'Runner ensures the FedEx Ground app is usable (PurpleID / sign-in handled until the homepage is reachable).',
  },
  {
    title: 'Begin or resume check-in session',
    detail:
      'Begin New Check In (or continue if already active), confirm any dialog, wait until the session control is ready.',
  },
  {
    title: 'Open Check In',
    detail: 'Open the Check In screen from the home control or hamburger menu.',
  },
  {
    title: 'Choose option & enter tractor / location',
    detail: 'Select the check-in option; fill tractor number and current location from Settings.',
  },
  {
    title: 'Submit & interpret banner',
    detail:
      'Submit; read the FedEx banner. If location mismatches, you can update Tractor location and retry in the same browser session.',
  },
  {
    title: 'Driver phone & sign out',
    detail: 'After success, complete the phone modal using Driver phone from Settings and sign out.',
  },
]

function emptyScenarios() {
  /** @type {Record<string, { useCustom: boolean, notes: string, steps: object[] }>} */
  const o = {}
  for (const id of FLOW_SCENARIO_IDS) {
    o[id] = { useCustom: false, notes: '', steps: [] }
  }
  return o
}

/**
 * @param {string} op
 */
function newStep(op) {
  switch (op) {
    case 'goto':
      return { op: 'goto', url: 'dispatch_entry' }
    case 'waitMs':
      return { op: 'waitMs', ms: 1000 }
    case 'waitLoadState':
      return { op: 'waitLoadState', state: 'domcontentloaded' }
    case 'clickMenu':
      return { op: 'clickMenu', key: 'checkIn' }
    case 'fill':
      return { op: 'fill', selector: '', value: '' }
    case 'click':
      return { op: 'click', selector: '' }
    case 'pressKey':
      return { op: 'pressKey', key: 'Enter' }
    case 'builtin':
      return { op: 'builtin', name: 'navigate_home' }
    default:
      return { op: 'builtin', name: 'navigate_home' }
  }
}

const flowDoc = reactive({
  version: 1,
  scenarios: emptyScenarios(),
})

const selectedScenarioId = ref('check_in')
const loadError = ref(null)
const saveMsg = ref(null)
const saving = ref(false)
const loading = ref(true)

const currentScenario = computed(() => flowDoc.scenarios[selectedScenarioId.value])

async function requireApi() {
  const ok = await ensureFedexApiReady()
  if (!ok) {
    pushLiveLog({
      type: 'error',
      message: 'API not reachable — start npm run dev (api + ui).',
      ts: Date.now(),
    })
  }
  return ok
}

function mergeLoaded(data) {
  flowDoc.version = data.version === 1 ? 1 : 1
  const base = emptyScenarios()
  const incoming = data.scenarios && typeof data.scenarios === 'object' ? data.scenarios : {}
  for (const id of FLOW_SCENARIO_IDS) {
    const s = incoming[id]
    if (s && typeof s === 'object') {
      base[id] = {
        useCustom: Boolean(s.useCustom),
        notes: typeof s.notes === 'string' ? s.notes : '',
        steps: Array.isArray(s.steps) ? JSON.parse(JSON.stringify(s.steps)) : [],
      }
    }
  }
  flowDoc.scenarios = base
}

async function load() {
  loadError.value = null
  loading.value = true
  try {
    if (!(await requireApi())) {
      loadError.value = 'API offline'
      return
    }
    const data = await getFlowScripts()
    mergeLoaded(data)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function save() {
  saveMsg.value = null
  if (!(await requireApi())) return
  saving.value = true
  try {
    await putFlowScripts({
      version: 1,
      scenarios: JSON.parse(JSON.stringify(flowDoc.scenarios)),
    })
    saveMsg.value = 'Flow scripts saved'
    pushLiveLog({ type: 'info', message: 'Automation flows saved', ts: Date.now() })
  } catch (e) {
    saveMsg.value = e instanceof Error ? e.message : String(e)
    pushLiveLog({ type: 'error', message: saveMsg.value, ts: Date.now() })
  } finally {
    saving.value = false
  }
}

function insertCheckInTemplate() {
  const s = flowDoc.scenarios.check_in
  s.useCustom = true
  s.notes = 'Full built-in Check in (see reference phases above).'
  s.steps = [{ op: 'builtin', name: 'check_in' }]
  selectedScenarioId.value = 'check_in'
  saveMsg.value = null
  pushLiveLog({ type: 'info', message: 'Check in: one built-in action inserted (save to persist)', ts: Date.now() })
}

function resetCurrentToBuiltin() {
  const id = selectedScenarioId.value
  flowDoc.scenarios[id].useCustom = false
  flowDoc.scenarios[id].steps = []
  saveMsg.value = null
}

function addStep() {
  const s = currentScenario.value
  if (!s) return
  s.steps.push(newStep('waitMs'))
}

/**
 * One-line human title for the step card (Home Assistant “action” feel).
 * @param {object} step
 */
function stepFriendlyTitle(step) {
  if (!step || !step.op) return 'Step'
  switch (step.op) {
    case 'goto':
      return step.url === 'dispatch_entry'
        ? 'Open FedEx dispatch entry URL'
        : `Go to ${typeof step.url === 'string' && step.url ? step.url : 'URL'}`
    case 'waitMs':
      return `Wait ${Number(step.ms) || 0} ms`
    case 'waitLoadState':
      return `Wait until ${LOAD_STATE_LABELS[step.state] || step.state || '…'}`
    case 'clickMenu':
      return `Menu: ${MENU_KEY_LABELS[step.key] || step.key || '…'}`
    case 'fill':
      return `Fill “${(step.selector || '').slice(0, 40) || 'selector'}”`
    case 'click':
      return `Click “${(step.selector || '').slice(0, 40) || 'selector'}”`
    case 'pressKey':
      return `Press ${step.key || 'key'}`
    case 'builtin':
      return `Built-in: ${SCENARIO_LABELS[step.name] || step.name || '…'}`
    default:
      return String(step.op)
  }
}

/**
 * Second line: what this means in practice.
 * @param {object} step
 */
function stepSubtext(step) {
  if (!step || !step.op) return ''
  switch (step.op) {
    case 'builtin':
      return 'Runs the full server scenario as one block (same as Dashboard Quick action for that scenario).'
    case 'goto':
      return step.url === 'dispatch_entry'
        ? 'Same entry point the runner uses after /api/run (fdxtools).'
        : 'Full navigation; use https://… for external URLs.'
    case 'clickMenu':
      return 'Left nav / hamburger item by configured selector key.'
    case 'fill':
    case 'click':
      return 'CSS selector on the page. Prefer IDs/classes the app keeps stable.'
    default:
      return OP_LABELS[step.op] || ''
  }
}

/**
 * @param {number} idx
 * @param {string} newOp
 */
function changeStepOp(idx, newOp) {
  const s = currentScenario.value
  if (!s) return
  s.steps[idx] = newStep(newOp)
}

/**
 * @param {number} idx
 * @param {Event} ev
 */
function onStepOpChange(idx, ev) {
  const el = ev.target
  if (el instanceof HTMLSelectElement) changeStepOp(idx, el.value)
}

/**
 * @param {number} idx
 */
function removeStep(idx) {
  const s = currentScenario.value
  if (!s) return
  s.steps.splice(idx, 1)
}

/**
 * @param {number} idx
 * @param {number} delta
 */
function moveStep(idx, delta) {
  const s = currentScenario.value
  if (!s) return
  const j = idx + delta
  if (j < 0 || j >= s.steps.length) return
  const t = s.steps[idx]
  s.steps[idx] = s.steps[j]
  s.steps[j] = t
}

onMounted(() => {
  void load()
})
</script>

<template>
  <SettingsSection title="Automation flows">
    <p v-if="loading" class="hint tight">Loading…</p>
    <p v-else-if="loadError" class="err">{{ loadError }}</p>

    <template v-else>
      <p class="hint tight">
        Pick a <strong>scenario</strong> (what Home runs when you tap a Quick action). Use <strong>default</strong> for
        the normal FedEx behavior, or turn on <strong>custom sequence</strong> to replace it with a straight list of
        steps — like a Home Assistant automation: one action per row, top to bottom. No branches yet; triggers are still
        Dashboard / <code>POST /api/run</code>.
      </p>

      <label class="lbl">Scenario</label>
      <select v-model="selectedScenarioId" class="inp tap">
        <option v-for="id in FLOW_SCENARIO_IDS" :key="id" :value="id">
          {{ SCENARIO_LABELS[id] || id }}
        </option>
      </select>

      <div v-if="currentScenario" class="panel">
        <div class="mode-card" :data-mode="currentScenario.useCustom ? 'custom' : 'default'">
          <div class="mode-row">
            <label class="row-check">
              <input v-model="currentScenario.useCustom" type="checkbox" />
              <span class="mode-label">Custom sequence</span>
            </label>
            <span v-if="!currentScenario.useCustom" class="mode-pill">Default behavior</span>
            <span v-else class="mode-pill mode-pill-on">Editing sequence</span>
          </div>
          <p v-if="!currentScenario.useCustom" class="hint tight mode-hint">
            The server runs the built-in Playwright flow for
            <strong>{{ SCENARIO_LABELS[selectedScenarioId] }}</strong>. Nothing below is executed.
          </p>
          <p v-else class="hint tight mode-hint">
            While enabled and this list is non-empty, these steps run <em>instead of</em> the built-in flow for this
            scenario. Order matters: step 1, then 2, then 3…
          </p>
        </div>

        <label class="lbl">Notes</label>
        <textarea v-model="currentScenario.notes" class="area-tap" rows="2" placeholder="Optional — for your own reference" />

        <div class="btn-row">
          <button type="button" class="btn tap primary" :disabled="saving" @click="save">Save flows</button>
          <button type="button" class="btn tap" @click="load">Reload</button>
        </div>
        <p v-if="saveMsg" :class="saveMsg.startsWith('Flow') ? 'ok' : 'err'">{{ saveMsg }}</p>

        <details v-if="selectedScenarioId === 'check_in'" class="reference-details">
          <summary class="reference-summary">What the built-in Check in actually does</summary>
          <p class="hint tight ref-lead">
            The full check-in path is one coordinated routine in the server (not split into editable micro-steps in the
            UI yet). These phases are what you get when you use default Check in or a single
            <strong>Run built-in scenario → Check in</strong> step.
          </p>
          <ol class="ref-phases">
            <li v-for="(p, i) in CHECK_IN_BUILTIN_PHASES" :key="i" class="ref-phase">
              <span class="ref-phase-n">{{ i + 1 }}</span>
              <div class="ref-phase-body">
                <span class="ref-phase-title">{{ p.title }}</span>
                <span class="ref-phase-detail">{{ p.detail }}</span>
              </div>
            </li>
          </ol>
        </details>

        <div class="btn-row wrap">
          <button type="button" class="btn tap" @click="insertCheckInTemplate">Use full built-in Check in (one step)</button>
          <button type="button" class="btn tap" @click="resetCurrentToBuiltin">Use default for this scenario</button>
        </div>
        <p class="hint tight template-hint">
          <strong>Preset:</strong> adds one action — <em>Run built-in scenario: Check in</em> — same outcome as Home →
          Check in. Use <strong>Custom sequence</strong> above, then save.
        </p>

        <h3 class="steps-h">Sequence</h3>
        <p v-if="currentScenario.useCustom && !currentScenario.steps.length" class="hint tight empty-seq">
          No steps yet — the server still uses the <strong>built-in</strong> flow until you add at least one action.
          Add below, or use the Check in preset and save.
        </p>
        <p v-else-if="!currentScenario.useCustom" class="hint tight empty-seq muted">
          Custom sequence is off — the built-in flow runs (see reference above for Check in).
        </p>

        <div v-else class="sequence">
          <div v-for="(step, idx) in currentScenario.steps" :key="idx" class="step-card">
            <div class="step-badge" aria-hidden="true">{{ idx + 1 }}</div>
            <div class="step-body">
              <div class="step-top">
                <p class="step-friendly">{{ stepFriendlyTitle(step) }}</p>
                <p class="step-sub">{{ stepSubtext(step) }}</p>
              </div>

              <div class="step-toolbar">
                <div class="field-action">
                  <span class="field-label">Action</span>
                  <select
                    class="inp tap op-sel"
                    :value="step.op"
                    @change="onStepOpChange(idx, $event)"
                  >
                    <option v-for="op in OPS" :key="op" :value="op">
                      {{ OP_LABELS[op] }} ({{ op }})
                    </option>
                  </select>
                </div>
                <div class="step-toolbar-btns">
                  <button type="button" class="btn tap sm" @click="moveStep(idx, -1)" :disabled="idx === 0">Up</button>
                  <button
                    type="button"
                    class="btn tap sm"
                    @click="moveStep(idx, 1)"
                    :disabled="idx >= currentScenario.steps.length - 1"
                  >
                    Down
                  </button>
                  <button type="button" class="btn tap sm danger" @click="removeStep(idx)">Delete</button>
                </div>
              </div>

              <div class="step-fields">
                <template v-if="step.op === 'goto'">
                  <label class="lbl">URL or keyword</label>
                  <input v-model="step.url" class="inp tap" placeholder="dispatch_entry or https://…" />
                </template>
                <template v-else-if="step.op === 'waitMs'">
                  <label class="lbl">Milliseconds</label>
                  <input v-model.number="step.ms" class="inp tap" type="number" min="0" max="600000" />
                </template>
                <template v-else-if="step.op === 'waitLoadState'">
                  <label class="lbl">Load state</label>
                  <select v-model="step.state" class="inp tap">
                    <option v-for="st in LOAD_STATES" :key="st" :value="st">
                      {{ LOAD_STATE_LABELS[st] || st }}
                    </option>
                  </select>
                </template>
                <template v-else-if="step.op === 'clickMenu'">
                  <label class="lbl">Menu item</label>
                  <select v-model="step.key" class="inp tap">
                    <option v-for="k in MENU_KEYS" :key="k" :value="k">
                      {{ MENU_KEY_LABELS[k] || k }} ({{ k }})
                    </option>
                  </select>
                </template>
                <template v-else-if="step.op === 'fill'">
                  <label class="lbl">CSS selector</label>
                  <input v-model="step.selector" class="inp tap" />
                  <label class="lbl">Text to type</label>
                  <input v-model="step.value" class="inp tap" />
                </template>
                <template v-else-if="step.op === 'click'">
                  <label class="lbl">CSS selector</label>
                  <input v-model="step.selector" class="inp tap" />
                </template>
                <template v-else-if="step.op === 'pressKey'">
                  <label class="lbl">Key</label>
                  <input v-model="step.key" class="inp tap" placeholder="Enter, Tab, …" />
                </template>
                <template v-else-if="step.op === 'builtin'">
                  <label class="lbl">Which built-in scenario</label>
                  <select v-model="step.name" class="inp tap">
                    <option v-for="id in FLOW_SCENARIO_IDS" :key="id" :value="id">
                      {{ SCENARIO_LABELS[id] || id }}
                    </option>
                  </select>
                  <p class="hint tight builtin-hint">
                    This is one packaged server routine (not broken into smaller rows here). For Check in, see the
                    reference list above.
                  </p>
                </template>
              </div>
            </div>
          </div>
        </div>

        <button
          v-if="currentScenario.useCustom"
          type="button"
          class="btn tap block-gap add-step-btn"
          @click="addStep"
        >
          Add action
        </button>
      </div>
    </template>
  </SettingsSection>
</template>

<style scoped>
.hint {
  font-size: 0.8rem;
  color: var(--muted, #9898a8);
  margin: 0 0 0.75rem;
  line-height: 1.4;
}
.hint.tight {
  margin-bottom: 0.5rem;
}
.block-gap {
  margin-top: 1rem;
}
.lbl {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
  color: var(--muted, #9898a8);
}
.inp {
  width: 100%;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  margin-bottom: 0.65rem;
  min-height: 44px;
}
.area-tap {
  width: 100%;
  min-height: 3rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #12121a;
  color: var(--text, #e8e8ee);
  margin-bottom: 0.65rem;
  resize: vertical;
}
.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.btn-row.wrap {
  margin-top: 0.75rem;
}
.btn {
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--border, #2e2e38);
  background: #2a2a34;
  color: var(--text, #e8e8ee);
  padding: 0.5rem 0.85rem;
  font-size: 0.9rem;
  min-height: 44px;
}
.btn.primary {
  background: #5c2d91;
  border-color: #7b4db5;
}
.btn.sm {
  min-height: 40px;
  padding: 0.35rem 0.6rem;
  font-size: 0.82rem;
}
.btn.danger {
  border-color: #8b4049;
  color: #ffcdd2;
}
.row-check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
  min-height: 44px;
}
.panel {
  margin-top: 0.5rem;
}
.ok {
  font-size: 0.9rem;
  color: #a5d6a7;
  margin: 0.35rem 0 0;
}
.err {
  font-size: 0.9rem;
  color: #ffab91;
  margin: 0.35rem 0 0;
}
.steps-h {
  font-size: 0.95rem;
  margin: 1rem 0 0.35rem;
  font-weight: 600;
}
.mode-card {
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  padding: 0.75rem 0.85rem;
  margin-bottom: 0.75rem;
  background: #14141c;
}
.mode-card[data-mode='custom'] {
  border-color: rgba(92, 45, 145, 0.45);
}
.mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.mode-card .row-check {
  margin-bottom: 0;
}
.mode-label {
  font-weight: 600;
}
.mode-pill {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--border, #2e2e38);
  color: var(--muted, #9898a8);
}
.mode-pill-on {
  color: #c4a6e8;
  border-color: #5c2d91;
  background: rgba(92, 45, 145, 0.2);
}
.mode-hint {
  margin-top: 0.5rem;
  margin-bottom: 0;
}
.reference-details {
  margin: 0.85rem 0;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  padding: 0.35rem 0.75rem 0.65rem;
  background: #12121a;
}
.reference-summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.35rem 0;
  list-style: none;
}
.reference-summary::-webkit-details-marker {
  display: none;
}
.reference-summary::before {
  content: '▸ ';
  color: var(--muted, #9898a8);
}
.reference-details[open] .reference-summary::before {
  content: '▾ ';
}
.ref-lead {
  margin-top: 0;
}
.ref-phases {
  margin: 0;
  padding: 0;
  list-style: none;
}
.ref-phase {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  padding: 0.5rem 0;
  border-bottom: 1px solid #22222c;
}
.ref-phase:last-child {
  border-bottom: none;
}
.ref-phase-n {
  flex-shrink: 0;
  width: 1.65rem;
  height: 1.65rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  background: #2a2a34;
  border: 1px solid var(--border, #2e2e38);
  color: #b39ddb;
}
.ref-phase-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.ref-phase-title {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--text, #e8e8ee);
}
.ref-phase-detail {
  font-size: 0.78rem;
  color: var(--muted, #9898a8);
  line-height: 1.35;
}
.template-hint {
  margin-top: 0.35rem;
}
.empty-seq.muted {
  opacity: 0.85;
}
.sequence {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.step-card {
  display: flex;
  gap: 0.75rem;
  align-items: stretch;
  border: 1px solid var(--border, #2e2e38);
  border-radius: 10px;
  padding: 0.75rem 0.85rem;
  margin-bottom: 0.65rem;
  background: #16161e;
}
.step-badge {
  flex-shrink: 0;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 1rem;
  background: linear-gradient(145deg, #3d2a52, #2a1f38);
  border: 1px solid rgba(92, 45, 145, 0.5);
  color: #e1bee7;
}
.step-body {
  flex: 1;
  min-width: 0;
}
.step-top {
  margin-bottom: 0.5rem;
}
.step-friendly {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text, #e8e8ee);
}
.step-sub {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--muted, #9898a8);
  line-height: 1.35;
}
.step-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
  margin-bottom: 0.35rem;
}
.field-action {
  flex: 1;
  min-width: min(100%, 14rem);
}
.field-label {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted, #9898a8);
  margin-bottom: 0.2rem;
}
.step-toolbar-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.step-fields .inp {
  margin-bottom: 0.5rem;
}
.step-fields .lbl:last-of-type + .inp:last-child {
  margin-bottom: 0.35rem;
}
.builtin-hint {
  margin-top: 0.25rem;
  margin-bottom: 0;
}
.add-step-btn {
  width: 100%;
}
.op-sel {
  width: 100%;
  margin-bottom: 0;
}
code {
  font-size: 0.85em;
}
.tap:active {
  opacity: 0.9;
}
</style>
