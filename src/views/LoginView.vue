<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAuthStatus, postAuthLogin, putCredentials } from '../api.js'

const route = useRoute()
const router = useRouter()

const username = ref('')
const password = ref('')
const submitting = ref(false)
const errorMsg = ref('')

function redirectTarget() {
  const r = route.query.redirect
  if (typeof r === 'string' && r.startsWith('/') && !r.startsWith('//')) {
    return r
  }
  return '/'
}

onMounted(async () => {
  try {
    const s = await getAuthStatus()
    if (!s.authEnabled || s.authenticated) {
      await router.replace(redirectTarget())
    }
  } catch {
    /* stay on login */
  }
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
    try {
      await putCredentials({ username: u, password: p })
    } catch {
      /* session is valid; Settings can be updated manually */
    }
    await router.replace(redirectTarget())
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
    <div class="login-card glass">
      <div class="login-brand">
        <span class="brand-fed">Fed</span><span class="brand-ex">Ex</span>
        <span class="brand-tool">Tool</span>
      </div>
      <h1 class="login-title">Sign in</h1>
      <p class="login-sub">
        Uses the same FedEx credentials as Settings. We verify by opening dispatch and completing PurpleID in the background.
      </p>

      <form class="login-form" @submit.prevent="onSubmit">
        <label class="login-label">
          <span>Username / Driver ID</span>
          <input
            v-model="username"
            class="login-input"
            type="text"
            name="username"
            autocomplete="username"
            :disabled="submitting"
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
            :disabled="submitting"
          />
        </label>

        <p v-if="errorMsg" class="login-err" role="alert">{{ errorMsg }}</p>

        <button
          type="submit"
          class="login-submit tap"
          :disabled="submitting"
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
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6, 1.5rem);
  padding-bottom: max(var(--space-6, 1.5rem), env(safe-area-inset-bottom));
  position: relative;
  overflow: hidden;
}

.login-bg-glow {
  position: absolute;
  inset: -40% -20%;
  background:
    radial-gradient(ellipse 50% 40% at 50% 0%, rgba(123, 77, 181, 0.22), transparent 70%),
    radial-gradient(ellipse 40% 30% at 80% 60%, rgba(255, 107, 26, 0.08), transparent 65%);
  pointer-events: none;
}

.login-card {
  position: relative;
  width: 100%;
  max-width: 22rem;
  padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
  border-radius: var(--radius-2xl, 1.25rem);
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

.login-brand {
  font-size: var(--text-xl, 1.3125rem);
  font-weight: var(--weight-bold, 700);
  letter-spacing: var(--tracking-tight, -0.02em);
  margin-bottom: var(--space-5, 1.25rem);
}

.brand-fed {
  color: var(--color-accent-purple, #7b4db5);
}
.brand-ex {
  color: var(--color-accent-orange, #ff6b1a);
}
.brand-tool {
  margin-left: 0.35rem;
  color: var(--color-text-secondary, #a8a8b8);
  font-weight: var(--weight-semibold, 600);
}

.login-title {
  margin: 0 0 var(--space-2, 0.5rem);
  font-size: var(--text-lg, 1.125rem);
  font-weight: var(--weight-semibold, 600);
  color: var(--color-text-primary, #f4f4f8);
}

.login-sub {
  margin: 0 0 var(--space-6, 1.5rem);
  font-size: var(--text-sm, 0.8125rem);
  line-height: var(--leading-snug, 1.35);
  color: var(--color-text-tertiary, #6e6e7e);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
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

.login-input {
  padding: var(--space-3, 0.75rem) var(--space-3-5, 0.875rem);
  font-size: var(--text-base, 0.9375rem);
  color: var(--color-text-primary, #f4f4f8);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-lg, 0.75rem);
  outline: none;
  transition: var(--transition-colors);
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
}

.login-submit {
  margin-top: var(--space-1, 0.25rem);
  width: 100%;
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
</style>
