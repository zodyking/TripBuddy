/**
 * Default per-contact automation rule shape for BlueBubbles / iMessage.
 */

/** @typedef {{
 *   id: string,
 *   label: string,
 *   handle: string,
 *   chatGuid: string,
 *   enabled: boolean,
 *   ttsEnabled: boolean | null,
 *   autoReplyEnabled: boolean,
 *   systemPrompt: string,
 *   replyModel: string,
 *   includeTripContext: boolean,
 *   keywordTriggers: string[],
 *   ignoreKeywords: string[],
 *   quietHoursStart: string,
 *   quietHoursEnd: string,
 *   cooldownSeconds: number,
 *   maxRepliesPerHour: number,
 *   onlyWhenMonitoredChat: boolean,
 * }} ContactRule */

export const DEFAULT_CONTACT_SYSTEM_PROMPT = `You are replying on iMessage as a helpful personal assistant. Keep replies concise (1-3 sentences), natural, and suitable for texting. Do not use markdown. Match the sender's language when obvious. Never reveal you are an AI unless asked.`

/**
 * @param {Partial<ContactRule>} [overrides]
 * @returns {ContactRule}
 */
export function createDefaultContactRule(overrides = {}) {
  const id = String(overrides.id ?? `rule-${Date.now()}`).trim()
  return {
    id,
    label: String(overrides.label ?? '').trim(),
    handle: String(overrides.handle ?? '').trim(),
    chatGuid: String(overrides.chatGuid ?? '').trim(),
    enabled: overrides.enabled !== false,
    ttsEnabled: overrides.ttsEnabled ?? null,
    autoReplyEnabled: overrides.autoReplyEnabled === true,
    systemPrompt: String(overrides.systemPrompt ?? DEFAULT_CONTACT_SYSTEM_PROMPT).trim(),
    replyModel: String(overrides.replyModel ?? '').trim(),
    includeTripContext: overrides.includeTripContext === true,
    keywordTriggers: Array.isArray(overrides.keywordTriggers) ? [...overrides.keywordTriggers] : [],
    ignoreKeywords: Array.isArray(overrides.ignoreKeywords) ? [...overrides.ignoreKeywords] : [],
    quietHoursStart: String(overrides.quietHoursStart ?? '').trim(),
    quietHoursEnd: String(overrides.quietHoursEnd ?? '').trim(),
    cooldownSeconds: Math.max(0, Number(overrides.cooldownSeconds) || 15),
    maxRepliesPerHour: Math.max(0, Number(overrides.maxRepliesPerHour) || 20),
    onlyWhenMonitoredChat: overrides.onlyWhenMonitoredChat !== false,
  }
}

/**
 * @param {unknown} raw
 * @returns {ContactRule[]}
 */
export function sanitizeContactRules(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row, i) => {
      if (!row || typeof row !== 'object') return null
      return createDefaultContactRule({ ...row, id: String(row.id ?? `rule-${i}`) })
    })
    .filter(Boolean)
}

/**
 * @param {ContactRule[]} rules
 * @param {{ handle?: string, chatGuid?: string }} ctx
 * @returns {ContactRule | null}
 */
export function matchContactRule(rules, ctx) {
  const handle = String(ctx.handle ?? '').trim().toLowerCase()
  const chatGuid = String(ctx.chatGuid ?? '').trim()
  const enabled = rules.filter((r) => r.enabled !== false)
  for (const r of enabled) {
    if (r.chatGuid && r.chatGuid === chatGuid) return r
  }
  for (const r of enabled) {
    const h = String(r.handle ?? '').trim().toLowerCase()
    if (h && handle && (h === handle || handle.includes(h))) return r
  }
  return null
}

/**
 * @param {ContactRule | null} rule
 * @param {boolean} globalTts
 */
export function shouldTtsForContact(rule, globalTts) {
  if (rule?.ttsEnabled === true) return true
  if (rule?.ttsEnabled === false) return false
  return globalTts
}
