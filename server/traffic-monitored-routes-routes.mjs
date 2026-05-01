import { randomBytes } from 'node:crypto'
import { sanitizeTomtomApiKey } from './tomtom-key.mjs'
import {
  appendMonitoredRoute,
  readMonitoredRoutesForUser,
  removeMonitoredRouteByLocalId,
} from './route-monitoring-store.mjs'
import {
  deleteRouteMonitoringRoute,
  getRouteMonitoringRouteShort,
  normalizePathPointsForTomTom,
  postRouteMonitoringCreate,
  postRouteMonitoringPreview,
} from './tomtom-route-monitoring.mjs'

function randomLocalId() {
  return `mr_${randomBytes(12).toString('hex')}`
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function tomtomKeyFromBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const o = /** @type {Record<string, unknown>} */ (b)
  return sanitizeTomtomApiKey(
    typeof o.tomtomKey === 'string' ? o.tomtomKey : '',
  )
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
 * @param {unknown} body
 */
function pathPointsFromBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const o = /** @type {Record<string, unknown>} */ (b)
  const pp = o.pathPoints
  return Array.isArray(pp) ? normalizePathPointsForTomTom(pp) : []
}

/**
 * @param {unknown} data
 * @returns {string}
 */
function tomTomErrorMessage(data) {
  if (!data || typeof data !== 'object') return 'TomTom request failed'
  const o = /** @type {Record<string, unknown>} */ (data)
  const d = o.detailedError
  const m = o.message
  if (typeof d === 'string' && d.trim()) return d.trim()
  if (typeof m === 'string' && m.trim()) return m.trim()
  return 'TomTom request failed'
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerTrafficMonitoredRoutes(app) {
  app.post('/api/traffic/monitored-routes/preview', async (req, reply) => {
    const key = tomtomKeyFromBody(req.body)
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'TomTom API key required. Add it in Settings → Map: TomTom traffic overlay.',
      })
    }
    const pathPoints = pathPointsFromBody(req.body)
    if (pathPoints.length < 2) {
      return reply
        .code(400)
        .send({ ok: false, error: 'At least two path points are required.' })
    }
    const { ok, status, data } = await postRouteMonitoringPreview(key, pathPoints)
    if (!ok) {
      return reply
        .code(status >= 400 && status < 600 ? status : 502)
        .send({ ok: false, error: tomTomErrorMessage(data), tomtom: data })
    }
    return { ok: true, preview: data }
  })

  app.post('/api/traffic/monitored-routes', async (req, reply) => {
    const key = tomtomKeyFromBody(req.body)
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'TomTom API key required. Add it in Settings → Map: TomTom traffic overlay.',
      })
    }
    const name = routeNameFromBody(req.body) || 'Monitored route'
    const pathPoints = pathPointsFromBody(req.body)
    if (pathPoints.length < 2) {
      return reply
        .code(400)
        .send({ ok: false, error: 'At least two path points are required.' })
    }
    const { ok, status, data } = await postRouteMonitoringCreate(key, name, pathPoints)
    if (!ok || !data || typeof data !== 'object') {
      return reply
        .code(status >= 400 && status < 600 ? status : 502)
        .send({ ok: false, error: tomTomErrorMessage(data), tomtom: data })
    }
    const d = /** @type {Record<string, unknown>} */ (data)
    const routeId = Number(d.routeId)
    if (!Number.isFinite(routeId) || routeId <= 0) {
      return reply.code(502).send({
        ok: false,
        error: 'TomTom did not return a route id.',
        tomtom: data,
      })
    }
    const localId = randomLocalId()
    const storedPath = pathPoints.map((p) => ({ lat: p.latitude, lng: p.longitude }))
    await appendMonitoredRoute({
      localId,
      tomtomRouteId: routeId,
      name,
      pathPoints: storedPath,
      createdAt: Date.now(),
    })
    return {
      ok: true,
      route: {
        localId,
        tomtomRouteId: routeId,
        name,
        pathPoints: storedPath,
        createResponse: data,
      },
    }
  })

  app.get('/api/traffic/monitored-routes', async (req, reply) => {
    try {
      const stored = await readMonitoredRoutesForUser()
      const key = tomtomKeyFromBody(
        req.query && typeof req.query === 'object' ? req.query : {},
      )
      if (stored.length === 0) {
        return { ok: true, fetchedAt: Date.now(), routes: [] }
      }
      if (!key) {
        return reply.code(400).send({
          ok: false,
          error:
            'TomTom API key required. Add it in Settings → Map: TomTom traffic overlay.',
        })
      }
      const results = await Promise.all(
        stored.map(async (r) => {
          const short = await getRouteMonitoringRouteShort(key, r.tomtomRouteId)
          return {
            localId: r.localId,
            name: r.name,
            pathPoints: r.pathPoints,
            createdAt: r.createdAt,
            tomtomRouteId: r.tomtomRouteId,
            status: short.ok ? short.data : null,
            statusHttp: short.status,
            statusOk: short.ok,
            statusError: short.ok ? null : tomTomErrorMessage(short.data),
          }
        }),
      )
      return { ok: true, fetchedAt: Date.now(), routes: results }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return reply.code(503).send({ ok: false, error: msg })
    }
  })

  app.post('/api/traffic/monitored-routes/sync', async (req, reply) => {
    const key = tomtomKeyFromBody(req.body)
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'TomTom API key required. Add it in Settings → Map: TomTom traffic overlay.',
      })
    }
    try {
      const stored = await readMonitoredRoutesForUser()
      const results = await Promise.all(
        stored.map(async (r) => {
          const short = await getRouteMonitoringRouteShort(key, r.tomtomRouteId)
          return {
            localId: r.localId,
            name: r.name,
            pathPoints: r.pathPoints,
            createdAt: r.createdAt,
            tomtomRouteId: r.tomtomRouteId,
            status: short.ok ? short.data : null,
            statusHttp: short.status,
            statusOk: short.ok,
            statusError: short.ok ? null : tomTomErrorMessage(short.data),
          }
        }),
      )
      return { ok: true, fetchedAt: Date.now(), routes: results }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return reply.code(503).send({ ok: false, error: msg })
    }
  })

  /** POST body `{ tomtomKey }` — avoids DELETE bodies that some clients omit. */
  app.post('/api/traffic/monitored-routes/:localId/remove', async (req, reply) => {
    const key = tomtomKeyFromBody(req.body ?? {})
    if (!key) {
      return reply.code(400).send({
        ok: false,
        error:
          'TomTom API key required. Add it in Settings → Map: TomTom traffic overlay.',
      })
    }
    const localId = String(req.params?.localId || '').trim()
    if (!localId) {
      return reply.code(400).send({ ok: false, error: 'Missing route id.' })
    }
    const removed = await removeMonitoredRouteByLocalId(localId)
    if (!removed) {
      return reply.code(404).send({ ok: false, error: 'Route not found.' })
    }
    const del = await deleteRouteMonitoringRoute(key, removed.tomtomRouteId)
    if (!del.ok && del.status !== 404) {
      return reply.code(del.status >= 400 ? del.status : 502).send({
        ok: false,
        error: tomTomErrorMessage(del.data),
        removedLocal: true,
        tomtom: del.data,
      })
    }
    return { ok: true, removed: { localId: removed.localId } }
  })
}
