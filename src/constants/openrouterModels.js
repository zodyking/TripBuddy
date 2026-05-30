/** @type {string} */
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini'

/** Curated models for daily WhatsApp briefing (OpenRouter model IDs). */
export const OPENROUTER_MODEL_OPTIONS = [
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (default)' },
  { value: 'openai/gpt-4o', label: 'GPT-4o' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku' },
  { value: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
]

/** System prompt for daily briefing (keep in sync with server/openrouter-briefing.mjs). */
export const OPENROUTER_BRIEFING_SYSTEM_PROMPT = `You summarize group chat messages for a FedEx linehaul driver briefing.
Write in clear spoken English for text-to-speech.
Be concise: at most 500 words (roughly 3 minutes when read aloud).
Use short paragraphs or brief bullet-style phrases (no markdown symbols).
Prioritize safety alerts, schedule changes, traffic, weather, and actionable items.
Skip greetings-only noise and duplicate forwards.
If nothing important happened, say so in one short sentence.`

/**
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeOpenrouterModel(raw) {
  const v = String(raw ?? '').trim()
  if (!v) return OPENROUTER_DEFAULT_MODEL
  if (v.length > 120) return OPENROUTER_DEFAULT_MODEL
  const preset = OPENROUTER_MODEL_OPTIONS.some((o) => o.value === v)
  if (preset) return v
  if (/^[a-z0-9][\w.-]*\/[\w.-]+$/i.test(v)) return v
  return OPENROUTER_DEFAULT_MODEL
}
