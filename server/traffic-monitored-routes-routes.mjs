import { randomBytes } from 'node:crypto'
import {
  appendMonitoredRoute,
  readMonitoredRoutesForUser,
  removeMonitoredRouteByLocalId,
} from './route-monitoring-store.mjs'
import {
  encodeFlexiblePolyline,
  getTrafficFlowCorridor,
  getRoutedPolyline,
  parseTrafficFlowResponse,
  formatHereApiError,
  sanitizeHereApiKey,
} from './here-traffic-api.mjs'
import { getHereApiKeyForAccount } from './user-profile-pg.mjs'
import {
  assertApiAllowed,
  recordApiCompletedCall,
  ApiQuotaError,
} from './api-quota.mjs'

/**
 * @param {import('fastify').FastifyRequest} req
 */
function monitoredTrafficAccountKey(req) {
  return req && typeof req.credentialAccountKey === 'string'
    ? req.credentialAccountKey.trim()
    : ''
}

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
 * @param {string} [fieldName='pathPoints']
 * @returns {Array<{ lat: number, lng: number }>}
 */
function pathPointsFromBody(body, fieldName = 'pathPoints') {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const o = /** @type {Record<string, unknown>} */ (b)
  const pp = o[fieldName]
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
 * Get polyline string from body if provided.
 * @param {unknown} body
 * @returns {string}
 */
function polylineFromBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const o = /** @type {Record<string, unknown>} */ (b)
  return typeof o.polyline === 'string' ? o.polyline.trim() : ''
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerTrafficMonitoredRoutes(app) {
  // Preview: route waypoints via HERE Routing API (snap-to-road)
  app.post('/api/traffic/monitored-routes/preview', async (req, reply) => {
    const key = await resolveHereKeyForRequest(req)
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'HERE API key required. Add it in Settings → Map: HERE traffic overlay.',
      })
    }
    const ak = monitoredTrafficAccountKey(req)
    try {
      if (ak) await assertApiAllowed(ak, 'here')
    } catch (e) {
      if (e instanceof ApiQuotaError) {
        return reply.code(429).send({
          ok: false,
          error: e.message,
          code: e.code,
          bucket: e.bucket,
          quotaKind: e.kind,
        })
      }
      throw e
    }
    const pathPoints = pathPointsFromBody(req.body)
    if (pathPoints.length < 2) {
      return reply
        .code(400)
        .send({ ok: false, error: 'At least two path points are required.' })
    }

    // Route waypoints via HERE Routing API to get road-snapped path
    const routeResult = await getRoutedPolyline(key, pathPoints)

    if (!routeResult.ok || !routeResult.points || routeResult.points.length < 2) {
      return reply
        .code(routeResult.status >= 400 && routeResult.status < 600 ? routeResult.status : 502)
        .send({
          ok: false,
          error: formatHereApiError(routeResult.data, routeResult.status),
          here: routeResult.data,
        })
    }

    if (ak) await recordApiCompletedCall(ak, 'here').catch(() => {})

    return {
      ok: true,
      preview: {
        routedPathPoints: routeResult.points,
        polyline: routeResult.polyline,
      },
      previewSource: 'here-routing',
    }
  })

  // Create: store route using the client-provided snapped path (from preview)
  // If client provides polyline + routedPathPoints, use those directly (no re-routing)
  // Otherwise fall back to routing the waypoints
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
    const ak = monitoredTrafficAccountKey(req)

    // Check if client sent the already-snapped path from preview
    const clientPolyline = polylineFromBody(req.body)
    const routedPathPoints = pathPointsFromBody(req.body, 'routedPathPoints')
    
    let finalPolyline = ''
    let finalPathPoints = []
    
    if (clientPolyline && routedPathPoints.length >= 2) {
      // Use the client-provided snapped path (from preview) - NO re-routing
      finalPolyline = clientPolyline
      finalPathPoints = routedPathPoints
    } else {
      // Fallback: route the waypoints if no preview data provided
      const waypoints = pathPointsFromBody(req.body)
      if (waypoints.length < 2) {
        return reply
          .code(400)
          .send({ ok: false, error: 'At least two path points are required.' })
      }

      try {
        if (ak) await assertApiAllowed(ak, 'here')
      } catch (e) {
        if (e instanceof ApiQuotaError) {
          return reply.code(429).send({
            ok: false,
            error: e.message,
            code: e.code,
            bucket: e.bucket,
            quotaKind: e.kind,
          })
        }
        throw e
      }

      const routeResult = await getRoutedPolyline(key, waypoints)
      if (routeResult.ok && routeResult.points && routeResult.points.length >= 2) {
        finalPolyline = routeResult.polyline || encodeFlexiblePolyline(routeResult.points)
        finalPathPoints = routeResult.points
        if (ak) await recordApiCompletedCall(ak, 'here').catch(() => {})
      } else {
        // Last resort: use raw waypoints
        finalPolyline = encodeFlexiblePolyline(waypoints)
        finalPathPoints = waypoints
      }
    }

    if (!finalPolyline || finalPathPoints.length < 2) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Could not create route polyline.' })
    }

    const localId = randomLocalId()
    await appendMonitoredRoute({
      localId,
      name,
      pathPoints: finalPathPoints,
      polyline: finalPolyline,
      createdAt: Date.now(),
    })

    return {
      ok: true,
      route: {
        localId,
        name,
        pathPoints: finalPathPoints,
        polyline: finalPolyline,
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

      const ak = monitoredTrafficAccountKey(req)

      const results = await Promise.all(
        stored.map(async (r) => {
          try {
            if (ak) await assertApiAllowed(ak, 'here')
          } catch (e) {
            if (e instanceof ApiQuotaError) {
              const polyline = r.polyline || encodeFlexiblePolyline(r.pathPoints)
              return {
                localId: r.localId,
                name: r.name,
                pathPoints: r.pathPoints,
                polyline,
                createdAt: r.createdAt,
                status: null,
                statusOk: false,
                statusError: e.message,
              }
            }
            throw e
          }
          // Encode polyline if not stored
          const polyline = r.polyline || encodeFlexiblePolyline(r.pathPoints)

          // Get live traffic flow along the corridor
          const flowResult = await getTrafficFlowCorridor(key, polyline, 150)
          if (flowResult.ok && ak) await recordApiCompletedCall(ak, 'here').catch(() => {})
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
      const ak = monitoredTrafficAccountKey(req)
      const results = await Promise.all(
        stored.map(async (r) => {
          try {
            if (ak) await assertApiAllowed(ak, 'here')
          } catch (e) {
            if (e instanceof ApiQuotaError) {
              const polyline = r.polyline || encodeFlexiblePolyline(r.pathPoints)
              return {
                localId: r.localId,
                name: r.name,
                pathPoints: r.pathPoints,
                polyline,
                createdAt: r.createdAt,
                status: null,
                statusOk: false,
                statusError: e.message,
              }
            }
            throw e
          }
          const polyline = r.polyline || encodeFlexiblePolyline(r.pathPoints)

          const flowResult = await getTrafficFlowCorridor(key, polyline, 150)
          if (flowResult.ok && ak) await recordApiCompletedCall(ak, 'here').catch(() => {})
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
