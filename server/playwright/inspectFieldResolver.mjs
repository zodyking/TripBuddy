/**
 * Smart field value resolution for Inspect & Check Out automation.
 * Resolves dolly, seal, and trailer numbers from trip data.
 * Driver prompt is always the last resort.
 */

/**
 * @typedef {object} TripData
 * @property {{ number1?: string, number2?: string }} [dolly]
 * @property {Array<{ trlrNbr?: string, sealNumber?: string, emptyFlag?: string }>} [trailers]
 * @property {string} [tractorNumber]
 * @property {string} [dailyTripLegSequence]
 * @property {Record<string, string>} [preEnteredTrailerNumbers] keyed by 1-based trailer order
 */

/**
 * Get dolly number candidates from trip data.
 * @param {TripData} tripData
 * @returns {string[]} Array of dolly numbers to try in order
 */
export function getDollyCandidates(tripData) {
  const candidates = []
  const td = /** @type {Record<string, unknown>} */ (tripData && typeof tripData === 'object' ? tripData : {})
  const dolly = /** @type {{ number1?: string, number2?: string } | undefined} */ (td.dolly)
  if (dolly?.number1?.trim()) candidates.push(dolly.number1.trim())
  if (dolly?.number2?.trim() && dolly.number2.trim() !== dolly?.number1?.trim()) {
    candidates.push(dolly.number2.trim())
  }
  const flat1 = String(td.dollyNumber1 ?? td.primaryDollyNumber ?? '').trim()
  const flat2 = String(td.dollyNumber2 ?? '').trim()
  if (flat1 && !candidates.includes(flat1)) candidates.unshift(flat1)
  if (flat2 && flat2 !== flat1 && !candidates.includes(flat2)) candidates.push(flat2)
  return candidates
}

/**
 * @param {Record<string, unknown>} tr
 * @returns {string}
 */
function pickTrailerSealString(tr) {
  const keys = [
    'sealNumber',
    'sealNbr',
    'trlrSealNumber',
    'trailerSealNumber',
    'sealNum',
    'tripSealNumber',
  ]
  for (const k of keys) {
    if (!(k in tr)) continue
    const v = tr[k]
    if (v == null || v === '') continue
    const s = String(v).trim()
    if (!s || s === '—' || s.toLowerCase() === 'none') continue
    return s
  }
  return ''
}

/**
 * Seal candidates for a trailer field from the trip detail cards.
 * Returns the matching trailer's seal first, then the other trailer's seal —
 * because seals are sometimes physically swapped between trailers.
 * Only prompt the user when both seals have been rejected.
 * @param {TripData} tripData
 * @param {number} preferredIndex 0-based index in `tripData.trailers` array order
 * @returns {string[]}
 */
export function getSealCandidates(tripData, preferredIndex) {
  const trailers = tripData?.trailers || []
  /** @type {string[]} */
  const candidates = []
  const seen = new Set()

  const preferred = trailers[preferredIndex]
  if (preferred && typeof preferred === 'object') {
    const raw = pickTrailerSealString(/** @type {Record<string, unknown>} */ (preferred))
    if (raw && !seen.has(raw)) {
      candidates.push(raw)
      seen.add(raw)
    }
  }

  for (let i = 0; i < trailers.length; i++) {
    if (i === preferredIndex) continue
    const tr = trailers[i]
    if (!tr || typeof tr !== 'object') continue
    const raw = pickTrailerSealString(/** @type {Record<string, unknown>} */ (tr))
    if (raw && !seen.has(raw)) {
      candidates.push(raw)
      seen.add(raw)
    }
  }

  return candidates
}

/**
 * All unique seal numbers across every trailer in the trip data.
 * @param {TripData} tripData
 * @returns {string[]}
 */
export function getAllSealNumbers(tripData) {
  const trailers = tripData?.trailers || []
  /** @type {string[]} */
  const seals = []
  const seen = new Set()
  for (const tr of trailers) {
    if (!tr || typeof tr !== 'object') continue
    const raw = pickTrailerSealString(/** @type {Record<string, unknown>} */ (tr))
    if (raw && !seen.has(raw)) {
      seals.push(raw)
      seen.add(raw)
    }
  }
  return seals
}

/**
 * Trip payload shape for Inspect automation from persisted assignment (same Linehaul body as Home).
 * @param {unknown} assignment
 * @returns {TripData}
 */
