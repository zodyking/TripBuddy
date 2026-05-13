/**
 * Resolve the active YouTube live broadcast for @gwblivetrafficcam (George Washington Bridge).
 * Uses YouTube Data API v3 (server key). search.list with eventType=live is quota-heavy (~100 units);
 * responses are cached to limit calls.
 *
 * Env: `YOUTUBE_DATA_API_KEY` or `YOUTUBE_API_KEY` on the API server.
 */

const CHANNEL_HANDLE = 'gwblivetrafficcam'
/** search.list costs ~100 quota units per call in v3 */
const CACHE_OK_MS = 15 * 60 * 1000
const CACHE_ERR_MS = 2 * 60 * 1000

let cache = /** @type {{ at: number, payload: Record<string, unknown>, ttl: number } | null} */ (null)

/**
 * @param {string} base
 * @param {Record<string, string | number | boolean | undefined>} params
 */
function ytUrl(base, params) {
  const u = new URL(base)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') u.searchParams.set(k, String(v))
  }
  return u.toString()
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getGwbYoutubeLivePayload() {
  const now = Date.now()
  if (cache && now - cache.at < cache.ttl) {
    return { ...cache.payload, cached: true }
  }

  const key = (process.env.YOUTUBE_DATA_API_KEY || process.env.YOUTUBE_API_KEY || '').trim()
  if (!key) {
    return {
      ok: false,
      live: false,
      videoId: null,
      title: null,
      reason: 'missing_api_key',
      hint: 'Set YOUTUBE_DATA_API_KEY (or YOUTUBE_API_KEY) on the TripBuddy API server.',
      fetchedAt: now,
    }
  }

  try {
    const chUrl = ytUrl('https://www.googleapis.com/youtube/v3/channels', {
      part: 'id',
      forHandle: CHANNEL_HANDLE,
      key,
    })
    const chRes = await fetch(chUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    const chJson = await chRes.json().catch(() => ({}))
    if (!chRes.ok) {
      const msg =
        chJson?.error?.message ||
        `channels.list failed: ${chRes.status} ${chRes.statusText}`
      const payload = {
        ok: false,
        live: false,
        videoId: null,
        title: null,
        reason: 'youtube_error',
        detail: String(msg).slice(0, 240),
        fetchedAt: now,
      }
      cache = { at: now, payload, ttl: CACHE_ERR_MS }
      return payload
    }

    const items = Array.isArray(chJson?.items) ? chJson.items : []
    const channelId =
      items[0] && typeof items[0].id === 'string' ? items[0].id : ''
    if (!channelId) {
      const payload = {
        ok: false,
        live: false,
        videoId: null,
        title: null,
        reason: 'channel_not_found',
        detail: `No channel for @${CHANNEL_HANDLE}`,
        fetchedAt: now,
      }
      cache = { at: now, payload, ttl: CACHE_ERR_MS }
      return payload
    }

    const searchUrl = ytUrl('https://www.googleapis.com/youtube/v3/search', {
      part: 'snippet',
      channelId,
      type: 'video',
      eventType: 'live',
      order: 'date',
      maxResults: '10',
      key,
    })
    const sRes = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    const sJson = await sRes.json().catch(() => ({}))
    if (!sRes.ok) {
      const msg =
        sJson?.error?.message ||
        `search.list failed: ${sRes.status} ${sRes.statusText}`
      const payload = {
        ok: false,
        live: false,
        videoId: null,
        title: null,
        reason: 'youtube_error',
        detail: String(msg).slice(0, 240),
        fetchedAt: now,
      }
      cache = { at: now, payload, ttl: CACHE_ERR_MS }
      return payload
    }

    const rawList = Array.isArray(sJson?.items) ? sJson.items : []
    /** @type {{ id: string, title: string, publishedAt: string }[]} */
    const lives = []
    for (const it of rawList) {
      const id = it?.id?.videoId
      if (typeof id !== 'string' || !id.trim()) continue
      const sn = it?.snippet
      const title = typeof sn?.title === 'string' ? sn.title : ''
      const publishedAt =
        typeof sn?.publishedAt === 'string' ? sn.publishedAt : ''
      lives.push({ id: id.trim(), title, publishedAt })
    }

    lives.sort((a, b) => {
      const ta = Date.parse(a.publishedAt) || 0
      const tb = Date.parse(b.publishedAt) || 0
      return tb - ta
    })

    const pick = lives[0]
    if (!pick) {
      const payload = {
        ok: true,
        live: false,
        videoId: null,
        title: null,
        reason: 'not_broadcasting',
        fetchedAt: now,
      }
      cache = { at: now, payload, ttl: CACHE_OK_MS }
      return payload
    }

    const payload = {
      ok: true,
      live: true,
      videoId: pick.id,
      title: pick.title || null,
      publishedAt: pick.publishedAt || null,
      fetchedAt: now,
    }
    cache = { at: now, payload, ttl: CACHE_OK_MS }
    return payload
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const payload = {
      ok: false,
      live: false,
      videoId: null,
      title: null,
      reason: 'fetch_failed',
      detail: msg.slice(0, 240),
      fetchedAt: now,
    }
    cache = { at: now, payload, ttl: CACHE_ERR_MS }
    return payload
  }
}
