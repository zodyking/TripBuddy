/**
 * Resolve plain paid miles for Linehaul viewTripInfoDetails mileage objects.
 * FedEx may return pay-adjusted totalMiles while directionList reflects per-state miles;
 * linehaulRawTotalMiles may carry the unadjusted total when present.
 */

/**
 * @param {unknown[]} dl
 * @returns {number | null}
 */
export function sumDirectionListMiles(dl) {
  if (!Array.isArray(dl) || dl.length === 0) return null
  let sum = 0
  for (const row of dl) {
    if (!row || typeof row !== 'object') return null
    const mp = /** @type {Record<string, unknown>} */ (row).mileagePerState
    let n = NaN
    if (typeof mp === 'number' && Number.isFinite(mp)) n = mp
    else if (mp != null) n = Number.parseFloat(String(mp).replace(/,/g, '').trim())
    if (!Number.isFinite(n) || n < 0) return null
    sum += n
  }
  return sum
}

/**
 * @param {unknown} s
 * @returns {number}
 */
function parseMilesStr(s) {
  if (s == null) return NaN
  const n = Number.parseFloat(String(s).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatMilesDisplay(n) {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * @param {Record<string, unknown>} mo
 * @returns {{ display: string, value: number } | null}
 */
export function resolvePaidMilesFromMileageRecord(mo) {
  if (!mo || typeof mo !== 'object' || Array.isArray(mo)) return null
  const totalStr = mo.totalMiles != null ? String(mo.totalMiles).trim() : ''
  const rawStr =
    mo.linehaulRawTotalMiles != null ? String(mo.linehaulRawTotalMiles).trim() : ''
  const T = parseMilesStr(totalStr)
  const raw = parseMilesStr(rawStr)
  const dl = Array.isArray(mo.directionList) ? mo.directionList : []
  const stateSum = sumDirectionListMiles(dl)

  if (Number.isFinite(raw) && raw > 0) {
    return { display: formatMilesDisplay(raw), value: raw }
  }

  if (Number.isFinite(T) && T > 0 && stateSum != null && stateSum > 0) {
    const ratio = T / stateSum
    if (T > stateSum * 1.09 || (ratio >= 1.35 && ratio <= 1.9)) {
      return { display: formatMilesDisplay(stateSum), value: stateSum }
    }
  }

  if (Number.isFinite(T) && T > 0) {
    return { display: totalStr || formatMilesDisplay(T), value: T }
  }

  if (stateSum != null && stateSum > 0) {
    return { display: formatMilesDisplay(stateSum), value: stateSum }
  }

  return null
}
