/** Only auto-fetch / render image bytes for messages within this window. */
export const CHAT_IMAGE_LOAD_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

/**
 * @param {number} ts Message timestamp (ms).
 * @param {number} [nowMs]
 */
export function isWithinChatImageLoadWindow(ts, nowMs = Date.now()) {
  const t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return false
  return nowMs - t <= CHAT_IMAGE_LOAD_WINDOW_MS
}

/**
 * @param {{ ts?: number, hasMedia?: boolean, media?: { kind?: string, url?: string } | null, poll?: unknown } | null} msg
 */
export function getChatMediaKind(msg) {
  if (!msg) return ''
  if (msg.poll) return 'poll'
  const kind = String(msg.media?.kind || '').toLowerCase()
  if (kind) return kind
  if (msg.hasMedia) return 'file'
  return ''
}

/**
 * Whether the client should call WAHA to download media for this message.
 * @param {{ ts?: number, hasMedia?: boolean, media?: { kind?: string, url?: string } | null, poll?: unknown } | null} msg
 */
export function shouldFetchChatMedia(msg) {
  if (!msg?.hasMedia || msg.media?.url || msg.poll) return false
  if (!isWithinChatImageLoadWindow(msg.ts)) return false
  const kind = getChatMediaKind(msg)
  if (kind === 'video' || kind === 'audio' || kind === 'document') return false
  if (kind === 'image' || kind === 'sticker' || kind === 'file') return true
  return true
}

/**
 * Show "open app on your phone" instead of loading or embedding media.
 * @param {{ ts?: number, hasMedia?: boolean, media?: { kind?: string, url?: string } | null, poll?: unknown } | null} msg
 */
export function shouldShowPhoneMediaPlaceholder(msg) {
  if (!msg?.hasMedia || msg.poll) return false
  const kind = getChatMediaKind(msg)
  if (kind === 'video' || kind === 'audio' || kind === 'document' || kind === 'file') return true
  if (kind === 'image' || kind === 'sticker') {
    return !isWithinChatImageLoadWindow(msg.ts)
  }
  return Boolean(msg.hasMedia && !msg.media?.url)
}

/**
 * Render image/sticker in the thread (recent images only).
 * @param {{ ts?: number, hasMedia?: boolean, media?: { kind?: string, url?: string } | null, poll?: unknown } | null} msg
 */
export function shouldRenderInlineMedia(msg) {
  if (!msg?.media?.url || msg.poll) return false
  const kind = getChatMediaKind(msg)
  if (kind === 'image' || kind === 'sticker') {
    return isWithinChatImageLoadWindow(msg.ts)
  }
  return false
}

/**
 * @param {{ ts?: number, hasMedia?: boolean, media?: { kind?: string, url?: string } | null, poll?: unknown } | null} msg
 * @returns {'inline' | 'placeholder' | 'pending' | 'none'}
 */
export function getChatMediaDisplayState(msg) {
  if (!msg?.hasMedia && !msg?.poll) return 'none'
  if (msg.poll) return 'inline'
  if (shouldShowPhoneMediaPlaceholder(msg)) return 'placeholder'
  if (shouldRenderInlineMedia(msg)) return 'inline'
  if (shouldFetchChatMedia(msg)) return 'pending'
  return 'placeholder'
}
