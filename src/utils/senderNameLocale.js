/**
 * Detect WhatsApp display names that should be shown in English (Latin script).
 */

/**
 * @param {string} name
 */
export function isPhoneLikeSenderName(name) {
  const s = String(name ?? '').trim()
  if (!s) return true
  return /^\+?[\d\s().-]{6,}$/.test(s)
}

/**
 * @param {string} name
 */
export function needsEnglishSenderNameTranslation(name) {
  const s = String(name ?? '').trim()
  if (!s || s.length < 2) return false
  if (isPhoneLikeSenderName(s)) return false
  if (/@(c\.us|g\.us|lid|broadcast|s\.whatsapp\.net)$/i.test(s)) return false

  // Non-Latin scripts (CJK, Arabic, Cyrillic, Hebrew, Devanagari, Thai, etc.)
  if (
    /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0590-\u05FF\u0900-\u097F\u0E00-\u0E7F]/.test(
      s,
    )
  ) {
    return true
  }

  const letters = [...s].filter((c) => /\p{L}/u.test(c))
  if (!letters.length) return false

  const basicLatin = letters.filter((c) => /[A-Za-z]/.test(c)).length
  const latinExtended = letters.filter((c) => /\p{Script=Latin}/u.test(c) && !/[A-Za-z]/.test(c)).length

  if (basicLatin === 0 && latinExtended > 0) return true
  if (latinExtended > 0 && latinExtended / letters.length >= 0.35) return true

  return false
}

/**
 * @param {string} name
 */
export function isLikelyEnglishDisplayName(name) {
  return !needsEnglishSenderNameTranslation(name)
}
