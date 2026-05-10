/**
 * Dispatch proof screenshot storage.
 * Stores compressed JPEG screenshots keyed by dailyTripLegSequence.
 * Each trip's proof is an ordered array of { label, jpeg (base64), ts }.
 */

import { readKeyJson, writeKeyJson } from './kv-store.mjs'
import { userScopeKey } from './scope-kv.mjs'

/** @param {string} legSeq */
function proofKey(legSeq) {
  return userScopeKey(`dispatch-proof:${legSeq}`)
}

/**
 * @param {string} legSeq dailyTripLegSequence
 * @returns {Promise<{ label: string, jpeg: string, ts: number }[]>}
 */
export async function getDispatchProof(legSeq) {
  try {
    const data = await readKeyJson(proofKey(legSeq), () => null)
    if (data && Array.isArray(data.screenshots)) return data.screenshots
  } catch { /* missing key */ }
  return []
}

/**
 * @param {string} legSeq
 * @param {{ label: string, jpeg: string, ts: number }[]} screenshots
 */
export async function saveDispatchProof(legSeq, screenshots) {
  await writeKeyJson(proofKey(legSeq), { legSeq, savedAt: Date.now(), screenshots })
}

/**
 * Append a single screenshot to an existing proof set.
 * @param {string} legSeq
 * @param {{ label: string, jpeg: string, ts: number }} shot
 */
export async function appendDispatchProofScreenshot(legSeq, shot) {
  const existing = await getDispatchProof(legSeq)
  existing.push(shot)
  await saveDispatchProof(legSeq, existing)
}
