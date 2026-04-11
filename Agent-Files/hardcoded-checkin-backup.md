# Hardcoded Check-In Logic Backup

This file contains the original hardcoded check-in logic from `MainDashboard.vue` before it was replaced with dynamic automation buttons.

**Archived:** April 2026

---

## Imports

```javascript
import {
  postRun,
  postCancelRun,
  putAssignment,
  postRetryLocation,
  postCancelRetry,
} from '../api.js'
import { readTryOktaPreference } from '../composables/tryOktaPreference.js'
import { isCheckInLocationMismatchMessage } from '../utils/checkInLocationMismatch.js'
```

## Constants

```javascript
const CHECKIN_STEP_TYPES = new Set(['info', 'warn', 'error', 'browser'])

/** Near max stacking so portals stay above preview, nav, and typical dev overlays */
const PORTAL_Z_BANNER = 2_147_483_000
const PORTAL_Z_MODAL = 2_147_483_001

/** Max wait for runner idle before location retry POST (avoids 409); keep short — first run usually done */
const CHECKIN_RETRY_RUNNER_WAIT_MS = 10_000
const CHECKIN_RETRY_RUNNER_POLL_MS = 100
```

## State Variables

```javascript
const runBusy = ref(false)
const runMsg = ref(null)
const runStartTs = ref(null)
const checkInStepText = ref('')
/** Shown after full check-in including phone + sign out */
const checkInSuccessBanner = ref(null)
/** FedEx app banner text after check-in; dismiss with X only */
const checkInFailureText = ref(null)
/** Run / API errors; dismiss with X (same pattern as app banner) */
const runErrorBanner = ref(null)

const locationDialogOpen = ref(false)
const locationPromptValue = ref('')
let locationResolve = null

/** AbortController for waitUntilCheckInRunnerFree when user cancels during wait */
let locationRetryWaitAbort = null

/** Actionable retry when FedEx reports driver/location mismatch */
const locationRetryOpen = ref(false)
const locationRetryFedexMessage = ref('')
const locationRetryInput = ref('')
/** True only while putAssignment is in flight from the location retry modal */
const locationRetrySubmitting = ref(false)
/** True after modal closes: waiting for runner idle, then second Check in until flow ends */
const checkInLocationRetryPending = ref(false)
/** When set, Save & retry uses POST /api/run/retry-location (same Playwright session, no new run). */
const inBrowserRetryRunId = ref(null)

/** Dedupe SSE-driven banner UI vs POST /api/run completion (same bannerText) */
const streamBannerHandledKey = ref(null)
```

## Functions

### updateCheckInStepFromLog

```javascript
function updateCheckInStepFromLog() {
  if (!runBusy.value) return
  const start = runStartTs.value
  if (start == null) return
  const list = liveLogEntries.value
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (e.ts < start) break
    if (CHECKIN_STEP_TYPES.has(e.type)) {
      checkInStepText.value = e.message
      return
    }
  }
}
```

### handleCheckInBannerFromLiveLog

```javascript
async function handleCheckInBannerFromLiveLog() {
  if (!runBusy.value) return
  const start = runStartTs.value
  if (start == null) return
  const list = liveLogEntries.value
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (e.ts < start) break

    if (
      e.locationRetryNeeded === true &&
      typeof e.runId === 'string' &&
      typeof e.bannerText === 'string' &&
      e.bannerText.trim() !== ''
    ) {
      /** Per SSE row (ts), not banner text — FedEx often repeats the same message on each wrong location */
      const key = `lr:${e.runId}:${e.ts}`
      if (streamBannerHandledKey.value === key) return
      streamBannerHandledKey.value = key
      await openLocationRetryModal(e.bannerText, e.runId)
      await nextTick()
      clearAutomationPreviewNow()
      return
    }

    if (
      e.checkInBanner === true &&
      typeof e.bannerText === 'string' &&
      e.bannerText.trim() !== '' &&
      !e.locationRetryNeeded
    ) {
      const key = e.bannerText.trim()
      if (streamBannerHandledKey.value === key) return
      streamBannerHandledKey.value = key
      const mismatch =
        e.locationMismatch === true ||
        isCheckInLocationMismatchMessage(e.bannerText)
      if (mismatch) {
        await openLocationRetryModal(e.bannerText, null)
      } else {
        checkInFailureText.value = e.bannerText
      }
      await nextTick()
      clearAutomationPreviewNow()
      return
    }
  }
}
```

