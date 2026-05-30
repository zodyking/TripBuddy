/**
 * Free English translation for short strings (e.g. WhatsApp sender names).
 * Uses Google’s public translate endpoint (client=gtx) — no API key required.
 */

const GTX_URL = 'https://translate.googleapis.com/translate_a/single'
const MAX_TEXT_LEN = 200
const BATCH_DELAY_MS = 80

/**
 * @param {unknown} data
 */
function parseGtxResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) return ''
  const parts = []
  for (const row of data[0]) {
    if (Array.isArray(row) && typeof row[0] === 'string') parts.push(row[0])
  }
  return parts.join('').trim()
}

/**
 * @param {string} text
 * @param {number} [retries]
 */
async function gtxTranslateOne(text, retries = 2) {
  const raw = String(text ?? '').trim().slice(0, MAX_TEXT_LEN)
  if (!raw) return ''

  const url = `${GTX_URL}?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(raw)}`
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; TripBuddy/1.0)',
    Accept: '*/*',
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers })
      if (!r.ok) {
        if (attempt < retries) {
          await sleep(120 * (attempt + 1))
          continue
        }
        return ''
      }
      const data = await r.json().catch(() => null)
      const out = parseGtxResponse(data)
      if (out) return out
    } catch {
      /* retry */
    }
    if (attempt < retries) await sleep(120 * (attempt + 1))
  }
  return ''
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {string} text
 */
export async function translateTextToEnglish(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  const out = await gtxTranslateOne(raw)
  return out || raw
}

/**
 * @param {Array<{ id: string, text: string }>} items
 * @returns {Promise<Record<string, string>>}
 */
export async function translateSenderNamesToEnglish(items) {
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
  for (let i = 0; i < uniqueTexts.length; i++) {
    const original = uniqueTexts[i]
    const en = (await gtxTranslateOne(original)) || original
    const norm = original.toLowerCase()
    const entry = byText.get(norm)
    if (!entry) continue
    for (const id of entry.ids) result[id] = en
    if (i < uniqueTexts.length - 1) await sleep(BATCH_DELAY_MS)
  }

  return result
}
