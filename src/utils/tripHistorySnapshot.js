import {
  extractOriginDest,
  extractTripDispatchInstructions,
  buildEnhancedTrailerCards,
  buildDollySection,
} from './tripDetailsDisplay.js'

/**
 * Build a dispatch-style header object for the trip history ledger.
 * @param {unknown} body Linehaul trip body
 * @param {object} opts
 * @param {string} [opts.instructions] Assignment text and/or merged text
 * @param {boolean} [opts.instructionsFinal] When true, use `instructions` as-is (already merged with API fields)
 * @param {string} [opts.source] 'linehaul' | 'complete'
 */
export function buildHistoryDispatchHeaderFromBody(body, opts = {}) {
  const { origin, destination } = extractOriginDest(body)
  const instr =
    typeof opts.instructions === 'string' ? opts.instructions.trim() : ''
  const fromApi = extractTripDispatchInstructions(body)
  const merged = opts.instructionsFinal
    ? instr
    : instr && fromApi
      ? `${instr}\n\n${fromApi}`
      : instr || fromApi
  const status =
    body && typeof body === 'object' && !Array.isArray(body)
      ? String(/** @type {Record<string, unknown>} */ (body).tripStatus ?? '')
      : ''
  return {
    source: opts.source || 'linehaul',
    tripStatusText: status || '—',
    tripStatusKind: 'linehaul',
    origin,
    destination,
    instructions: merged,
  }
}

/**
 * Trip details block for history (same shape as completion snapshot).
 * @param {unknown} body
 */
export function buildHistoryTripDetailsFromBody(body) {
  const cards = buildEnhancedTrailerCards(body)
  const trailers = cards.map((c) => ({
    order: c.order,
    trlrNbr: c.trlrNbr,
    size: c.size,
    statusLabel: c.statusLabel,
    loadType: c.loadType,
    summaryRows: c.summaryRows,
  }))
  const dollyS = buildDollySection(body)
  const dolly = dollyS.show
    ? { rows: dollyS.rows.map((r) => ({ label: r.label, value: r.value })) }
    : null
  let tripStatus = ''
  let tractorNumber = ''
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = /** @type {Record<string, unknown>} */ (body)
    tripStatus = b.tripStatus != null ? String(b.tripStatus) : ''
    tractorNumber = b.tractorNumber != null ? String(b.tractorNumber) : ''
  }
  return { trailers, dolly, tripStatus, tractorNumber }
}