### dismissCheckInFailure / dismissCheckInSuccess

```javascript
function dismissCheckInFailure() {
  checkInFailureText.value = null
}

function dismissCheckInSuccess() {
  checkInSuccessBanner.value = null
}
```

### openLocationRetryModal

```javascript
/**
 * @param {string} bannerText
 * @param {string | null} [runId] Server run id — when set, Save & retry uses in-browser POST /api/run/retry-location.
 */
async function openLocationRetryModal(bannerText, runId = null) {
  checkInFailureText.value = null
  locationRetryFedexMessage.value = bannerText
  locationRetryInput.value = ''
  if (runId) inBrowserRetryRunId.value = runId
  await nextTick()
  locationRetryOpen.value = true
}
```

### cancelLocationRetry

```javascript
async function cancelLocationRetry() {
  if (locationRetrySubmitting.value) return
  const msg = locationRetryFedexMessage.value
  const rid = inBrowserRetryRunId.value
  locationRetryOpen.value = false
  locationRetryFedexMessage.value = ''
  locationRetryInput.value = ''
  if (rid) {
    try {
      await postCancelRetry(rid)
    } catch {
      /* run may have ended */
    }
    inBrowserRetryRunId.value = null
  }
  if (msg) checkInFailureText.value = msg
}
```

### stopLocationRetryWait

```javascript
function stopLocationRetryWait() {
  locationRetryWaitAbort?.abort()
}
```

### sleepPoll

```javascript
function sleepPoll(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
```

### waitUntilCheckInRunnerFree

```javascript
/**
 * SSE can open the modal before the first POST /api/run returns; retry must wait or server returns 409.
 * Polls getHealth; proceeds when server is not busy and the client has no in-flight Check in POST.
 * @returns {Promise<true | false | 'aborted'>}
 */
async function waitUntilCheckInRunnerFree(
  maxMs = CHECKIN_RETRY_RUNNER_WAIT_MS,
  pollMs = CHECKIN_RETRY_RUNNER_POLL_MS,
) {
  const ac = new AbortController()
  locationRetryWaitAbort = ac
  const signal = ac.signal
  const deadline = Date.now() + maxMs
  try {
    while (Date.now() < deadline) {
      if (signal.aborted) return 'aborted'
      try {
        const h = await getHealth()
        if (h && h.busy === false && !runBusy.value) return true
      } catch {
        /* keep polling */
      }
      try {
        await sleepPoll(pollMs, signal)
      } catch {
        return 'aborted'
      }
    }
    return false
  } finally {
    if (locationRetryWaitAbort === ac) locationRetryWaitAbort = null
  }
}
```

### processCheckInApiResult

```javascript
/**
 * @param {{ ok: boolean, error?: string, checkIn?: { success?: boolean, bannerText?: string, locationMismatch?: boolean, signedOut?: boolean } }} result
 */
async function processCheckInApiResult(result) {
  if (!result.ok) {
    setRunErrorBanner(result.error || 'Failed')
    await nextTick()
    clearAutomationPreviewNow()
    return
  }
  if (result.checkIn && !result.checkIn.success && result.checkIn.bannerText) {
    const bt = result.checkIn.bannerText.trim()
    const streamKey = result.runId ? `lr:${result.runId}:${bt}` : bt
    const streamed = streamBannerHandledKey.value === streamKey
    const mismatch =
      result.checkIn.locationMismatch === true ||
      isCheckInLocationMismatchMessage(result.checkIn.bannerText)
    if (!streamed) {
      if (mismatch) {
        await openLocationRetryModal(
          result.checkIn.bannerText,
          typeof result.runId === 'string' ? result.runId : null,
        )
      } else {
        checkInFailureText.value = result.checkIn.bannerText
      }
    }
    streamBannerHandledKey.value = null
    await nextTick()
    clearAutomationPreviewNow()
    return
  }
  if (result.ok && result.checkIn?.signedOut === true) {
    checkInSuccessBanner.value = 'Check in successful'
    runMsg.value = null
  } else if (result.ok && result.checkIn?.success === true) {
    runMsg.value = 'Check in run finished (no app banner detected)'
  } else if (result.ok) {
    runMsg.value = 'Run finished'
  }
  await nextTick()
  clearAutomationPreviewNow()
}
```

