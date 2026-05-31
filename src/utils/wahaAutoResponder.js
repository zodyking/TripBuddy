/**
 * WhatsApp auto-responders for monitored chat (new incoming messages only).
 */
import { fetchDirectory } from '../api.js'
import { sendChatMessage, getWahaChatId, isWahaConfigured } from './wahaApi.js'
import {
  isWahaAutoRespondPhoneEnabled,
  isWahaAutoRespondWhereEnabled,
  isWahaAutoRespondWhoAtEnabled,
} from './wahaApi.js'
import { tripPresenceSnapshot } from '../stores/tripPresenceStore.js'
import { pushLiveLog } from '../stores/liveLogStore.js'

/** @typedef {'phone' | 'where' | 'whoAt'} AutoRespondIntentType */

/** @typedef {{ type: AutoRespondIntentType, locationId: string }} AutoRespondIntent */

/** @typedef {{ locationId: string, locationName?: string, phone?: string, address?: string }} DirectoryEntry */

const M_PER_MI = 1609.344

/** @type {Set<string>} */
const respondedMessageIds = new Set()
const RESPONDED_ID_CAP = 400

/** @type {{ locations: DirectoryEntry[], fetchedAt: number } | null} */
let directoryCache = null
const DIRECTORY_TTL_MS = 10 * 60 * 1000

/** @type {number} */
let lastReplyAt = 0
const REPLY_COOLDOWN_MS = 8000

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractLocationIds(text) {
  const t = String(text ?? '')
  const out = []
  for (const m of t.matchAll(/\b(\d{3,4})\b/g)) {
    if (m[1]) out.push(m[1])
  }
  return [...new Set(out)]
}

/**
 * Prefer location id nearest intent keywords.
 * @param {string} text
 * @param {string[]} ids
 * @returns {string}
 */
