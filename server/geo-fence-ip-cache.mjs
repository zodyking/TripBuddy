/** Short-lived IP → redirect URL decisions (avoids repeat lookups on same request burst). */
/** @type {Map<string, { url: string | null, at: number }>} */
export const fenceDecisionByIp = new Map()
export const FENCE_DECISION_TTL_MS = 60_000

export function clearFenceDecisionCache() {
  fenceDecisionByIp.clear()
}
