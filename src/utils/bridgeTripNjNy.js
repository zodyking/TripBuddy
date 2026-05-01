/**
 * Infer which PANYNJ crossing direction matters for the active trip (NJ ↔ NY).
 */

/**
 * @param {string} blob
 */
function testNj(blob) {
  const s = blob.toLowerCase()
  return (
    /\bnj\b/.test(s) ||
    /\bnew jersey\b/.test(s) ||
    /\bjersey city\b/.test(s) ||
    /\bnewark\b/.test(s) ||
    /\bsecaucus\b/.test(s) ||
    /\bkearny\b/.test(s) ||
    /\belizabeth\b/.test(s) ||
    /\bbayonne\b/.test(s) ||
    /\bhoboken\b/.test(s) ||
    /\bedison\b/.test(s) ||
    /\btrenton\b/.test(s) ||
    /\bcamden\b/.test(s) ||
    /\bpaterson\b/.test(s) ||
    /\bcranbury\b/.test(s) ||
    /\bfort lee\b/.test(s) ||
    /\bwoodbridge\b/.test(s)
  )
}

/**
 * @param {string} blob
 */
function testNy(blob) {
  const s = blob.toLowerCase()
  return (
    /\bny\b/.test(s) ||
    /\bnyc\b/.test(s) ||
    /\bnew york\b/.test(s) ||
    /\bmanhattan\b/.test(s) ||
    /\bbrooklyn\b/.test(s) ||
    /\bqueens\b/.test(s) ||
    /\bbronx\b/.test(s) ||
    /\bstaten\b/.test(s) ||
    /\blong island\b/.test(s) ||
    /\bjfk\b/.test(s) ||
    /\blga\b/.test(s) ||
    /\blaguardia\b/.test(s) ||
    /\bbuffalo\b/.test(s) ||
    /\balbany\b/.test(s) ||
    /\bsyracuse\b/.test(s)
  )
}

/**
 * When we can infer an NJ↔NY leg, only monitor crossings toward the destination state.
 * @param {unknown} tripsBody FedEx trips payload or null
 * @returns {{ constrained: boolean, monitorDir: 'ToNY' | 'ToNJ' | null }}
 */
export function inferBridgeMonitorDirectionFromTrip(tripsBody) {
  if (tripsBody == null || typeof tripsBody !== 'object' || Array.isArray(tripsBody)) {
    return { constrained: false, monitorDir: null }
  }
  const o = /** @type {Record<string, unknown>} */ (tripsBody)
  const oNum = o.currentLocationNumber ?? o.originLocation
  const oName = String(o.currentLocationName || o.currentLocationAbbrv || '')
  const dNum = o.tripDestNumber
  const dName = String(o.tripDest || o.tripDestAbbrv || '')

  const originBlob = `${oNum ?? ''} ${oName}`.trim()
  const destBlob = `${dNum ?? ''} ${dName}`.trim()
  if (!originBlob || !destBlob) {
    return { constrained: false, monitorDir: null }
  }

  const oNj = testNj(originBlob)
  const oNy = testNy(originBlob)
  const dNj = testNj(destBlob)
  const dNy = testNy(destBlob)

  if (oNj && dNy && !dNj) {
    return { constrained: true, monitorDir: 'ToNY' }
  }
  if (oNy && dNj && !dNy) {
    return { constrained: true, monitorDir: 'ToNJ' }
  }

  return { constrained: false, monitorDir: null }
}