### runCheckInScenario

```javascript
async function runCheckInScenario() {
  streamBannerHandledKey.value = null
  inBrowserRetryRunId.value = null
  automationPreviewHidden.value = false
  runStartTs.value = Date.now()
  checkInStepText.value = ''
  runBusy.value = true
  updateCheckInStepFromLog()
  try {
    return await postRun({
      scenario: 'check_in',
      headless: true,
      slowMo: 0,
      tryOktaLogin: readTryOktaPreference(),
      values: {},
      valueOrder: [],
    })
  } finally {
    runBusy.value = false
    runStartTs.value = null
    checkInStepText.value = ''
    inBrowserRetryRunId.value = null
  }
}
```

### saveLocationAndRetryCheckIn

```javascript
async function saveLocationAndRetryCheckIn() {
  if (locationRetrySubmitting.value || checkInLocationRetryPending.value) return
  const v = locationRetryInput.value.trim()
  if (!v) return
  if (!(await ensureFedexApiReady())) {
    setRunErrorBanner(
      'API is not running on port 3847. With vite-only dev, wait a few seconds for autostart, or run npm run dev from the project root.',
    )
    return
  }
  locationRetrySubmitting.value = true
  dismissRunErrorBanner()

  if (inBrowserRetryRunId.value) {
    try {
      await postRetryLocation(inBrowserRetryRunId.value, v)
      tractorLocation.value = v
      locationRetryOpen.value = false
      locationRetryFedexMessage.value = ''
      locationRetryInput.value = ''
    } catch (e) {
      setRunErrorBanner(e instanceof Error ? e.message : String(e))
    } finally {
      locationRetrySubmitting.value = false
    }
    return
  }

  try {
    await putAssignment({ tractorLocation: v })
    tractorLocation.value = v
    locationRetryOpen.value = false
    locationRetryFedexMessage.value = ''
    locationRetryInput.value = ''
    locationRetrySubmitting.value = false
    checkInLocationRetryPending.value = true
    const waitResult = await waitUntilCheckInRunnerFree()
    if (waitResult === 'aborted') return
    if (waitResult !== true) {
      setRunErrorBanner(
        'The server is still busy with Check in. Wait a few seconds and tap Check in, or try Save & retry again.',
      )
      return
    }
    const result = await runCheckInScenario()
    checkInLocationRetryPending.value = false
    await processCheckInApiResult(result)
  } catch (e) {
    setRunErrorBanner(e instanceof Error ? e.message : String(e))
  } finally {
    locationRetrySubmitting.value = false
    checkInLocationRetryPending.value = false
  }
}
```

### openLocationDialog / confirmLocationDialog / cancelLocationDialog

```javascript
function openLocationDialog() {
  locationPromptValue.value = tractorLocation.value || ''
  locationDialogOpen.value = true
  return new Promise((resolve) => {
    locationResolve = resolve
  })
}

function confirmLocationDialog() {
  const v = locationPromptValue.value.trim()
  if (!v) return
  locationDialogOpen.value = false
  locationResolve?.(v)
  locationResolve = null
}

function cancelLocationDialog() {
  locationDialogOpen.value = false
  locationResolve?.(null)
  locationResolve = null
}
```

### handleCheckIn

