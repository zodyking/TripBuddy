/**
 * OpenRouter chat completion for WhatsApp daily briefing summaries.
 */
import {
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_BRIEFING_SYSTEM_PROMPT,
  sanitizeOpenrouterModel,
} from '../src/constants/openrouterModels.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_TITLE = 'TripBuddy Daily Briefing'
const MAX_OUTPUT_TOKENS = 900
const REQUEST_TIMEOUT_MS = 45_000

export { OPENROUTER_DEFAULT_MODEL, sanitizeOpenrouterModel }

function cleanPromptText(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .map((m) => {
      const role = ['system', 'user', 'assistant'].includes(String(m?.role))
        ? String(m.role)
        : 'user'
      const content = cleanPromptText(m?.content)
      return content ? { role, content } : null
    })
    .filter(Boolean)
}

function responseContentText(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part?.type === 'text' && typeof part.text === 'string') return part.text
      return ''
    })
    .join(' ')
    .trim()
}

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
  const normalizedMessages = normalizeMessages(messages)
  if (!normalizedMessages.length) {
    return { ok: false, error: 'Briefing prompt is empty.' }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let r
  try {
    r = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': referer,
        'X-OpenRouter-Title': OPENROUTER_TITLE,
        'X-Title': OPENROUTER_TITLE,
      },
      body: JSON.stringify({
        model: sanitizeOpenrouterModel(opts.model || OPENROUTER_DEFAULT_MODEL),
        max_completion_tokens: opts.maxTokens ?? MAX_OUTPUT_TOKENS,
        temperature: 0.4,
        messages: normalizedMessages,
      }),
    })
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return {
      ok: false,
      error: aborted ? 'OpenRouter request timed out.' : `OpenRouter request failed: ${e?.message || e}`,
    }
  } finally {
    clearTimeout(timer)
  }

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

  const content = responseContentText(body?.choices?.[0]?.message?.content)
  if (!content) {
    return { ok: false, error: 'OpenRouter returned empty summary.' }
  }

  return { ok: true, text: content }
}

/**
 * @param {string} transcript
 * @param {string} chatLabel
 * @param {{ dateLabel?: string, windowLabel?: string, timeZone?: string }} [opts]
 */
export function buildBriefingPrompt(transcript, chatLabel, opts = {}) {
  const label = String(chatLabel || 'WhatsApp chat').trim() || 'WhatsApp chat'
  const dateLabel = cleanPromptText(opts.dateLabel || '')
  const windowLabel = cleanPromptText(opts.windowLabel || '')
  const timeZone = cleanPromptText(opts.timeZone || '')
  const cleanTranscript = cleanPromptText(transcript)
  const scope = [
    `Chat: ${label}`,
    dateLabel ? `Current date: ${dateLabel}` : '',
    windowLabel ? `Briefing window: ${windowLabel}` : '',
    timeZone ? `Time zone: ${timeZone}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return [
    {
      role: 'system',
      content: OPENROUTER_BRIEFING_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: `${scope}\n\nRecent clean chat transcript:\n\n${cleanTranscript}`,
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
