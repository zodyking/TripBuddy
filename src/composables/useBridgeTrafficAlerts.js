/**
 * In-app notifications + speech for PANYNJ tier changes (SSE `bridge_tier`).
 */
import { linehaulTripsBody } from '../stores/linehaulSnapshotStore.js'
import { registerBridgeTierListener } from '../stores/liveLogStore.js'
import { trafficCrossingDirection } from '../stores/trafficCrossingDirectionStore.js'
import { inferBridgeMonitorDirectionFromTrip } from '../utils/bridgeTripNjNy.js'
import { enqueueAnnouncement } from '../utils/alertAudioQueue.js'
import { postClientNotification } from '../api.js'
import { fetchInAppInbox } from '../stores/inAppNotificationsStore.js'

const LS_SPEECH = 'fedextool_bridgeTrafficSpeech'
const LS_NOTIFY = 'fedextool_bridgeTrafficNotify'

/** @returns {boolean} */
export function isBridgeTrafficSpeechEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true
  return window.localStorage.getItem(LS_SPEECH) !== 'false'
}

/** @returns {boolean} */
export function isBridgeTrafficNotifyEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return true
  return window.localStorage.getItem(LS_NOTIFY) !== 'false'
}

/** @param {boolean} v */
export function setBridgeTrafficSpeechEnabled(v) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(LS_SPEECH, v ? 'true' : 'false')
}

/** @param {boolean} v */
export function setBridgeTrafficNotifyEnabled(v) {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(LS_NOTIFY, v ? 'true' : 'false')
}

/** @param {string} t */
function tierRank(t) {
  if (t === 'green') return 0
  if (t === 'orange') return 1
  if (t === 'red') return 2
  return -1
}

/**
 * @param {string} title
 * @param {string} travelDir ToNY | ToNJ | ''
 */
function speechTitle(title, travelDir) {
  const base = String(title || 'Crossing').replace(/·/g, ', ')
  if (travelDir === 'ToNY') return `${base}, toward New York`
  if (travelDir === 'ToNJ') return `${base}, toward New Jersey`
  return base
}

/**
 * @param {object} ev
 */
async function handleBridgeTierEvent(ev) {
  if (!ev || typeof ev !== 'object') return
  const tier = typeof ev.tier === 'string' ? ev.tier : ''
  const prevTier = typeof ev.prevTier === 'string' ? ev.prevTier : ''
  const travelDirection =
    typeof ev.travelDirection === 'string' ? ev.travelDirection : ''
  const title = typeof ev.title === 'string' ? ev.title : 'Crossing'
  const mins =
    typeof ev.minutes === 'number' && Number.isFinite(ev.minutes)
      ? ev.minutes
      : null
  const speedMph =
    typeof ev.speedMph === 'number' && Number.isFinite(ev.speedMph)
      ? ev.speedMph
      : null

  const tripBody = linehaulTripsBody.value
  const { constrained, monitorDir } = inferBridgeMonitorDirectionFromTrip(tripBody)

  if (
    constrained &&
    monitorDir &&
    travelDirection &&
    travelDirection !== monitorDir
  ) {
    return
  }

  if (
    !constrained &&
    travelDirection &&
    trafficCrossingDirection.value &&
    travelDirection !== trafficCrossingDirection.value
  ) {
    return
  }

  if (!prevTier && tier !== 'red') {
    return
  }

  const worsened = tierRank(tier) > tierRank(prevTier)
  const improved = tierRank(tier) < tierRank(prevTier) && prevTier !== ''

  let trend = 'Traffic level changed.'
  if (worsened) trend = 'Traffic worsened.'
  else if (improved) trend = 'Traffic improved.'

  const st = speechTitle(title, travelDirection)
  const minPart =
    mins != null ? `Crossing time about ${Math.round(mins)} minutes.` : ''
  const spdPart =
    speedMph != null
      ? `Observed speed ${Math.round(speedMph)} miles per hour.`
      : ''

  if (isBridgeTrafficSpeechEnabled()) {
    const text = `${st}. ${trend} ${minPart} ${spdPart}`
      .replace(/\s+/g, ' ')
      .trim()
    const rowKey =
      typeof ev.rowKey === 'string' ? ev.rowKey : String(ev.routeId ?? '')
    enqueueAnnouncement(text, {
      bell: false,
      category: rowKey ? `bridgeTier:${rowKey}` : `bridgeTier:${title}`,
    })
  }

  if (isBridgeTrafficNotifyEnabled() && tier === 'red' && prevTier !== 'red') {
    const dirLab =
      travelDirection === 'ToNY'
        ? 'toward NY'
        : travelDirection === 'ToNJ'
          ? 'toward NJ'
          : ''
    const msg = [
      'Heavy traffic',
      dirLab,
      ':',
      title + '.',
      mins != null ? `${Math.round(mins)} minutes.` : '',
      speedMph != null ? `${Math.round(speedMph)} mph.` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    try {
      await postClientNotification({
        type: 'traffic',
        source: 'bridges',
        message: msg,
      })
      await fetchInAppInbox()
    } catch {
      /* offline */
    }
  }
}

/** @type {(() => void) | null} */
let unsub = null

export function startBridgeTrafficAlerts() {
  if (typeof window === 'undefined') return
  if (unsub) return
  unsub = registerBridgeTierListener((ev) => {
    void handleBridgeTierEvent(ev)
  })
}

export function stopBridgeTrafficAlerts() {
  if (unsub) {
    unsub()
    unsub = null
  }
}
