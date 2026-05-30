/** @type {string} */
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini'

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
  if (/^[a-z0-9][\w.-]*\/[\w.-]+$/i.test(v)) return v
  return OPENROUTER_DEFAULT_MODEL
}
