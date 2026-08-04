/**
 * Shared iMessage seen-ID tracker (one set for the whole app session).
 * New message = ID not seen before (after initial seed). No timestamp watermark.
 */

/** @type {Set<string>} */
const seenIds = new Set()
let seeded = false

const SEEN_CAP = 2000
const SEEN_TRIM = 500

function trimSeen() {
  if (seenIds.size <= SEEN_CAP) return
  for (const id of [...seenIds].slice(0, SEEN_TRIM)) seenIds.delete(id)
}

/**
 * @param {Array<{ id?: string }>} messages
 */
export function seedInboxTracker(messages) {
  for (const m of messages) {
    const id = String(m?.id ?? '').trim()
    if (id) seenIds.add(id)
  }
  seeded = true
  trimSeen()
}

/**
 * Mark as seen without TTS (thread history loaded in UI).
 * @param {Array<{ id?: string }>} messages
 */
export function markInboxMessagesSeen(messages) {
  if (!Array.isArray(messages)) return
  for (const m of messages) {
    const id = String(m?.id ?? '').trim()
    if (id) seenIds.add(id)
  }
  trimSeen()
}

export function isInboxTrackerSeeded() {
  return seeded
}

/**
 * @param {Array<{ id: string }>} messages
 * @returns {typeof messages}
 */
export function filterNewInboxMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return []

  if (!seeded) {
    seedInboxTracker(messages)
    return []
  }

  /** @type {typeof messages} */
  const fresh = []
  for (const m of messages) {
    const id = String(m?.id ?? '').trim()
    if (!id || seenIds.has(id)) continue
    seenIds.add(id)
    fresh.push(m)
  }
  trimSeen()
  return fresh
}

export function resetInboxTracker() {
  seenIds.clear()
  seeded = false
}
