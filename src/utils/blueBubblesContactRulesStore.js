/**
 * Per-contact iMessage automation rules (stored in profile JSONB, edited in chat UI).
 */
import {
  createDefaultContactRule,
  sanitizeContactRules,
  matchContactRule,
} from '../constants/blueBubblesContactRules.js'
import {
  getBlueBubblesContactRules,
  setBlueBubblesContactRules,
} from './blueBubblesApi.js'
import { saveBlueBubblesPrefsToServer } from './blueBubblesPrefs.js'

/**
 * @param {import('../constants/blueBubblesContactRules.js').ContactRule[]} rules
 * @param {import('../constants/blueBubblesContactRules.js').ContactRule} rule
 */
export function upsertContactRule(rules, rule) {
  const next = sanitizeContactRules(rules).filter((r) => {
    if (rule.chatGuid && r.chatGuid === rule.chatGuid) return false
    if (rule.handle && r.handle && r.handle.toLowerCase() === rule.handle.toLowerCase()) return false
    if (r.id === rule.id) return false
    return true
  })
  next.push(createDefaultContactRule(rule))
  return next
}

/**
 * @param {{ chatGuid?: string, handle?: string, label?: string }} ctx
 * @returns {import('../constants/blueBubblesContactRules.js').ContactRule}
 */
export function getOrCreateContactRule(ctx) {
  const rules = getBlueBubblesContactRules()
  const hit = matchContactRule(rules, ctx)
  if (hit) return { ...hit }
  return createDefaultContactRule({
    id: ctx.chatGuid || ctx.handle || `rule-${Date.now()}`,
    chatGuid: String(ctx.chatGuid ?? '').trim(),
    handle: String(ctx.handle ?? '').trim(),
    label: String(ctx.label ?? '').trim(),
    ttsEnabled: false,
    autoReplyEnabled: false,
    onlyWhenMonitoredChat: false,
  })
}

/**
 * @param {import('../constants/blueBubblesContactRules.js').ContactRule} rule
 */
export async function persistContactRule(rule) {
  const merged = upsertContactRule(getBlueBubblesContactRules(), rule)
  setBlueBubblesContactRules(merged)
  await saveBlueBubblesPrefsToServer({ contactRules: merged })
  return merged
}

/**
 * @param {{ handle?: string, chatGuid?: string, fromMe?: boolean }} ctx
 * @returns {import('../constants/blueBubblesContactRules.js').ContactRule | null}
 */
export function findContactRule(ctx) {
  const rules = getBlueBubblesContactRules()
  if (ctx.fromMe && ctx.chatGuid) {
    return matchContactRule(rules, { chatGuid: ctx.chatGuid })
  }
  return matchContactRule(rules, ctx)
}

/**
 * @param {import('../constants/blueBubblesContactRules.js').ContactRule | null} rule
 */
export function contactTtsEnabled(rule) {
  return rule?.ttsEnabled === true
}

/**
 * @param {import('../constants/blueBubblesContactRules.js').ContactRule | null} rule
 */
export function contactAutoReplyEnabled(rule) {
  return rule?.enabled !== false && rule?.autoReplyEnabled === true
}

/**
 * @param {import('../constants/blueBubblesContactRules.js').ContactRule | null} rule
 */
export function contactAiMediumEnabled(rule) {
  return rule?.enabled !== false && rule?.aiMediumEnabled === true
}

/**
 * @param {import('../constants/blueBubblesContactRules.js').ContactRule | null} rule
 */
export function contactOpenRouterReplyEnabled(rule) {
  return contactAiMediumEnabled(rule) || contactAutoReplyEnabled(rule)
}
