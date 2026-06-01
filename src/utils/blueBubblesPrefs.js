import { ref } from 'vue'
import {
  setBlueBubblesChatGuid,
  setBlueBubblesTtsEnabled,
  setBlueBubblesAutoReplyEnabled,
  setBlueBubblesBaseUrl,
  setBlueBubblesPassword,
  setBlueBubblesContactRules,
  getBlueBubblesChatGuid,
  getBlueBubblesRemoteUrl,
  getBlueBubblesPassword,
  setBlueBubblesServerBacked,
  setBlueBubblesWebhookRegistered,
  isBlueBubblesWebhookRegistered,
} from './blueBubblesApi.js'
import { putBlueBubblesPrefs, registerBlueBubblesWebhook } from '../api.js'
import { sanitizeContactRules } from '../constants/blueBubblesContactRules.js'

export const blueBubblesPrefsHydrated = ref(false)

let applyFromCredentialsPaused = 0
let hydratePromise = null

export function pauseApplyBlueBubblesPrefsFromCredentials() {
  applyFromCredentialsPaused += 1
}

export function resumeApplyBlueBubblesPrefsFromCredentials() {
  applyFromCredentialsPaused = Math.max(0, applyFromCredentialsPaused - 1)
}

/**
 * @param {unknown} meta
 */
export function applyBlueBubblesPrefsFromCredentials(meta) {
  if (applyFromCredentialsPaused > 0) return
  if (!meta || typeof meta !== 'object') return
  const m = /** @type {Record<string, unknown>} */ (meta)

  if (Object.prototype.hasOwnProperty.call(m, 'blueBubblesChatGuid') && typeof m.blueBubblesChatGuid === 'string') {
    const guid = m.blueBubblesChatGuid.trim()
    if (guid) setBlueBubblesChatGuid(guid)
  }
  if (Object.prototype.hasOwnProperty.call(m, 'blueBubblesTtsEnabled') && typeof m.blueBubblesTtsEnabled === 'boolean') {
    setBlueBubblesTtsEnabled(m.blueBubblesTtsEnabled)
  }
  if (Object.prototype.hasOwnProperty.call(m, 'blueBubblesAutoReplyEnabled') && typeof m.blueBubblesAutoReplyEnabled === 'boolean') {
    setBlueBubblesAutoReplyEnabled(m.blueBubblesAutoReplyEnabled)
  }
  if (Object.prototype.hasOwnProperty.call(m, 'blueBubblesUrl') && typeof m.blueBubblesUrl === 'string' && m.blueBubblesUrl.trim()) {
    setBlueBubblesBaseUrl(m.blueBubblesUrl.trim())
  }
  if (Object.prototype.hasOwnProperty.call(m, 'blueBubblesPassword') && typeof m.blueBubblesPassword === 'string' && m.blueBubblesPassword.trim() && m.blueBubblesPassword !== '••••') {
    setBlueBubblesPassword(m.blueBubblesPassword.trim())
  }
  if (Object.prototype.hasOwnProperty.call(m, 'blueBubblesContactRules') && Array.isArray(m.blueBubblesContactRules)) {
    setBlueBubblesContactRules(sanitizeContactRules(m.blueBubblesContactRules))
  }
  const webhookToken =
    typeof m.blueBubblesWebhookToken === 'string' ? m.blueBubblesWebhookToken.trim() : ''
  setBlueBubblesWebhookRegistered(!!webhookToken)

  const serverUrl = typeof m.blueBubblesUrl === 'string' ? m.blueBubblesUrl.trim() : ''
  const pwField = typeof m.blueBubblesPassword === 'string' ? m.blueBubblesPassword.trim() : ''
  const passwordOnServer = pwField === '••••'
  const localReady = !!(getBlueBubblesRemoteUrl() && getBlueBubblesPassword())
  setBlueBubblesServerBacked(!!(serverUrl && passwordOnServer) || localReady)
}

export async function hydrateBlueBubblesPrefsFromServer() {
  if (typeof window === 'undefined') {
    blueBubblesPrefsHydrated.value = true
    return
  }
  if (hydratePromise) return hydratePromise
  hydratePromise = (async () => {
    try {
      const r = await fetch('/api/settings/credentials', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json().catch(() => ({}))
        applyBlueBubblesPrefsFromCredentials(data)
        const serverGuid = typeof data.blueBubblesChatGuid === 'string' ? data.blueBubblesChatGuid.trim() : ''
        const localGuid = getBlueBubblesChatGuid()
        if (!serverGuid && localGuid) {
          void syncCurrentBlueBubblesChatToServer().catch(() => {})
        }
      }
    } catch {
      /* ignore */
    } finally {
      blueBubblesPrefsHydrated.value = true
      hydratePromise = null
    }
  })()
  return hydratePromise
}

export async function ensureBlueBubblesPrefsHydrated() {
  if (blueBubblesPrefsHydrated.value) return
  await hydrateBlueBubblesPrefsFromServer()
}

/**
 * @param {{
 *   chatGuid?: string,
 *   ttsEnabled?: boolean,
 *   autoReplyEnabled?: boolean,
 *   serverUrl?: string,
 *   password?: string,
 *   contactRules?: unknown[],
 * }} prefs
 */
export async function saveBlueBubblesPrefsToServer(prefs) {
  const body = {}
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'chatGuid')) {
    const chatGuid = String(prefs.chatGuid ?? '').trim()
    setBlueBubblesChatGuid(chatGuid)
    body.chatGuid = chatGuid
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'ttsEnabled')) {
    setBlueBubblesTtsEnabled(Boolean(prefs.ttsEnabled))
    body.ttsEnabled = Boolean(prefs.ttsEnabled)
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'autoReplyEnabled')) {
    setBlueBubblesAutoReplyEnabled(Boolean(prefs.autoReplyEnabled))
    body.autoReplyEnabled = Boolean(prefs.autoReplyEnabled)
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'serverUrl')) {
    const url = String(prefs.serverUrl ?? '').trim()
    setBlueBubblesBaseUrl(url)
    body.serverUrl = url
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'password')) {
    const pw = String(prefs.password ?? '').trim()
    if (pw && pw !== '••••') {
      setBlueBubblesPassword(pw)
      body.password = pw
    }
  }
  if (prefs && Object.prototype.hasOwnProperty.call(prefs, 'contactRules')) {
    const rules = sanitizeContactRules(prefs.contactRules)
    setBlueBubblesContactRules(rules)
    body.contactRules = rules
  }

  pauseApplyBlueBubblesPrefsFromCredentials()
  try {
    return await putBlueBubblesPrefs(body)
  } finally {
    resumeApplyBlueBubblesPrefsFromCredentials()
  }
}

export async function syncCurrentBlueBubblesChatToServer() {
  await saveBlueBubblesPrefsToServer({ chatGuid: getBlueBubblesChatGuid() })
}

export async function registerBlueBubblesWebhookOnServer() {
  return registerBlueBubblesWebhook()
}
