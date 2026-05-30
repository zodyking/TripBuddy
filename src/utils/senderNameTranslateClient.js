/**
 * Client helper: resolve English display names for sender strings (cached).
 */
import { needsEnglishSenderNameTranslation, englishDisplayName } from './senderNameLocale.js'
import { getCachedSenderTextEn, setCachedSenderTextEn } from '../stores/wahaChatStore.js'
import { postTranslateSenderNames, getSenderNameTranslationCache } from '../api.js'

/**
 * @param {Map<string, string>} rawByJid participant JID -> raw name
 * @returns {Promise<Map<string, string>>} JID -> display (English when translated)
 */
export async function buildEnglishParticipantDisplayMap(rawByJid) {
  const textEn = { ...getCachedSenderTextEn() }
  /** @type {Map<string, string>} */
  const display = new Map()
  const items = []

  for (const [jid, raw] of rawByJid) {
    const name = String(raw ?? '').trim()
    if (!name) continue
    if (!needsEnglishSenderNameTranslation(name)) {
      display.set(jid, name)
      continue
    }
    if (textEn[name]) {
      display.set(jid, textEn[name])
      continue
    }
    items.push({ id: jid, text: name })
  }

  if (items.length) {
    try {
      const r = await postTranslateSenderNames({ items })
      if (r?.ok) {
        if (r.textEn && typeof r.textEn === 'object') {
          Object.assign(textEn, r.textEn)
        }
        if (r.names && typeof r.names === 'object') {
          for (const [jid, en] of Object.entries(r.names)) {
            const raw = rawByJid.get(jid)
            if (raw && en) textEn[raw] = String(en)
            display.set(jid, String(en))
          }
        }
      }
    } catch {
      /* keep raw */
    }
    setCachedSenderTextEn(textEn)
  }

  for (const [jid, raw] of rawByJid) {
    if (!display.has(jid)) display.set(jid, englishDisplayName(raw, textEn))
  }

  return display
}

/** Merge server translation cache into session (call once on app load). */
export async function hydrateSenderTextEnFromServer() {
  try {
    const r = await getSenderNameTranslationCache()
    if (r?.ok && r.textEn && typeof r.textEn === 'object') {
      setCachedSenderTextEn({ ...getCachedSenderTextEn(), ...r.textEn })
    }
  } catch {
    /* optional */
  }
}