function pickLocationId(text, ids) {
  if (!ids.length) return ''
  if (ids.length === 1) return ids[0]
  const lower = text.toLowerCase()
  const patterns = [
    /\bat\s+(\d{3,4})\b/i,
    /\bfor\s+(\d{3,4})\b/i,
    /\bto\s+(\d{3,4})\b/i,
    /\blocation\s+(\d{3,4})\b/i,
    /\b(\d{3,4})\s+(phone|number)\b/i,
    /\b(phone|number)\s+(?:for|to|at)\s+(\d{3,4})\b/i,
    /where\s+(?:is|'s)\s+(?:location\s+)?(\d{3,4})\b/i,
  ]
  for (const re of patterns) {
    const m = lower.match(re)
    if (m) {
      const id = m[m.length - 1]
      if (id && ids.includes(id)) return id
    }
  }
  return ids[0]
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function matchesPhoneIntent(text) {
  const t = text.toLowerCase()
  if (/\b(phone|number|#|call)\b/.test(t) && /\b\d{3,4}\b/.test(t)) return true
  if (/what(?:'s| is)\s+(?:the\s+)?(?:phone|number)/i.test(t) && /\b\d{3,4}\b/.test(t)) return true
  if (/\b\d{3,4}\b.*\b(phone|number)\b/i.test(t)) return true
  if (/\b(phone|number)\b.*\b\d{3,4}\b/i.test(t)) return true
  return false
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function matchesWhereIntent(text) {
  const t = text.toLowerCase()
  if (!/\b\d{3,4}\b/.test(t)) return false
  if (/\bwhere\s+(?:is|'s)\b/.test(t)) return true
  if (/\blocation\s+of\b/.test(t)) return true
  if (/\bfind\s+(?:location\s+)?\d{3,4}\b/.test(t)) return true
  if (/\bwhere\s+(?:is|'s)\s+location\b/.test(t)) return true
  return false
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function matchesWhoAtIntent(text) {
  const t = text.toLowerCase()
  if (!/\b\d{3,4}\b/.test(t) && !/\blocation\b/.test(t)) return false
  if (/\bwho(?:'s| is)\b/.test(t) && /\bat\b/.test(t)) return true
  if (/\banyone\s+at\b/.test(t)) return true
  if (/\bwho(?:'s| is)\s+in\b/.test(t)) return true
  return false
}

/**
 * @param {string} text
 * @returns {AutoRespondIntent | null}
 */
export function detectAutoRespondIntent(text) {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 800) return null
  const ids = extractLocationIds(raw)
  const locationId = pickLocationId(raw, ids)
  if (!locationId) return null

  if (matchesWhoAtIntent(raw) && isWahaAutoRespondWhoAtEnabled()) {
    return { type: 'whoAt', locationId }
  }
  if (matchesPhoneIntent(raw) && isWahaAutoRespondPhoneEnabled()) {
    return { type: 'phone', locationId }
  }
  if (matchesWhereIntent(raw) && isWahaAutoRespondWhereEnabled()) {
    return { type: 'where', locationId }
  }
  return null
}

async function loadDirectory() {
  const now = Date.now()
  if (directoryCache && now - directoryCache.fetchedAt < DIRECTORY_TTL_MS) {
    return directoryCache.locations
  }
  try {
    const res = await fetchDirectory()
    const list = res?.locations && Array.isArray(res.locations) ? res.locations : []
    /** @type {DirectoryEntry[]} */
    const locations = list
      .map((row) => {
        if (!row || typeof row !== 'object') return null
        const id = String(row.locationId ?? '').trim()
        if (!id) return null
        return {
          locationId: id,
          locationName: String(row.locationName ?? '').trim(),
          phone: String(row.phone ?? '').trim(),
          address: String(row.address ?? '').trim(),
        }
      })
      .filter(Boolean)
    directoryCache = { locations, fetchedAt: now }
    return locations
  } catch {
    return directoryCache?.locations ?? []
  }
}

/**
 * @param {string} locationId
 * @returns {Promise<DirectoryEntry | null>}
 */
async function findDirectoryEntry(locationId) {
  const want = String(locationId ?? '').trim()
  if (!want) return null
  const list = await loadDirectory()
  return list.find((e) => e.locationId === want) || null
}

/**
 * @param {number | null} meters
 * @returns {string}
 */
function formatMilesRemaining(meters) {
  if (meters == null || !Number.isFinite(+meters) || +meters < 0) return ''
  const mi = +meters / M_PER_MI
  if (mi < 0.1) return 'less than 0.1'
  if (mi < 10) return String(Math.round(mi * 10) / 10)
  return String(Math.round(mi))
}

/**
 * @param {AutoRespondIntent} intent
 * @param {DirectoryEntry | null} entry
 * @returns {string}
 */
export function buildAutoRespondReply(intent, entry) {
  const id = intent.locationId
  const name = entry?.locationName?.trim() || `location ${id}`

  if (intent.type === 'phone') {
    const phone = entry?.phone?.trim()
    if (phone) return `${id} (${name}): ${phone}`
    return `I don't have a phone number on file for ${id}.`
  }

  if (intent.type === 'where') {
    const addr = entry?.address?.trim()
    if (addr) return `${id} — ${name}. ${addr}`
    if (entry?.locationName) return `${id} — ${name}.`
    return `I don't have an address on file for ${id}.`
  }

  if (intent.type === 'whoAt') {
    const p = tripPresenceSnapshot.value
    const asked = id
    const tractor = String(p.tractorLocationId ?? '').trim()
    const dest = String(p.tripDestLocationId ?? '').trim()
    const phase = String(p.tripPhase ?? '').trim().toUpperCase()

    if (tractor && tractor === asked) {
      return `I'm there.`
    }

    if (phase === 'ENRT' && dest && dest === asked) {
      const mi = formatMilesRemaining(p.remainingDistM)
      if (mi) return `I'm about ${mi} mi away from ${asked}.`
      return `I'm en route to ${asked}.`
    }

    return ''
  }

  return ''
}

function markResponded(messageId) {
  respondedMessageIds.add(messageId)
  if (respondedMessageIds.size > RESPONDED_ID_CAP) {
    const first = respondedMessageIds.values().next().value
    if (first) respondedMessageIds.delete(first)
  }
}

/**
 * Handle one new incoming normalized chat message.
 * @param {{ id: string, text?: string, fromMe?: boolean, ts?: number }} msg
 */
export async function handleIncomingAutoRespond(msg) {
  if (!msg?.id || msg.fromMe) return
  if (!isWahaConfigured()) return
  if (!getWahaChatId()) return
  if (respondedMessageIds.has(msg.id)) return

  const text = String(msg.text ?? '').trim()
  if (!text) return

  const intent = detectAutoRespondIntent(text)
  if (!intent) return

  const now = Date.now()
  if (now - lastReplyAt < REPLY_COOLDOWN_MS) return

  const entry =
    intent.type === 'whoAt' ? null : await findDirectoryEntry(intent.locationId)
  const reply = buildAutoRespondReply(intent, entry)
  if (!reply.trim()) return

  try {
    const r = await sendChatMessage(reply)
    if (!r.ok) {
      pushLiveLog({
        type: 'warn',
        message: `[WhatsApp] Auto-reply failed (${r.status})`,
        ts: Date.now(),
      })
      return
    }
    markResponded(msg.id)
    lastReplyAt = now
    pushLiveLog({
      type: 'info',
      message: `[WhatsApp] Auto-reply (${intent.type}): ${reply.slice(0, 80)}`,
      ts: Date.now(),
    })
  } catch (e) {
    pushLiveLog({
      type: 'warn',
      message: `[WhatsApp] Auto-reply error: ${e instanceof Error ? e.message : String(e)}`,
      ts: Date.now(),
    })
  }
}

/**
 * @param {Array<{ id: string, text?: string, fromMe?: boolean }>} newMessages newest-first or any order
 * @param {{ skipIfNoPriorMessages?: boolean, hadPriorMessages?: boolean }} [opts]
 */
export function handleNewIncomingAutoRespondBatch(newMessages, opts = {}) {
  if (opts.skipIfNoPriorMessages && !opts.hadPriorMessages) return
  if (!Array.isArray(newMessages) || !newMessages.length) return
  const sorted = [...newMessages].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  for (const m of sorted) {
    void handleIncomingAutoRespond(m)
  }
}
