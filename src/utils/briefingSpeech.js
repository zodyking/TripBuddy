/**
 * Enable device speech + trip/WhatsApp TTS before playing a chat briefing.
 * Call synchronously from a click handler (unlock must run in the gesture).
 */
import {
  getTripAlertMode,
  setTripAlertMode,
  tripVoiceIsGestureUnlocked,
  unlockTripVoiceFromUserGesture,
} from './tripVoiceAnnouncement.js'
import { setWahaTtsEnabled } from './wahaApi.js'
import { saveWahaPrefsToServer } from './wahaPrefs.js'

export function enableSpeechAlertsForBriefing() {
  if (getTripAlertMode() === 'off') setTripAlertMode('tts')
  setWahaTtsEnabled(true)
  if (!tripVoiceIsGestureUnlocked()) {
    unlockTripVoiceFromUserGesture({ silent: true })
  }
  void saveWahaPrefsToServer({ ttsEnabled: true }).catch(() => {})
}
