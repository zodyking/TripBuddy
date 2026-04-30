/**
 * TomTom Traffic Flow Segment Data — batched samples for corridor schematic.
 * Uses server-side API key (env); never expose key to browser.
 */

const FLOW_BASE = 'https://api.tomtom.com/traffic/services/4/flowSegmentData'
const ZOOM = 10
const STYLE = 'absolute'
const FORMAT = 'json'

/**
 * @param {string} key
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ ok: boolean, lat: number, lng: number, flow?: Record<string, unknown>, error?: string }>}
 */
async function fetchFlowSegment(key, lat, lng) {
  const point = `${lat},${lng}`
  const url = `${FLOW_BASE}/${STYLE}/${ZOOM}/${FORMAT}?key=${encodeURIComponent(key)}&point=${encodeURIComponent(point)}&unit=MPH`
  const r = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await r.text()
  let parsed = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }
  if (!r.ok) {
    const err =
      typeof parsed?.detailedError?.message === 'string'
        ? parsed.detailedError.message
        : typeof parsed?.error === 'string'
          ? parsed.error
          : `HTTP ${r.status}`
    return { ok: false, lat, lng, error: err }
  }
  const flow = parsed?.flowSegmentData
  if (!flow || typeof flow !== 'object') {
    return { ok: false, lat, lng, error: 'No flowSegmentData' }
  }
  return { ok: true, lat, lng, flow }
}

/**
 * @param {string} key
 * @param {Array<{ id: string, samples: [number, number][] }>} corridors
 */
export async function fetchCorridorFlowBatch(key, corridors) {
  /** @type {Record<string, Array<{ lat: number, lng: number, ok: boolean, flow?: Record<string, unknown>, error?: string }>>} */
  const byCorridor = {}
  const tasks = []

  for (const c of corridors) {
    byCorridor[c.id] = []
    for (const [lat, lng] of c.samples) {
      tasks.push(
        fetchFlowSegment(key, lat, lng).then((res) => {
          byCorridor[c.id].push({
            lat: res.lat,
            lng: res.lng,
            ok: res.ok,
            flow: res.flow,
            error: res.error,
          })
        }),
      )
    }
  }

  /** Limit concurrency to avoid TomTom rate limits */
  const concurrency = 4
  for (let i = 0; i < tasks.length; i += concurrency) {
    await Promise.all(tasks.slice(i, i + concurrency))
  }

  const fetchedAt = Date.now()
  return { byCorridor, fetchedAt }
}
