import { randomBytes } from 'node:crypto'
import {
  appendMonitoredRoute,
  readMonitoredRoutesForUser,
  removeMonitoredRouteByLocalId,
} from './route-monitoring-store.mjs'
import {
  encodeFlexiblePolyline,
  getTrafficFlowCorridor,
  parseTrafficFlowResponse,
  formatHereApiError,
  sanitizeHereApiKey,
} from './here-traffic-api.mjs'
import { getHereApiKeyForAccount } from './user-profile-pg.mjs'

/**
 * @param {unknown} body
 * @returns {string}
 */
function hereKeyFromBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const o = /** @type {Record<string, unknown>} */ (b)
  return sanitizeHereApiKey(
    typeof o.hereKey === 'string' ? o.hereKey : '',
  )
}

/**
 * @param {unknown} body
 * @param {string} [accountKey]
 */
async function resolveHereKey(body, accountKey) {
  const fromClient = hereKeyFromBody(body)
  if (fromClient) return fromClient
  const ak =
    typeof accountKey === 'string' && accountKey.trim() ? accountKey.trim() : ''
  if (ak) {
    try {
      const fromDb = await getHereApiKeyForAccount(ak)
      const k = sanitizeHereApiKey(fromDb)
      if (k) return k
    } catch {
      /* ignore */
    }
  }
  return ''
}

/**
 * @param {import('fastify').FastifyRequest} req
 */
async function resolveHereKeyForRequest(req) {
  const body =
    req.method === 'GET' && req.query && typeof req.query === 'object'
      ? req.query
      : (req.body ?? {})
  const ak =
    req && typeof req === 'object' && /** @type {any} */ (req).credentialAccountKey
      ? String(/** @type {any} */ (req).credentialAccountKey)
      : ''
  return resolveHereKey(body, ak)
}

function randomLocalId() {
  return `mr_${randomBytes(12).toString('hex')}`
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function routeNameFromBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const o = /** @type {Record<string, unknown>} */ (b)
  const n = typeof o.name === 'string' ? o.name.trim() : ''
  return n.slice(0, 120)
}

/**
 * Normalize path points to { lat, lng } format.
 * @param {unknown} body
 * @returns {Array<{ lat: number, lng: number }>}
 */
function pathPointsFromBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const o = /** @type {Record<string, unknown>} */ (b)
  const pp = o.pathPoints
  if (!Array.isArray(pp)) return []

  return pp
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const pt = /** @type {Record<string, unknown>} */ (p)
      const lat = Number(pt.lat ?? pt.latitude)
      const lng = Number(pt.lng ?? pt.longitude ?? pt.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return { lat, lng }
    })
    .filter(/** @returns {p is { lat: number, lng: number }} */ (p) => p !== null)
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerTrafficMonitoredRoutes(app) {
  // Preview: encode drawn path and get traffic stats (NO routing - uses exact drawn path)
  app.post('/api/traffic/monitored-routes/preview', async (req, reply) => {
    const key = await resolveHereKeyForRequest(req)
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'HERE API key required. Add it in Settings → Map: HERE traffic overlay.',
      })
    }
    const pathPoints = pathPointsFromBody(req.body)
    if (pathPoints.length < 2) {
      return reply
        .code(400)
        .send({ ok: false, error: 'At least two path points are required.' })
    }

    // Encode the user's drawn path directly (no routing)
    const polyline = encodeFlexiblePolyline(pathPoints)
    if (!polyline) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Could not encode path points.' })
    }

    // Get traffic flow along the drawn corridor (larger radius to capture nearby roads)
    const flowResult = await getTrafficFlowCorridor(key, polyline, 200)

    if (!flowResult.ok) {
      return reply
        .code(flowResult.status >= 400 && flowResult.status < 600 ? flowResult.status : 502)
        .send({
          ok: false,
          error: formatHereApiError(flowResult.data, flowResult.status),
          here: flowResult.data,
        })
    }

    const parsed = parseTrafficFlowResponse(flowResult.data)

    return {
      ok: true,
      preview: {
        routedPathPoints: pathPoints,
        polyline,
        trafficStats: {
          totalLengthMeters: parsed.totalLengthMeters,
          avgSpeedMph: parsed.avgSpeedMps * 2.237,
          avgFreeFlowMph: parsed.avgFreeFlowMps * 2.237,
          avgJamFactor: parsed.avgJamFactor,
          travelTimeSeconds: parsed.travelTimeSeconds,
          delaySeconds: parsed.delaySeconds,
        },
      },
      previewSource: 'drawn-path',
    }
  })

  // Create: store route locally using exact drawn path (no routing)
  app.post('/api/traffic/monitored-routes', async (req, reply) => {
    const key = await resolveHereKeyForRequest(req)
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'HERE API key required. Add it in Settings → Map: HERE traffic overlay.',
      })
    }
    const name = routeNameFromBody(req.body) || 'Monitored route'
    const pathPoints = pathPointsFromBody(req.body)
    if (pathPoints.length < 2) {
      return reply
        .code(400)
        .send({ ok: false, error: 'At least two path points are required.' })
    }

    // Encode the user's drawn path directly (no routing)
    const polyline = encodeFlexiblePolyline(pathPoints)
    if (!polyline) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Could not encode path points.' })
    }

    const localId = randomLocalId()
    await appendMonitoredRoute({
      localId,
      name,
      pathPoints,
      polyline,
      createdAt: Date.now(),
    })

    return {
      ok: true,
      route: {
        localId,
        name,
        pathPoints,
        polyline,
      },
    }
  })

  // List routes with live traffic status
  app.get('/api/traffic/monitored-routes', async (req, reply) => {
    try {
      const stored = await readMonitoredRoutesForUser()
      if (stored.length === 0) {
        return { ok: true, fetchedAt: Date.now(), routes: [] }
      }

      const key = await resolveHereKeyForRequest(req)
      if (!key) {
        return reply.code(400).send({
          ok: false,
          error:
            'HERE API key required. Add it in Settings → Map: HERE traffic overlay.',
        })
      }

      const results = await Promise.all(
        stored.map(async (r) => {
          // Encode polyline if not stored
          const polyline = r.polyline || encodeFlexiblePolyline(r.pathPoints)

          // Get live traffic flow along the corridor
          const flowResult = await getTrafficFlowCorridor(key, polyline, 150)
          const parsed = flowResult.ok ? parseTrafficFlowResponse(flowResult.data) : null

          return {
            localId: r.localId,
            name: r.name,
            pathPoints: r.pathPoints,
            polyline,
            createdAt: r.createdAt,
            status: parsed ? {
              totalLengthMeters: parsed.totalLengthMeters,
              avgSpeedMps: parsed.avgSpeedMps,
              avgSpeedMph: parsed.avgSpeedMps * 2.237,
              avgFreeFlowMps: parsed.avgFreeFlowMps,
              avgFreeFlowMph: parsed.avgFreeFlowMps * 2.237,
              avgJamFactor: parsed.avgJamFactor,
              travelTimeSeconds: parsed.travelTimeSeconds,
              freeFlowTimeSeconds: parsed.freeFlowTimeSeconds,
              delaySeconds: parsed.delaySeconds,
              segments: parsed.segments,
              routePathPoints: parsed.segments.flatMap(s => s.points),
            } : null,
            statusOk: flowResult.ok,
            statusError: flowResult.ok ? null : formatHereApiError(flowResult.data, flowResult.status),
          }
        }),
      )
      return { ok: true, fetchedAt: Date.now(), routes: results }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return reply.code(503).send({ ok: false, error: msg })
    }
  })

  // Sync: refresh traffic status for all routes
  app.post('/api/traffic/monitored-routes/sync', async (req, reply) => {
    const key = await resolveHereKeyForRequest(req)
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'HERE API key required. Add it in Settings → Map: HERE traffic overlay.',
      })
    }
    try {
      const stored = await readMonitoredRoutesForUser()
      const results = await Promise.all(
        stored.map(async (r) => {
          const polyline = r.polyline || encodeFlexiblePolyline(r.pathPoints)

          const flowResult = await getTrafficFlowCorridor(key, polyline, 150)
          const parsed = flowResult.ok ? parseTrafficFlowResponse(flowResult.data) : null

          return {
            localId: r.localId,
            name: r.name,
            pathPoints: r.pathPoints,
            polyline,
            createdAt: r.createdAt,
            status: parsed ? {
              totalLengthMeters: parsed.totalLengthMeters,
              avgSpeedMps: parsed.avgSpeedMps,
              avgSpeedMph: parsed.avgSpeedMps * 2.237,
              avgFreeFlowMps: parsed.avgFreeFlowMps,
              avgFreeFlowMph: parsed.avgFreeFlowMps * 2.237,
              avgJamFactor: parsed.avgJamFactor,
              travelTimeSeconds: parsed.travelTimeSeconds,
              freeFlowTimeSeconds: parsed.freeFlowTimeSeconds,
              delaySeconds: parsed.delaySeconds,
              segments: parsed.segments,
              routePathPoints: parsed.segments.flatMap(s => s.points),
            } : null,
            statusOk: flowResult.ok,
            statusError: flowResult.ok ? null : formatHereApiError(flowResult.data, flowResult.status),
          }
        }),
      )
      return { ok: true, fetchedAt: Date.now(), routes: results }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return reply.code(503).send({ ok: false, error: msg })
    }
  })

  // Remove route (local only - HERE is stateless)
  app.post('/api/traffic/monitored-routes/:localId/remove', async (req, reply) => {
    const localId = String(req.params?.localId || '').trim()
    if (!localId) {
      return reply.code(400).send({ ok: false, error: 'Missing route id.' })
    }
    const removed = await removeMonitoredRouteByLocalId(localId)
    if (!removed) {
      return reply.code(404).send({ ok: false, error: 'Route not found.' })
    }
    return { ok: true, removed: { localId: removed.localId } }
  })
}
