/**
 * WhatsApp auto-responders for monitored chat (new incoming messages only).
 * Locations resolve against the shared directory by ID, name, or abbreviation.
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

/** @typedef {{
 *   type: AutoRespondIntentType,
 *   locationId: string,
 *   entry: DirectoryEntry,
 * }} AutoRespondIntent */

/**
 * @typedef {{
 *   locationId: string,
 *   locationName: string,
 *   abbreviation: string,
 *   phone: string,
 *   address: string,
 * }} DirectoryEntry
 */

const M_PER_MI = 1609.344
const MIN_NAME_ALIAS_LEN = 3

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
 * @param {string} s
 */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} s
 */
function normalizeForMatch(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractLocationIds(text) {
  const t = String(text ?? '')
  const out = []
  for (const m of t.matchAll(/\b(\d{1,4})\b/g)) {
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
    /\bat\s+(\d{1,4})\b/i,
    /\bfor\s+(\d{1,4})\b/i,
    /\bto\s+(\d{1,4})\b/i,
    /\blocation\s+(\d{1,4})\b/i,
    /\b(\d{1,4})\s+(phone|number)\b/i,
    /\b(phone|number)\s+(?:for|to|at|of)\s+(\d{1,4})\b/i,
    /where\s+(?:is|'s)\s+(?:location\s+)?(\d{1,4})\b/i,
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
 * @param {string} alias
 * @returns {RegExp | null}
 */
function aliasWordRegex(alias) {
  const a = normalizeForMatch(alias)
  if (!a) return null
  if (/^\d+$/.test(a)) {
    return new RegExp(`\\b${escapeRegex(a)}\\b`, 'i')
  }
  const parts = a.split(/\s+/).filter(Boolean)
  if (parts.length > 1) {
    const pat = parts.map(escapeRegex).join('\\s+')
    return new RegExp(`\\b${pat}\\b`, 'i')
  }
  return new RegExp(`\\b${escapeRegex(a)}\\b`, 'i')
}

/**
 * @param {DirectoryEntry | null | undefined} entry
 * @param {string} [fallbackId]
 */
export function locationDisplayLabel(entry, fallbackId = '') {
  const name = entry?.locationName?.trim()
  if (name) return name
  const abbr = entry?.abbreviation?.trim()
  if (abbr) return abbr
  return String(fallbackId || entry?.locationId || '').trim() || 'that location'
}

/**
 * Match message text to a directory row (ID, full name, or abbreviation).
 * @param {string} text
 * @param {DirectoryEntry[]} locations
 * @returns {DirectoryEntry | null}
 */
export function resolveLocationInMessage(text, locations) {
  const raw = String(text ?? '')
  if (!raw.trim() || !Array.isArray(locations) || !locations.length) return null

  const idSet = new Set(locations.map((e) => e.locationId))
  const numericHits = []
  for (const m of raw.matchAll(/\b(\d{1,4})\b/g)) {
    if (m[1] && idSet.has(m[1])) numericHits.push(m[1])
  }
  if (numericHits.length === 1) {
    return locations.find((e) => e.locationId === numericHits[0]) || null
  }
  if (numericHits.length > 1) {
    const picked = pickLocationId(raw, numericHits)
    return locations.find((e) => e.locationId === picked) || null
  }

  /** @type {{ entry: DirectoryEntry, alias: string, len: number }[]} */
  const candidates = []
  for (const entry of locations) {
    const aliases = []
    if (entry.locationName && entry.locationName.length >= MIN_NAME_ALIAS_LEN) {
      aliases.push(entry.locationName)
    }
    if (entry.abbreviation && entry.abbreviation.length >= MIN_NAME_ALIAS_LEN) {
      aliases.push(entry.abbreviation)
    }
    for (const alias of aliases) {
      candidates.push({ entry, alias, len: normalizeForMatch(alias).length })
    }
  }
  candidates.sort((a, b) => b.len - a.len)

  const hay = raw.toLowerCase()
  for (const { entry, alias } of candidates) {
    const re = aliasWordRegex(alias)
    if (re && re.test(hay)) return entry
  }

  return null
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function matchesPhoneIntent(text) {
  const t = text.toLowerCase()
  if (/what(?:'s| is)\s+(?:the\s+)?(?:phone|number)/i.test(t)) return true
  if (/\b(phone|number)\s+(?:for|to|at|of)\b/i.test(t)) return true
  if (/\b(phone|number|#|call)\b/i.test(t)) return true
  if (/\b\d{1,4}\b.*\b(phone|number)\b/i.test(t)) return true
  if (/\b(phone|number)\b.*\b\d{1,4}\b/i.test(t)) return true
  return false
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function matchesWhereIntent(text) {
  const t = text.toLowerCase()
  if (/\bwhere\s+(?:is|'s|are)\b/.test(t)) return true
  if (/\blocation\s+of\b/.test(t)) return true
  if (/\bfind\s+(?:the\s+)?(?:location|address)\b/.test(t)) return true
  if (/\baddress\s+(?:for|of)\b/.test(t)) return true
  return false
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function matchesWhoAtIntent(text) {
  const t = text.toLowerCase()
  if (/\bwho(?:'s| is)\b/.test(t) && /\b(at|in)\b/.test(t)) return true
  if (/\banyone\s+(?:at|in)\b/.test(t)) return true
  return false
}

/**
 * @param {string} text
 * @returns {AutoRespondIntentType | null}
 */
function classifyIntentType(text) {
  if (matchesWhoAtIntent(text) && isWahaAutoRespondWhoAtEnabled()) return 'whoAt'
  if (matchesPhoneIntent(text) && isWahaAutoRespondPhoneEnabled()) return 'phone'
  if (matchesWhereIntent(text) && isWahaAutoRespondWhereEnabled()) return 'where'
  return null
}

/**
 * @param {string} text
 * @returns {Promise<AutoRespondIntent | null>}
 */
export async function detectAutoRespondIntentAsync(text) {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 800) return null

  const type = classifyIntentType(raw)
  if (!type) return null

  const locations = await loadDirectory()
  const entry = resolveLocationInMessage(raw, locations)
  if (!entry) return null

  return { type, locationId: entry.locationId, entry }
}

/** @deprecated Use detectAutoRespondIntentAsync — sync path cannot load directory names. */
export function detectAutoRespondIntent(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const type = classifyIntentType(raw)
  if (!type) return null
  const ids = extractLocationIds(raw)
  const locationId = pickLocationId(raw, ids)
  if (!locationId) return null
  return { type, locationId }
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
          abbreviation: String(row.abbreviation ?? '').trim(),
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
 * @returns {string}
 */
export function buildAutoRespondReply(intent) {
  const entry = intent.entry
  const id = intent.locationId
  const label = locationDisplayLabel(entry, id)

  if (intent.type === 'phone') {
    const phone = entry?.phone?.trim()
    if (phone) return `${id} (${label}): ${phone}`
    return `I don't have a phone number on file for ${label}.`
  }

  if (intent.type === 'where') {
    const addr = entry?.address?.trim()
    if (addr) return `${id} — ${label}. ${addr}`
    if (entry?.locationName) return `${id} — ${label}.`
    return `I don't have an address on file for ${label}.`
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
      if (mi) return `I'm about ${mi} mi away from ${label}.`
      return `I'm en route to ${label}.`
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

  const intent = await detectAutoRespondIntentAsync(text)
  if (!intent) return

  const now = Date.now()
  if (now - lastReplyAt < REPLY_COOLDOWN_MS) return

  const reply = buildAutoRespondReply(intent)
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