```javascript
async function handleCheckIn() {
  if (checkInLocationRetryPending.value) return
  runMsg.value = null
  dismissCheckInSuccess()
  dismissCheckInFailure()
  locationRetryOpen.value = false
  locationRetryFedexMessage.value = ''
  locationRetryInput.value = ''
  dismissRunErrorBanner()
  if (!(await ensureFedexApiReady())) {
    setRunErrorBanner(
      'API is not running on port 3847. With vite-only dev, wait a few seconds for autostart, or run npm run dev from the project root.',
    )
    return
  }
  let loc = tractorLocation.value.trim()
  if (!loc) {
    const entered = await openLocationDialog()
    if (!entered) return
    try {
      await putAssignment({ tractorLocation: entered })
    } catch (e) {
      setRunErrorBanner(e instanceof Error ? e.message : String(e))
      return
    }
    tractorLocation.value = entered
    loc = entered
  }

  try {
    const result = await runCheckInScenario()
    await processCheckInApiResult(result)
  } catch (e) {
    setRunErrorBanner(e instanceof Error ? e.message : String(e))
  }
}
```

## Watcher

```javascript
watch(
  liveLogEntries,
  () => {
    updateCheckInStepFromLog()
    void handleCheckInBannerFromLiveLog()
  },
  { deep: true },
)
```

## Template - Check-In Failure Banner Portal

```vue
<Teleport to="body">
  <div
    v-if="checkInFailureText"
    class="portal-checkin-banner"
    :style="{ zIndex: PORTAL_Z_BANNER }"
    role="alert"
    aria-live="assertive"
  >
    <div class="portal-checkin-banner-inner">
      <strong>Check in — app message</strong>
      <p class="checkin-fail-text">{{ checkInFailureText }}</p>
    </div>
    <button type="button" class="tap icon-close" aria-label="Dismiss" @click="dismissCheckInFailure">
      ×
    </button>
  </div>
</Teleport>
```

## Template - Check-In Success Banner Portal

```vue
<Teleport to="body">
  <div
    v-if="checkInSuccessBanner"
    class="portal-checkin-success"
    :style="{ zIndex: PORTAL_Z_BANNER }"
    role="status"
    aria-live="polite"
  >
    <div class="portal-checkin-success-inner">
      <strong>Check in</strong>
      <p class="checkin-success-text">{{ checkInSuccessBanner }}</p>
    </div>
    <button type="button" class="tap icon-close-success" aria-label="Dismiss" @click="dismissCheckInSuccess">
      ×
    </button>
  </div>
</Teleport>
```

## Template - Location Retry Modal Portal

```vue
<Teleport to="body">
  <div
    v-if="locationRetryOpen"
    class="portal-modal-backdrop"
    :style="{ zIndex: PORTAL_Z_MODAL }"
    role="presentation"
    @click.self="cancelLocationRetry"
  >
    <div
      class="portal-modal loc-retry-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loc-retry-title"
      @click.stop
    >
      <div class="loc-retry-header">
        <h3 id="loc-retry-title" class="loc-retry-title">Wrong dispatch location</h3>
        <button
          type="button"
          class="loc-retry-close tap"
          aria-label="Close"
          @click="cancelLocationRetry"
        >
          ×
        </button>
      </div>
      <p class="loc-retry-desc">
        Your saved <strong>Current location</strong> does not match FedEx. Enter the correct code below; it
        is saved to your assignment and the open browser session retries immediately (no new run).
      </p>
      <div class="portal-fedex-quote-box" role="note">
        <span class="portal-fedex-quote-label">FedEx message</span>
        <p class="portal-fedex-quote">{{ locationRetryFedexMessage }}</p>
      </div>
      <label class="modal-lbl" for="loc-retry-inp">New location code</label>
      <input
        id="loc-retry-inp"
        v-model="locationRetryInput"
        class="modal-inp loc-retry-inp"
        type="text"
        autocomplete="off"
        :disabled="locationRetrySubmitting"
        @keyup.enter="saveLocationAndRetryCheckIn"
      />
      <div class="modal-actions loc-retry-actions">
        <button type="button" class="btn secondary tap loc-retry-btn-secondary" @click="cancelLocationRetry">
          Cancel
        </button>
        <button
          type="button"
          class="btn primary tap loc-retry-btn-primary"
          :disabled="locationRetrySubmitting || !locationRetryInput.trim()"
          title="Save location to assignment and run Check in again"
          aria-label="Save location and retry check-in"
          @click="saveLocationAndRetryCheckIn"
        >
          {{ locationRetrySubmitting ? 'Saving…' : 'Save & retry' }}
        </button>
      </div>
    </div>
  </div>
</Teleport>
```

