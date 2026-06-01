/**
 * Shared iMessage inbox tracker — one seen set for the whole app session.
 * Ensures TTS only fires for messages that arrive after the listener seeds,
 * not when opening Chat → iMessage or syncing thread history.
 */

/** @type {Set<string>} */
const seenIds = new Set()
let seeded = false
/** Latest message timestamp at seed time; only ts strictly greater counts as new. */
let newestTsWatermark = 0

const SEEN_CAP = 2000
const SEEN_TRIM = 500

function trimSeen() {
  if (seenIds.size <= SEEN_CAP) return
  for (const id of [...seenIds].slice(0, SEEN_TRIM)) seenIds.delete(id)
}

/**
 * @param {Array<{ id?: string, ts?: number }>} messages
 */
export function seedInboxTracker(messages) {
  let maxTs = 0
  for (const m of messages) {
    const id = String(m?.id ?? '').trim()
    if (id) seenIds.add(id)
    const ts = Number(m?.ts) || 0
    if (ts > maxTs) maxTs = ts
  }
  if (maxTs > newestTsWatermark) newestTsWatermark = maxTs
  seeded = true
  trimSeen()
}

/**
 * Mark messages as seen without TTS (e.g. thread history loaded in UI).
 * @param {Array<{ id?: string, ts?: number }>} messages
 */
export function markInboxMessagesSeen(messages) {
  if (!Array.isArray(messages)) return
  for (const m of messages) {
    const id = String(m?.id ?? '').trim()
    if (id) seenIds.add(id)
    const ts = Number(m?.ts) || 0
    if (ts > newestTsWatermark) newestTsWatermark = ts
  }
  trimSeen()
}

export function isInboxTrackerSeeded() {
  return seeded
}

export function getInboxNewestTsWatermark() {
  return newestTsWatermark
}

/**
 * @param {Array<{ id: string, ts?: number }>} messages
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
    const ts = Number(m?.ts) || 0
    if (ts <= newestTsWatermark) {
      seenIds.add(id)
      continue
    }
    fresh.push(m)
    seenIds.add(id)
    if (ts > newestTsWatermark) newestTsWatermark = ts
  }
  trimSeen()
  return fresh
}

export function resetInboxTracker() {
  seenIds.clear()
  seeded = false
  newestTsWatermark = 0
}
