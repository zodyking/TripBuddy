import './utils/leafletDefaultIcons.js'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'

const app = createApp(App)

app.config.warnHandler = (msg, instance, trace) => {
  console.warn('[Vue warn]', msg, trace)
}

app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue error]', info, err)
  try {
    const root = document.getElementById('app')
    if (root && !root.querySelector('.fedextool-fatal-fallback')) {
      root.innerHTML = `<div class="fedextool-fatal-fallback" style="min-height:100vh;padding:1.25rem;font-family:system-ui,sans-serif;background:#0f0f14;color:#f4f4f8;">
        <p style="margin:0 0 0.75rem;font-weight:700;">Something went wrong</p>
        <p style="margin:0 0 1rem;color:#a8a8b8;font-size:0.9rem;line-height:1.45;">The app hit an unexpected error. Refresh the page to continue.</p>
        <button type="button" onclick="location.reload()" style="padding:0.55rem 1rem;border-radius:8px;border:1px solid #7b4db5;background:#7b4db5;color:#fff;font-weight:600;cursor:pointer;">Reload</button>
      </div>`
    }
  } catch {
    /* ignore */
  }
}

app.use(router).mount('#app')
