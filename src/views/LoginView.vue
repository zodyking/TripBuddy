<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAuthStatus, postAuthLogin, postLoginAccessLog } from '../api.js'
import LoginAckMap from '../components/LoginAckMap.vue'

const ACCESS_ACK_KEY = 'fedextool-login-access-ack-v3'

const route = useRoute()
const router = useRouter()

const accessAcknowledged = ref(false)
/** 1 = checkboxes, 2 = location + map */
const accessStep = ref(1)
const ackRealPerson = ref(false)
const ackNotSecurityOrMarketingVendor = ref(false)

/** Step 2: browser geolocation */
const geoLat = ref(/** @type {number | null} */ (null))
const geoLng = ref(/** @type {number | null} */ (null))
const geoAccuracyM = ref(/** @type {number | null} */ (null))
const geoPending = ref(false)
const geoDenied = ref(false)

/** Live updates on step 2 (same pattern as Directory / trailer maps). */
/** @type {number | null} */
let geoWatchId = null

const username = ref('')
const password = ref('')
const submitting = ref(false)
const errorMsg = ref('')

const canContinueAck = computed(
  () => ackRealPerson.value && ackNotSecurityOrMarketingVendor.value,
)

/** Step 2 complete only after a successful browser location fix (no skip). */
const locationReceived = computed(
  () =>
    geoLat.value != null &&
    geoLng.value != null &&
    Number.isFinite(geoLat.value) &&
    Number.isFinite(geoLng.value),
)

const mapLat = computed(() => geoLat.value)
const mapLng = computed(() => geoLng.value)
const mapAcc = computed(() => geoAccuracyM.value)
/** Map shows NYC until we have a fix; after denial, fall back to default view. */
const mapPending = computed(
  () => geoPending.value || (geoLat.value == null && !geoDenied.value),
)

function redirectTarget() {
  const r = route.query.redirect
  if (typeof r === 'string' && r.startsWith('/') && !r.startsWith('//')) {
    return r
  }
  return '/'
}

onMounted(async () => {
  try {
    if (sessionStorage.getItem(ACCESS_ACK_KEY) === '1') {
      accessAcknowledged.value = true
    }
  } catch {
    /* private mode */
  }
  try {
    const s = await getAuthStatus()
    if (!s.authEnabled || s.authenticated) {
      await router.replace(redirectTarget())
    }
  } catch {
    /* stay on login */
  }
})

async function sendAccessLog(payload) {
  try {
    await postLoginAccessLog(payload)
  } catch {
    /* still allow continue if coords are valid — server may be unreachable */
  }
}

function clearGeoWatch() {
  if (geoWatchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId)
  }
  geoWatchId = null
}

/** Step 1 Continue: request location (same user gesture), then show map on step 2. */
function continueFromStepOne() {
  if (!canContinueAck.value) return
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    geoDenied.value = true
    return
  }
  clearGeoWatch()
  geoPending.value = true
  geoDenied.value = false
  geoLat.value = null
  geoLng.value = null
  geoAccuracyM.value = null

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      geoPending.value = false
      geoLat.value = pos.coords.latitude
      geoLng.value = pos.coords.longitude
      geoAccuracyM.value =
        pos.coords.accuracy != null && Number.isFinite(pos.coords.accuracy)
          ? pos.coords.accuracy
          : null
      await sendAccessLog({
        username: username.value,
        latitude: geoLat.value,
        longitude: geoLng.value,
        accuracyM: geoAccuracyM.value,
        locationDenied: false,
      })
      accessStep.value = 2
      geoWatchId = navigator.geolocation.watchPosition(
        (p) => {
          geoLat.value = p.coords.latitude
          geoLng.value = p.coords.longitude
          geoAccuracyM.value =
            p.coords.accuracy != null && Number.isFinite(p.coords.accuracy)
              ? p.coords.accuracy
              : null
        },
        () => {
          /* keep last fix */
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10_000,
        },
      )
      nextTick(() => {
        window.dispatchEvent(new Event('resize'))
      })
    },
    async () => {
      geoPending.value = false
      geoDenied.value = true
      await sendAccessLog({ username: username.value, locationDenied: true })
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20_000,
    },
  )
}

function confirmAccessAcknowledgment() {
  if (!locationReceived.value) return
  clearGeoWatch()
  try {
    sessionStorage.setItem(ACCESS_ACK_KEY, '1')
  } catch {
    /* ignore */
  }
  accessAcknowledged.value = true
}

onBeforeUnmount(() => {
  clearGeoWatch()
})

