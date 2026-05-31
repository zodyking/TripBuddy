import { ref, computed } from 'vue'

const MAX_ITEMS = 30

/** @type {import('vue').Ref<boolean>} */
export const chatMessageSpeechOpen = ref(false)

/** @type {import('vue').Ref<number>} */
export const chatMessageSpeechIndex = ref(0)

/**
 * Newest-first list of messages shown in the swipeable popup.
 * @type {import('vue').Ref<Array<{
 *   id: string,
 *   speech: string,
 *   displayBody: string,
 *   senderLabel: string,
 *   fromMe: boolean,
 *   ts: number,
 *   receivedAt: number,
 * }>>}
 */
export const chatMessageSpeechItems = ref([])

export const chatMessageSpeechCount = computed(() => chatMessageSpeechItems.value.length)

export const chatMessageSpeechCurrent = computed(() => {
  const list = chatMessageSpeechItems.value
  const i = chatMessageSpeechIndex.value
  if (!list.length || i < 0 || i >= list.length) return null
  return list[i]
})

export const chatMessageSpeechPositionLabel = computed(() => {
  const n = chatMessageSpeechItems.value.length
  if (!n) return ''
  return `${chatMessageSpeechIndex.value + 1} of ${n}`
})

export const canGoToOlderChatSpeech = computed(
  () => chatMessageSpeechIndex.value < chatMessageSpeechItems.value.length - 1,
)

export const canGoToNewerChatSpeech = computed(() => chatMessageSpeechIndex.value > 0)

/**
 * @param {{
 *   id: string,
 *   speech: string,
 *   displayBody: string,
 *   senderLabel: string,
 *   fromMe?: boolean,
 *   ts?: number,
 *   receivedAt?: number,
 * }} item
 * @param {{ focusNewest?: boolean }} [opts]
 */
export function pushChatMessageSpeech(item) {
  const id = String(item.id || '').trim()
  if (!id) return
  const next = chatMessageSpeechItems.value.filter((row) => row.id !== id)
  next.unshift({
    id,
    speech: String(item.speech || '').trim(),
    displayBody: String(item.displayBody || '').trim(),
    senderLabel: String(item.senderLabel || '').trim() || 'Unknown',
    fromMe: Boolean(item.fromMe),
    ts: Number(item.ts) || Date.now(),
    receivedAt: Number(item.receivedAt) || Date.now(),
  })
  chatMessageSpeechItems.value = next.slice(0, MAX_ITEMS)
  if (opts?.focusNewest !== false) chatMessageSpeechIndex.value = 0
  chatMessageSpeechOpen.value = true
}

/**
 * @param {string} category e.g. whatsapp:msgId or chatmsg:msgId
 */
export function focusChatMessageSpeechByCategory(category) {
  const raw = String(category || '')
  const id = raw.replace(/^(whatsapp|chatmsg):/, '')
  if (!id) return
  const i = chatMessageSpeechItems.value.findIndex((row) => row.id === id)
  if (i >= 0) chatMessageSpeechIndex.value = i
}

export function goToOlderChatSpeech() {
  if (canGoToOlderChatSpeech.value) chatMessageSpeechIndex.value += 1
}

export function goToNewerChatSpeech() {
  if (canGoToNewerChatSpeech.value) chatMessageSpeechIndex.value -= 1
}

export function closeChatMessageSpeech() {
  chatMessageSpeechOpen.value = false
}

export function clearChatMessageSpeech() {
  chatMessageSpeechItems.value = []
  chatMessageSpeechIndex.value = 0
  chatMessageSpeechOpen.value = false
}
