/**
 * Translate short display strings to English (sender names).
 * Uses Google Cloud Translation API when GOOGLE_TRANSLATE_API_KEY is set;
 * otherwise the public gtx client (best-effort, no key).
 */

const CLOUD_URL = 'https://translation.googleapis.com/language/translate/v2'
const GTX_URL = 'https://translate.googleapis.com/translate_a/single'

/**
 * @param {string} text
 */
async function gtxTranslateOne(text) {
  const q = encodeURIComponent(String(text).slice(0, 200))
  const url = `${GTX_URL}?client=gtx&sl=auto&tl=en&dt=t&q=${q}`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) return ''
  const data = await r.json().catch(() => null)
  const out = data?.[0]?.[0]?.[0]
  return typeof out === 'string' ? out.trim() : ''
}

/**
 * @param {string[]} texts unique non-empty strings
 * @param {string} apiKey
 */
async function cloudTranslateBatch(texts, apiKey) {
  const r = await fetch(`${CLOUD_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: texts,
      target: 'en',
      format: 'text',
    }),
  })
  const body = await r.json().catch(() => null)
  if (!r.ok) {
    const msg = body?.error?.message || `Google Translate HTTP ${r.status}`
    throw new Error(String(msg).slice(0, 300))
  }
  const translations = body?.data?.translations
  if (!Array.isArray(translations)) return []
  return translations.map((t) => String(t?.translatedText ?? '').trim())
}

/**
 * @param {string} text
 * @param {string} [apiKey]
 */
export async function translateTextToEnglish(text, apiKey) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  const key = String(apiKey ?? process.env.GOOGLE_TRANSLATE_API_KEY ?? '').trim()
  if (key) {
    const [out] = await cloudTranslateBatch([raw], key)
    return out || raw
  }
  const out = await gtxTranslateOne(raw)
  return out || raw
}

/**
 * @param {Array<{ id: string, text: string }>} items
 * @param {{ apiKey?: string }} [opts]
 * @returns {Promise<Record<string, string>>}
 */
export async function translateSenderNamesToEnglish(items, opts = {}) {
  /** @type {Record<string, string>} */
  const result = {}
  const list = Array.isArray(items) ? items : []
  if (!list.length) return result

  const byText = new Map()
  for (const item of list) {
    const id = String(item?.id ?? '').trim()
    const text = String(item?.text ?? '').trim()
    if (!id || !text) continue
    const norm = text.toLowerCase()
    if (!byText.has(norm)) byText.set(norm, { text, ids: [] })
    byText.get(norm).ids.push(id)
  }

  const uniqueTexts = [...byText.values()].map((v) => v.text)
  if (!uniqueTexts.length) return result

  const key = String(opts.apiKey ?? process.env.GOOGLE_TRANSLATE_API_KEY ?? '').trim()
  /** @type {string[]} */
  let translated = []

  if (key) {
    const batchSize = 50
    for (let i = 0; i < uniqueTexts.length; i += batchSize) {
      const chunk = uniqueTexts.slice(i, i + batchSize)
      const part = await cloudTranslateBatch(chunk, key)
      translated.push(...part)
    }
  } else {
    translated = await Promise.all(
      uniqueTexts.map((t) => gtxTranslateOne(t).catch(() => '')),
    )
  }

  uniqueTexts.forEach((original, idx) => {
    const en = String(translated[idx] ?? '').trim() || original
    const norm = original.toLowerCase()
    const entry = byText.get(norm)
    if (!entry) return
    for (const id of entry.ids) result[id] = en
  })

  return result
}
