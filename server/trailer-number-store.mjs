/**
 * Pre-entered empty trailer numbers.
 * Drivers read the number off the trailer door before dispatch and store it here
 * so the inspect/checkout automation can use it without prompting.
 *
 * Keyed by dailyTripLegSequence. Each entry holds up to 4 trailer slots.
 */

import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'

/** @param {string} legSeq */
function storeKey(legSeq) {
  return userScopeKey(`trailer-numbers:${legSeq}`)
}

/**
 * @typedef {{ [slot: string]: string }} TrailerNumberEntry
 *   e.g. { "1": "829079", "2": "836442" }
 */

/**
 * @param {string} legSeq
 * @returns {Promise<TrailerNumberEntry>}
 */
export async function getTrailerNumbers(legSeq) {
  try {
    const data = await readKeyJson(storeKey(legSeq), () => null)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return /** @type {TrailerNumberEntry} */ (data.numbers || {})
    }
  } catch { /* missing */ }
  return {}
}

/**
 * @param {string} legSeq
 * @param {number} trailerIndex 1-based
 * @param {string} number
 */
export async function putTrailerNumber(legSeq, trailerIndex, number) {
  const existing = await getTrailerNumbers(legSeq)
  existing[String(trailerIndex)] = number.trim()
  await writeKeyJson(storeKey(legSeq), {
    legSeq,
    updatedAt: Date.now(),
    numbers: existing,
  })
  return existing
}

/**
 * Get all stored trailer numbers for a leg as an ordered array.
 * Returns e.g. [{ index: 1, number: "829079" }, { index: 2, number: "836442" }]
 * @param {string} legSeq
 */
export async function getTrailerNumberCandidates(legSeq) {
  const map = await getTrailerNumbers(legSeq)
  return Object.entries(map)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => ({ index: parseInt(k, 10), number: v.trim() }))
    .sort((a, b) => a.index - b.index)
}
