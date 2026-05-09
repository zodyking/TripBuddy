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
 */

/**
 * Get dolly number candidates from trip data.
 * @param {TripData} tripData
 * @returns {string[]} Array of dolly numbers to try in order
 */
export function getDollyCandidates(tripData) {
  const candidates = []
  const dolly = tripData?.dolly
  if (dolly?.number1?.trim()) candidates.push(dolly.number1.trim())
  if (dolly?.number2?.trim() && dolly.number2.trim() !== dolly?.number1?.trim()) {
    candidates.push(dolly.number2.trim())
  }
  return candidates
}

/**
 * Get seal number candidates for a specific trailer index.
 * Returns preferred trailer's seal first, then all other seals as fallbacks.
 * @param {TripData} tripData
 * @param {number} preferredIndex 0-based trailer index
 * @returns {string[]} Array of seal numbers to try in order
 */
export function getSealCandidates(tripData, preferredIndex) {
  const seals = []
  const trailers = tripData?.trailers || []
  const seen = new Set()

  // Add preferred trailer's seal first
  const preferred = trailers[preferredIndex]
  if (preferred?.sealNumber?.trim()) {
    const seal = preferred.sealNumber.trim()
    seals.push(seal)
    seen.add(seal)
  }

  // Add all other seals as fallbacks (avoid duplicates)
  for (let i = 0; i < trailers.length; i++) {
    if (i !== preferredIndex && trailers[i]?.sealNumber?.trim()) {
      const seal = trailers[i].sealNumber.trim()
      if (!seen.has(seal)) {
        seals.push(seal)
        seen.add(seal)
      }
    }
  }

  return seals
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
      return 'Enter Dolly Number'
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