async function onSubmit() {
  errorMsg.value = ''
  const u = username.value.trim()
  const p = password.value
  if (!u || !p) {
    errorMsg.value = 'Enter username and password.'
    return
  }
  submitting.value = true
  try {
    await postAuthLogin({ username: u, password: p })
    const target = redirectTarget()
    if (typeof window !== 'undefined') {
      const base = import.meta.env.BASE_URL || '/'
      const path = target.startsWith('/') ? target : `/${target}`
      window.location.assign(`${base.replace(/\/$/, '')}${path}`)
      return
    }
    await router.replace(target)
  } catch (e) {
    errorMsg.value =
      e instanceof Error ? e.message : 'Sign-in failed. Check credentials.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-bg-glow" aria-hidden="true" />

    <!-- Mandatory acknowledgment before sign-in -->
    <Teleport to="body">
      <div
        v-if="!accessAcknowledged"
        class="login-access-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-access-title"
        aria-describedby="login-access-desc"
      >
        <div class="login-access-card glass" @click.stop>
          <template v-if="accessStep === 1">
            <h2 id="login-access-title" class="login-access-title">
              Access Acknowledgment
            </h2>
            <p id="login-access-desc" class="login-access-lead">
              IP and approximate location may be recorded. Continue requests browser location.
            </p>
            <ul class="login-access-list" role="list">
              <li class="login-access-item">
                <label class="login-access-label tap">
                  <input
                    v-model="ackRealPerson"
                    type="checkbox"
                    class="login-access-cb"
                  />
                  <span>I am a real person, not a bot.</span>
                </label>
              </li>
              <li class="login-access-item">
                <label class="login-access-label tap">
                  <input
                    v-model="ackNotSecurityOrMarketingVendor"
                    type="checkbox"
                    class="login-access-cb"
                  />
                  <span>I am not a security firm or marketing vendor.</span>
                </label>
              </li>
            </ul>
            <button
              type="button"
              class="login-access-btn tap"
              :disabled="!canContinueAck || geoPending"
              @click="continueFromStepOne"
            >
              <template v-if="geoPending">Requesting location…</template>
              <template v-else>Continue</template>
            </button>
            <p v-if="geoDenied && !geoPending" class="login-access-loc-note" role="status">
              Allow location in the browser prompt, then Continue again.
            </p>
          </template>

          <template v-else>
            <h2 class="login-access-title">Your Location</h2>

            <LoginAckMap
              :lat="mapLat"
              :lng="mapLng"
              :accuracy-m="mapAcc"
              :pending="mapPending"
              smooth-follow
            />

            <div class="login-access-loc-actions">
              <button
                type="button"
                class="login-access-btn tap"
                :disabled="!locationReceived"
                @click="confirmAccessAcknowledgment"
              >
                Continue
              </button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>

    <div
      class="login-main"
      :class="{ 'is-behind-access': !accessAcknowledged }"
      :inert="!accessAcknowledged"
      :aria-hidden="!accessAcknowledged"
    >
      <div class="login-card glass">
        <h1 class="login-title">Sign in</h1>

        <form class="login-form" @submit.prevent="onSubmit">
          <label class="login-label">
            <span>Username</span>
            <input
              v-model="username"
              class="login-input"
              type="text"
              name="username"
              autocomplete="username"
              :disabled="submitting || !accessAcknowledged"
            />
          </label>
          <label class="login-label">
            <span>Password</span>
            <input
              v-model="password"
              class="login-input"
              type="password"
              name="password"
              autocomplete="current-password"
              :disabled="submitting || !accessAcknowledged"
            />
          </label>

          <p v-if="errorMsg" class="login-err" role="alert">{{ errorMsg }}</p>

          <button
            type="submit"
            class="login-submit tap"
            :disabled="submitting || !accessAcknowledged"
          >
            <span v-if="submitting" class="login-submit-inner">
              <span class="login-spinner" aria-hidden="true" />
              Verifying…
            </span>
            <span v-else>Continue</span>
          </button>
        </form>
      </div>
    </div>

    <footer
      v-show="accessAcknowledged"
      class="login-tos"
      role="contentinfo"
    >
      <h2 class="login-tos-heading">Terms of Use</h2>
      <p class="login-tos-text">
        By accessing or using this site, you agree to our Terms of Service and all applicable laws. Automated access is strictly prohibited, including bots, scrapers, crawlers, monitoring tools, and similar systems. Access or use by operational security firms, intelligence vendors, surveillance companies, investigative service providers, or similar entities is not permitted without our prior written consent. Unauthorized use may result in blocked access, termination, and legal action.
      </p>
    </footer>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow-x: hidden;
}

.login-bg-glow {
  position: fixed;
  inset: -40% -20%;
  background:
    radial-gradient(ellipse 50% 40% at 50% 0%, rgba(123, 77, 181, 0.22), transparent 70%),
    radial-gradient(ellipse 40% 30% at 80% 60%, rgba(255, 107, 26, 0.08), transparent 65%);
  pointer-events: none;
  z-index: 0;
}

/* Access gate */
.login-access-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4, 1rem);
  padding-bottom: max(var(--space-4, 1rem), env(safe-area-inset-bottom));
  background: rgba(6, 6, 10, 0.88);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.login-access-card {
  width: 100%;
  max-width: 24rem;
  max-height: min(92vh, 44rem);
  overflow-y: auto;
  padding: var(--space-5, 1.25rem) var(--space-5, 1.25rem);
  border-radius: var(--radius-2xl, 1.25rem);
  border: 1px solid rgba(123, 77, 181, 0.35);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(123, 77, 181, 0.12);
}