export function buildTripDataFromAssignment(assignment) {
  if (!assignment || typeof assignment !== 'object') return {}
  const a = /** @type {Record<string, unknown>} */ (assignment)
  const pick =
    a.persistedLinehaulTripSnapshot ||
    a.persistedCachedTripSnapshot ||
    a.persistedPrePlanTripSnapshot ||
    null
  if (!pick || typeof pick !== 'object') return {}
  const body = /** @type {Record<string, unknown>} */ (pick)

  /** @type {TripData} */
  const out = {}
  const n1 = String(body.dollyNumber1 ?? body.primaryDollyNumber ?? '').trim()
  const n2 = String(body.dollyNumber2 ?? '').trim()
  if (n1 || n2) {
    out.dolly = {}
    if (n1) out.dolly.number1 = n1
    if (n2) out.dolly.number2 = n2
  }

  if (Array.isArray(body.trailers)) {
    const arr = [...body.trailers].filter((x) => x && typeof x === 'object')
    arr.sort((a, b) => {
      const ta = /** @type {Record<string, unknown>} */ (a)
      const tb = /** @type {Record<string, unknown>} */ (b)
      const sa = Number(ta.dailyTripLegConfigSeq ?? ta.trlrOrder ?? 9999)
      const sb = Number(tb.dailyTripLegConfigSeq ?? tb.trlrOrder ?? 9999)
      if (sa !== sb) return sa - sb
      return (Number(ta.trlrOrder) || 0) - (Number(tb.trlrOrder) || 0)
    })
    out.trailers = arr.map((t) => {
      const tr = /** @type {Record<string, unknown>} */ (t)
      const seal = pickTrailerSealString(tr)
      return seal && String(tr.sealNumber ?? '').trim() !== seal ? { ...tr, sealNumber: seal } : t
    })
  }

  const tn = String(body.tractorNumber ?? body.tractorNbr ?? '').trim()
  if (tn) out.tractorNumber = tn
  return out
}

/**
 * Get tractor number from trip data.
 * @param {TripData} tripData
 * @returns {string | null}
 */
export function getTractorNumber(tripData) {
  return tripData?.tractorNumber?.trim() || null
}

/**
 * @typedef {'dolly' | 'seal' | 'trailerNumber' | 'tractorNumber' | 'unknown'} FieldType
 */

/**
 * @typedef {object} DetectedField
 * @property {FieldType} type
 * @property {number} trailerIndex 1-based trailer index (for seal/trailer fields)
 * @property {string} labelText Original label text that was matched
 */

/**
 * Detect field type from label text.
 * Uses patterns observed in FedEx portal videos.
 * @param {string} labelText
 * @returns {DetectedField}
 */
export function detectFieldType(labelText) {
  const upper = labelText.toUpperCase().trim()

  // DOLLY NUMBER
  if (/DOLLY\s*NUMBER/i.test(upper) || upper === 'DOLLY NUMBER') {
    return { type: 'dolly', trailerIndex: 0, labelText }
  }

  // TRACTOR NUMBER
  if (/TRACTOR\s*NUMBER/i.test(upper)) {
    return { type: 'tractorNumber', trailerIndex: 0, labelText }
  }

  // TRAILER X SEAL NUMBER (loaded trailers)
  if (/SEAL\s*NUMBER/i.test(upper) && /TRAILER\s*\d/i.test(upper)) {
    const match = upper.match(/TRAILER\s*(\d+)/)
    const trailerIndex = match ? parseInt(match[1], 10) : 1
    return { type: 'seal', trailerIndex, labelText }
  }

  // TRAILER X NUMBER (empty trailers - no "SEAL")
  if (/TRAILER\s*\d+\s*NUMBER/i.test(upper) && !/SEAL/i.test(upper)) {
    const match = upper.match(/TRAILER\s*(\d+)/)
    const trailerIndex = match ? parseInt(match[1], 10) : 1
    return { type: 'trailerNumber', trailerIndex, labelText }
  }

  return { type: 'unknown', trailerIndex: 0, labelText }
}

/**
 * Extract trailer index from label or placeholder text.
 * @param {string} text
 * @returns {number} 1-based trailer index (defaults to 1)
 */
export function extractTrailerIndex(text) {
  const upper = text.toUpperCase()
  // Pattern: "TRAILER 1", "TRAILER 2", etc.
  const match = upper.match(/TRAILER\s*(\d+)/)
  if (match) return parseInt(match[1], 10)
  // Pattern: "1 —" or "1 -" at start
  const dashMatch = upper.match(/^(\d+)\s*[—\-]/)
  if (dashMatch) return parseInt(dashMatch[1], 10)
  return 1
}

/**
 * Build contextual prompt message for driver input.
 * @param {FieldType} fieldType
 * @param {number} trailerIndex 1-based
 * @returns {string}
 */
export function buildPromptMessage(fieldType, trailerIndex) {
  switch (fieldType) {
    case 'dolly':
      return 'Enter Dolly Number (not in trip details or saved assignment)'
    case 'seal':
      return `Enter Seal Number for Trailer ${trailerIndex} (read from trailer seal)`
    case 'trailerNumber':
      return `Enter Trailer ${trailerIndex} Number (read from trailer door)`
    case 'tractorNumber':
      return 'Enter Tractor Number'
    default:
      return 'Enter value'
  }
}
