<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAuthStatus, postAuthLogin } from '../api.js'

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
    <div class="login-main">
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

    <footer class="login-tos" role="contentinfo">
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
  border-top: 1px solid rgba(248, 113, 113, 0.25);
  background: linear-gradient(
    180deg,
    transparent,
    rgba(40, 10, 10, 0.5) 25%,
    rgba(8, 8, 10, 0.95) 55%
  );
}

.login-tos-heading {
  margin: 0 0 var(--space-3, 0.75rem);
  font-size: var(--text-sm, 0.8125rem);
  font-weight: var(--weight-semibold, 600);
  letter-spacing: var(--tracking-wide, 0.025em);
  text-align: center;
  color: #fca5a5;
}

.login-tos-text {
  margin: 0 auto;
  max-width: 42rem;
  font-size: var(--text-xs, 0.6875rem);
  line-height: 1.55;
  color: #fecaca;
  text-align: center;
  text-wrap: pretty;
}
</style>