.login-access-title {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-lg, 1.125rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
  text-align: center;
  letter-spacing: var(--tracking-tight, -0.02em);
}

.login-access-lead {
  margin: 0 0 var(--space-4, 1rem);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.45;
  color: var(--color-text-secondary, #a8a8b8);
  text-align: center;
}

.login-access-list {
  margin: 0 0 var(--space-4, 1rem);
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
}

.login-access-item {
  margin: 0;
}

.login-access-label {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2-5, 0.625rem);
  font-size: var(--text-sm, 0.8125rem);
  line-height: 1.4;
  color: var(--color-text-primary, #e8e8ee);
  cursor: pointer;
  text-align: left;
}

.login-access-cb {
  flex-shrink: 0;
  width: 1.1rem;
  height: 1.1rem;
  margin-top: 0.15rem;
  accent-color: var(--color-accent-purple, #7b4db5);
  cursor: pointer;
}

.login-access-btn {
  width: 100%;
  min-height: 2.75rem;
  border: none;
  border-radius: var(--radius-lg, 0.75rem);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  cursor: pointer;
  background: var(--color-accent-purple, #7b4db5);
  color: #fff;
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.25));
  transition: var(--transition-all);
}

.login-access-btn:hover:not(:disabled) {
  box-shadow: var(--shadow-glow-purple, 0 0 20px rgba(123, 77, 181, 0.35));
}

.login-access-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.login-access-loc-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
  margin: var(--space-3, 0.75rem) 0 0;
}

.login-access-loc-note {
  margin: var(--space-4, 1rem) 0 0;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.4;
  color: var(--color-text-tertiary, #6e6e7e);
  text-align: center;
}

.login-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6, 1.5rem);
  padding-top: max(var(--space-6, 1.5rem), env(safe-area-inset-top));
  position: relative;
  z-index: 1;
}

.login-main.is-behind-access {
  filter: blur(2px);
  user-select: none;
  pointer-events: none;
}

.login-card {
  width: 100%;
  max-width: 22rem;
  padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
  border-radius: var(--radius-2xl, 1.25rem);
  text-align: center;
  animation: login-fade 0.45s var(--ease-out) both;
}

@keyframes login-fade {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.login-title {
  margin: 0 0 var(--space-6, 1.5rem);
  font-size: var(--text-xl, 1.3125rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
  text-align: left;
}

.login-label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5, 0.375rem);
  font-size: var(--text-xs, 0.6875rem);
  font-weight: var(--weight-semibold, 600);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider, 0.05em);
  color: var(--color-text-tertiary, #6e6e7e);
}

.login-label span {
  text-align: left;
}

.login-input {
  padding: var(--space-3, 0.75rem) var(--space-3-5, 0.875rem);
  font-size: var(--text-base, 0.9375rem);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-lg, 0.75rem);
  outline: none;
  transition: var(--transition-colors);
  width: 100%;
  box-sizing: border-box;
}

.login-input:focus {
  border-color: var(--color-accent-purple, #7b4db5);
  background: rgba(255, 255, 255, 0.06);
}

.login-input:disabled {
  opacity: 0.6;
}

.login-err {
  margin: 0;
  font-size: var(--text-sm, 0.8125rem);
  color: var(--color-error, #ef4444);
  text-align: center;
}

.login-submit {
  margin-top: var(--space-1, 0.25rem);
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.75rem;
  border-radius: var(--radius-lg, 0.75rem);
  font-weight: var(--weight-semibold, 600);
  border: none;
  cursor: pointer;
  background: var(--color-accent-purple, #7b4db5);
  color: white;
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.25));
  transition: var(--transition-all);
}

.login-submit:hover:not(:disabled) {
  box-shadow: var(--shadow-glow-purple, 0 0 20px rgba(123, 77, 181, 0.25));
  transform: translateY(-1px);
}

.login-submit:disabled {
  opacity: 0.75;
  cursor: not-allowed;
  transform: none;
}

.login-submit-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.login-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: login-spin 0.7s linear infinite;
}

@keyframes login-spin {
  to {
    transform: rotate(360deg);
  }
}

.login-tos {
  flex-shrink: 0;
  padding: var(--space-5, 1.25rem) var(--space-4, 1rem)
    max(var(--space-6, 1.5rem), env(safe-area-inset-bottom));
  position: relative;
  z-index: 1;
  border-top: 1px solid rgba(123, 77, 181, 0.3);
  background: linear-gradient(
    180deg,
    transparent,
    rgba(45, 27, 72, 0.35) 30%,
    rgba(8, 8, 10, 0.96) 60%
  );
}

.login-tos-heading {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: var(--tracking-wide, 0.025em);
  text-align: center;
  color: #c4b5fd;
}

.login-tos-text {
  margin: 0 auto;
  max-width: 42rem;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.55;
  color: #ddd6fe;
  text-align: center;
  text-wrap: pretty;
}
</style>
