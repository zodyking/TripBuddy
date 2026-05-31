import { ref } from 'vue'
import {
  setWahaChatId,
  setWahaTtsEnabled,
  setWahaDailyBriefingEnabled,
  setWahaAutoRespondPhoneEnabled,
  setWahaAutoRespondWhereEnabled,
  setWahaAutoRespondWhoAtEnabled,
  setWahaBaseUrl,
  setWahaApiKey,
  getWahaChatId,
  getWahaUrlForSettings,
  getWahaApiKeyForSettings,
} from './wahaApi.js'
import { putWahaPrefs } from '../api.js'

/** False until first server hydrate attempt finishes (success or skip). */
export const wahaPrefsHydrated = ref(false)

/** While > 0, ignore credential merges for WAHA prefs (avoids stale GET overwriting a PUT). */
let applyFromCredentialsPaused = 0

let hydratePromise = null

export function pauseApplyWahaPrefsFromCredentials() {
  applyFromCredentialsPaused += 1
}

export function resumeApplyWahaPrefsFromCredentials() {
  applyFromCredentialsPaused = Math.max(0, applyFromCredentialsPaused - 1)
}

/**
 * Apply values from `GET /api/settings/credentials` (PostgreSQL-backed).
 * @param {unknown} meta
 */
export function applyWahaPrefsFromCredentials(meta) {
  if (applyFromCredentialsPaused > 0) return
  if (!meta || typeof meta !== 'object') return
  const m = /** @type {Record<string, unknown>} */ (meta)
  const hasChat = Object.prototype.hasOwnProperty.call(m, 'wahaChatId')
  const hasTts = Object.prototype.hasOwnProperty.call(m, 'wahaTtsEnabled')
  const hasBriefing = Object.prototype.hasOwnProperty.call(m, 'wahaDailyBriefingEnabled')
  const hasArPhone = Object.prototype.hasOwnProperty.call(m, 'wahaAutoRespondPhoneEnabled')
  const hasArWhere = Object.prototype.hasOwnProperty.call(m, 'wahaAutoRespondWhereEnabled')
  const hasArWhoAt = Object.prototype.hasOwnProperty.call(m, 'wahaAutoRespondWhoAtEnabled')
  const hasUrl = Object.prototype.hasOwnProperty.call(m, 'wahaUrl')
  const hasApiKey = Object.prototype.hasOwnProperty.call(m, 'wahaApiKey')

  if (hasChat && typeof m.wahaChatId === 'string' && m.wahaChatId.trim()) {
    setWahaChatId(m.wahaChatId.trim())
  }
  if (hasTts && typeof m.wahaTtsEnabled === 'boolean') {
    setWahaTtsEnabled(m.wahaTtsEnabled)
  }
  if (hasBriefing && typeof m.wahaDailyBriefingEnabled === 'boolean') {
    setWahaDailyBriefingEnabled(m.wahaDailyBriefingEnabled)
  }
  if (hasArPhone && typeof m.wahaAutoRespondPhoneEnabled === 'boolean') {
    setWahaAutoRespondPhoneEnabled(m.wahaAutoRespondPhoneEnabled)
  }
  if (hasArWhere && typeof m.wahaAutoRespondWhereEnabled === 'boolean') {
    setWahaAutoRespondWhereEnabled(m.wahaAutoRespondWhereEnabled)
  }
  if (hasArWhoAt && typeof m.wahaAutoRespondWhoAtEnabled === 'boolean') {
    setWahaAutoRespondWhoAtEnabled(m.wahaAutoRespondWhoAtEnabled)
  }
  if (hasUrl && typeof m.wahaUrl === 'string' && m.wahaUrl.trim()) {
    setWahaBaseUrl(m.wahaUrl.trim())
  }
  if (hasApiKey && typeof m.wahaApiKey === 'string' && m.wahaApiKey.trim()) {
    setWahaApiKey(m.wahaApiKey.trim())
  }
}

/**
 * Load WhatsApp prefs for the signed-in account into localStorage.
 * Safe when not logged in (marks hydrated, no-op).
 */
