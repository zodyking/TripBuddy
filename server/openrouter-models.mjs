/**
 * Fetch and cache OpenRouter model catalog for Settings autocomplete.
 * @see https://openrouter.ai/docs/api-reference/models/get-models
 */
import { OPENROUTER_DEFAULT_MODEL } from '../src/constants/openrouterModels.js'

const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=text'

/** @type {{ at: number, models: Array<{ id: string, name: string, description: string }> } | null} */
let cache = null
const CACHE_MS = 15 * 60 * 1000

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function isValidOpenrouterModelId(raw) {
  const v = String(raw ?? '').trim()
  if (!v || v.length > 120) return false
  return /^[a-z0-9][\w.-]*\/[\w.-]+$/i.test(v)
}

/**
 * @param {unknown} row
 * @returns {{ id: string, name: string, description: string } | null}
 */
function normalizeModelRow(row) {
  if (!row || typeof row !== 'object') return null
  const r = /** @type {Record<string, unknown>} */ (row)
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  if (!isValidOpenrouterModelId(id)) return null

  const arch = r.architecture && typeof r.architecture === 'object' ? r.architecture : null
  const outMods = arch && Array.isArray(arch.output_modalities) ? arch.output_modalities : null
  if (outMods && outMods.length && !outMods.includes('text')) return null

  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id
  const description =
    typeof r.description === 'string' ? r.description.trim().slice(0, 200) : ''

  return { id, name, description }
}

/**
 * @param {string} [apiKey] optional user key (public catalog works without)
 * @returns {Promise<Array<{ id: string, name: string, description: string }>>}
 */
export async function fetchOpenrouterModelsCatalog(apiKey = '') {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) {
    return cache.models
  }

  const headers = { Accept: 'application/json' }
  const key = String(apiKey || process.env.OPENROUTER_API_KEY || '').trim()
  if (key) headers.Authorization = `Bearer ${key}`

  const referer =
    (process.env.APP_PUBLIC_URL || process.env.VITE_APP_URL || '').trim() ||
    'https://tripbuddy.local'
  headers['HTTP-Referer'] = referer
  headers['X-Title'] = 'TripBuddy'

  const r = await fetch(MODELS_URL, { headers })
  const text = await r.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!r.ok) {
    const errMsg =
      body?.error?.message ||
      body?.error ||
      (typeof body?.message === 'string' ? body.message : '') ||
      `OpenRouter models HTTP ${r.status}`
    throw new Error(String(errMsg).slice(0, 400))
  }

  const data = Array.isArray(body?.data) ? body.data : []
  const models = data.map(normalizeModelRow).filter(Boolean)
  models.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  cache = { at: now, models }
  return models
}

/**
 * @param {string} query
 * @param {Array<{ id: string, name: string, description: string }>} models
 * @param {number} [limit]
 */
export function filterOpenrouterModels(models, query, limit = 40) {
  const q = String(query ?? '').trim().toLowerCase()
  let list = models
  if (q) {
    list = models.filter((m) => {
      if (m.id.toLowerCase().includes(q)) return true
      if (m.name.toLowerCase().includes(q)) return true
      return false
    })
  }
  const cap = Math.max(1, Math.min(80, limit))
  const out = list.slice(0, cap)
  if (
    q &&
    isValidOpenrouterModelId(q) &&
    !out.some((m) => m.id.toLowerCase() === q)
  ) {
    out.unshift({ id: q, name: q, description: 'Custom model id' })
  }
  return out
}

export { OPENROUTER_DEFAULT_MODEL }
