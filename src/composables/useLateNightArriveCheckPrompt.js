import { ref, onMounted, onUnmounted } from 'vue'

const TICK_MS = 15_000
const SILENCE_MS = 5 * 60 * 1000
/** Local 11:30 PM through 11:59 PM (device clock). */
const WINDOW_START_MIN = 23 * 60 + 30
const WINDOW_END_MIN = 23 * 60 + 59

function calendarDay(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function minutesSinceMidnightLocal(d) {
  return d.getHours() * 60 + d.getMinutes()
}

function inLateNightWindow(d = new Date()) {
  const t = minutesSinceMidnightLocal(d)
  return t >= WINDOW_START_MIN && t <= WINDOW_END_MIN
}

function isFinalAskMinute(d = new Date()) {
  return d.getHours() === 23 && d.getMinutes() === 59
}

function cancelArriveCheckSpeech() {
  try {
    globalThis.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}

function speakArriveCheckPrompt() {
  try {
    const syn = globalThis.speechSynthesis
    if (!syn) return
    syn.cancel()
    const u = new SpeechSynthesisUtterance('Would you like to arrive the trip?')
    u.rate = 1
    syn.speak(u)
  } catch {
    /* ignore */
  }
}

/**
 * While eligible (e.g. driver ENRT + active trip), between 11:30 PM–11:59 PM local time,
 * opens a modal on an interval; after "No", waits 5 minutes before asking again except
 * for a mandatory prompt during the 11:59 PM minute.
 *
 * @param {{
 *   isEligible: () => boolean,
 *   isAutomationRunning: () => boolean,
 *   onYes: () => Promise<void>,
 * }} options
 */
export function useLateNightArriveCheckPrompt(options) {
  const isOpen = ref(false)
  const busy = ref(false)
  /** Timestamp (ms); non-final prompts suppressed until this time. */
  const silentUntil = ref(0)
  /** Calendar day (YYYY-MM-DD) on which the 11:59 PM prompt was already shown. */
  const finalAskShownOnDay = ref('')

  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null

  function evaluate() {
    const now = new Date()
    const day = calendarDay(now)

    if (finalAskShownOnDay.value && finalAskShownOnDay.value !== day) {
      finalAskShownOnDay.value = ''
    }

    if (!inLateNightWindow(now)) {
      if (isOpen.value && !busy.value) {
        isOpen.value = false
        cancelArriveCheckSpeech()
      }
      silentUntil.value = 0
      return
    }

    if (!options.isEligible()) return
    if (options.isAutomationRunning() || busy.value) return

    if (isFinalAskMinute(now)) {
      if (finalAskShownOnDay.value === day) return
      finalAskShownOnDay.value = day
      cancelArriveCheckSpeech()
      isOpen.value = true
      speakArriveCheckPrompt()
      return
    }

    if (isOpen.value) return
    if (Date.now() < silentUntil.value) return

    isOpen.value = true
    speakArriveCheckPrompt()
  }

  async function confirmYes() {
    if (busy.value) return
    busy.value = true
    cancelArriveCheckSpeech()
    silentUntil.value = Number.MAX_SAFE_INTEGER
    isOpen.value = false
    try {
      await options.onYes()
    } finally {
      busy.value = false
    }
  }

  function confirmNo() {
    if (busy.value) return
    cancelArriveCheckSpeech()
    isOpen.value = false
    silentUntil.value = Date.now() + SILENCE_MS
  }

  onMounted(() => {
    timer = setInterval(evaluate, TICK_MS)
    evaluate()
  })

  onUnmounted(() => {
    if (timer != null) {
      clearInterval(timer)
      timer = null
    }
    cancelArriveCheckSpeech()
  })

  return {
    lateNightArriveCheckOpen: isOpen,
    lateNightArriveCheckBusy: busy,
    confirmLateNightArriveCheckYes: confirmYes,
    confirmLateNightArriveCheckNo: confirmNo,
  }
}