export async function hydrateWahaPrefsFromServer() {
  if (typeof window === 'undefined') {
    wahaPrefsHydrated.value = true
    return
  }
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    try {
      const r = await fetch('/api/settings/credentials', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json().catch(() => ({}))
        applyWahaPrefsFromCredentials(data)
        const serverChat =
          typeof data.wahaChatId === 'string' ? data.wahaChatId.trim() : ''
        const localChat = getWahaChatId()
        if (!serverChat && localChat) {
          void syncCurrentWahaChatIdToServer().catch(() => {})
        }
        const localUrl = getWahaUrlForSettings()
        const serverUrl = typeof data.wahaUrl === 'string' ? data.wahaUrl.trim() : ''
        if (!serverUrl && localUrl) {
          void saveWahaPrefsToServer({ wahaUrl: localUrl }).catch(() => {})
        }
        const localKey = getWahaApiKeyForSettings()
        if (!data.wahaApiKey && localKey) {
          void saveWahaPrefsToServer({ wahaApiKey: localKey }).catch(() => {})
        }
      }
    } catch {
      /* ignore */
    } finally {
      wahaPrefsHydrated.value = true
      hydratePromise = null
    }
  })()
  return hydratePromise
}

/** Wait for in-flight or start hydration before checking configured state. */
export async function ensureWahaPrefsHydrated() {
  if (wahaPrefsHydrated.value) return
  await hydrateWahaPrefsFromServer()
}

/**
 * Persist WhatsApp prefs to PostgreSQL (and localStorage).
 * @param {{
 *   chatId?: string,
 *   ttsEnabled?: boolean,
 *   dailyBriefingEnabled?: boolean,
 *   autoRespondPhoneEnabled?: boolean,
 *   autoRespondWhereEnabled?: boolean,
 *   autoRespondWhoAtEnabled?: boolean,
 * }} prefs
 */
export async function saveWahaPrefsToServer(prefs) {
  const body = {}
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'chatId')) {
    const chatId = String(prefs.chatId ?? '').trim()
    setWahaChatId(chatId)
    body.chatId = chatId
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'ttsEnabled')) {
    setWahaTtsEnabled(Boolean(prefs.ttsEnabled))
    body.ttsEnabled = Boolean(prefs.ttsEnabled)
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'dailyBriefingEnabled')) {
    setWahaDailyBriefingEnabled(Boolean(prefs.dailyBriefingEnabled))
    body.dailyBriefingEnabled = Boolean(prefs.dailyBriefingEnabled)
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoRespondPhoneEnabled')) {
    setWahaAutoRespondPhoneEnabled(Boolean(prefs.autoRespondPhoneEnabled))
    body.autoRespondPhoneEnabled = Boolean(prefs.autoRespondPhoneEnabled)
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoRespondWhereEnabled')) {
    setWahaAutoRespondWhereEnabled(Boolean(prefs.autoRespondWhereEnabled))
    body.autoRespondWhereEnabled = Boolean(prefs.autoRespondWhereEnabled)
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoRespondWhoAtEnabled')) {
    setWahaAutoRespondWhoAtEnabled(Boolean(prefs.autoRespondWhoAtEnabled))
    body.autoRespondWhoAtEnabled = Boolean(prefs.autoRespondWhoAtEnabled)
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'wahaUrl')) {
    const url = String(prefs.wahaUrl ?? '').trim()
    setWahaBaseUrl(url)
    body.wahaUrl = url
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'wahaApiKey')) {
    const key = String(prefs.wahaApiKey ?? '').trim()
    setWahaApiKey(key)
    body.wahaApiKey = key
  }

  pauseApplyWahaPrefsFromCredentials()
  try {
    await putWahaPrefs(body)
  } finally {
    resumeApplyWahaPrefsFromCredentials()
  }
}

/** Save current chat ID to server (e.g. after selecting a chat). */
export async function syncCurrentWahaChatIdToServer() {
  await saveWahaPrefsToServer({ chatId: getWahaChatId() })
}
