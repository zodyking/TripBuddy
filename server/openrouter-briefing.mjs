/**
 * OpenRouter chat completion for WhatsApp daily briefing summaries.
 */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'openai/gpt-4o-mini'
const MAX_OUTPUT_TOKENS = 900

/**
 * @param {string} apiKey
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ model?: string, maxTokens?: number }} [opts]
 */
export async function openRouterComplete(apiKey, messages, opts = {}) {
  const key = String(apiKey || '').trim()
  if (!key) return { ok: false, error: 'OpenRouter API key not configured.' }

  const referer =
    (process.env.APP_PUBLIC_URL || process.env.VITE_APP_URL || '').trim() ||
    'https://tripbuddy.local'

  const r = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'TripBuddy Daily Briefing',
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
      temperature: 0.4,
      messages,
    }),
  })

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
      `OpenRouter HTTP ${r.status}`
    return { ok: false, error: String(errMsg).slice(0, 500) }
  }

  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'OpenRouter returned empty summary.' }
  }

  return { ok: true, text: content.trim() }
}

/**
 * @param {string} transcript
 * @param {string} chatLabel
 */
export function buildBriefingPrompt(transcript, chatLabel) {
  const label = String(chatLabel || 'WhatsApp chat').trim() || 'WhatsApp chat'
  return [
    {
      role: 'system',
      content: `You summarize group chat messages for a FedEx linehaul driver briefing.
Write in clear spoken English for text-to-speech.
Be concise: at most 500 words (roughly 3 minutes when read aloud).
Use short paragraphs or brief bullet-style phrases (no markdown symbols).
Prioritize safety alerts, schedule changes, traffic, weather, and actionable items.
Skip greetings-only noise and duplicate forwards.
If nothing important happened, say so in one short sentence.`,
    },
    {
      role: 'user',
      content: `Chat: ${label}\nToday's messages:\n\n${transcript}`,
    },
  ]
}

/**
 * Rough word cap for TTS (~500 words).
 * @param {string} text
 * @param {number} [maxWords]
 */
export function trimBriefingForSpeech(text, maxWords = 500) {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length <= maxWords) return words.join(' ')
  return `${words.slice(0, maxWords).join(' ')}…`
}