## Template - Location Retry Pending Banner

```vue
<div
  v-if="checkInLocationRetryPending && !runBusy"
  class="loc-retry-followup-banner"
  role="status"
  aria-live="polite"
>
  <div class="loc-retry-followup-inner">
    <strong>Location retry</strong>
    <p class="loc-retry-followup-text">
      Location saved. Starting Check in again as soon as the server is ready.
    </p>
  </div>
  <button type="button" class="btn secondary tap loc-retry-followup-stop" @click="stopLocationRetryWait">
    Stop
  </button>
</div>
```

## Template - Quick Actions Section (Original)

```vue
<section class="panel actions">
  <h2>Quick actions</h2>
  <p class="hint">
    Full Check in: tractor, location, then driver phone modal, assistance confirm, and sign out. Requires
    tractor, location, and phone number in Settings (Driver Credentials and Dispatch). Runs headless.
  </p>
  <button
    type="button"
    class="btn primary tap wide"
    :class="{ 'checkin-busy': runBusy }"
    :disabled="runBusy || checkInLocationRetryPending"
    :aria-busy="runBusy"
    :aria-label="
      runBusy
        ? `Check in in progress: ${checkInStepText || 'Starting…'}`
        : checkInLocationRetryPending
          ? 'Check in unavailable while a location retry is queued'
          : 'Check in'
    "
    @click="handleCheckIn"
  >
    {{
      runBusy
        ? checkInStepText || 'Starting…'
        : checkInLocationRetryPending
          ? 'Location retry queued…'
          : 'Check in'
    }}
  </button>
</section>
```

## Template - Location Dialog

```vue
<div
  v-if="locationDialogOpen"
  class="modal-backdrop"
  role="presentation"
  @click.self="cancelLocationDialog"
>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="loc-dialog-title">
    <h3 id="loc-dialog-title" class="modal-title">Current location</h3>
    <p class="modal-desc">Saved to your assignment and used for this Check in.</p>
    <input
      v-model="locationPromptValue"
      class="modal-inp"
      type="text"
      autocomplete="off"
      @keyup.enter="confirmLocationDialog"
    />
    <div class="modal-actions">
      <button type="button" class="btn secondary tap" @click="cancelLocationDialog">Cancel</button>
      <button type="button" class="btn primary tap" @click="confirmLocationDialog">Continue</button>
    </div>
  </div>
</div>
```

## Related CSS

```css
.portal-checkin-banner {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  padding-top: max(0.65rem, env(safe-area-inset-top));
  background: #3e1a1a;
  border-bottom: 1px solid #e57373;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  max-height: min(42vh, 320px);
  overflow-y: auto;
  font-size: 0.9rem;
  box-sizing: border-box;
}
/* ... and many more CSS rules for banners, modals, location retry, etc. */
```

---

## Notes

This check-in logic was tightly coupled to:
1. The old scenario-based runner (`postRun({ scenario: 'check_in', ... })`)
2. FedEx-specific banner handling and location mismatch retries
3. In-browser retry via `POST /api/run/retry-location`

The new automation system replaces this with:
1. Granular action blocks in `server/playwright/blocks.mjs`
2. User-configurable automations with triggers, conditions, and actions
3. The `handleBanner` and `fillCheckInForm` FedEx-specific blocks
