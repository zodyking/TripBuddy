const DEVICE_ID_KEY = 'fedextool-device-id'
const DEVICE_NAME_KEY = 'fedextool-device-name'

/**
 * @returns {string}
 */
export function getOrCreateDeviceId() {
  if (typeof window === 'undefined') return `server-${Date.now()}`
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return `ephemeral-${Date.now()}`
  }
}

/**
 * @param {string} name
 */
export function setLocalDeviceName(name) {
  if (typeof window === 'undefined') return
  try {
    const t = String(name ?? '').trim().slice(0, 80)
    if (t) localStorage.setItem(DEVICE_NAME_KEY, t)
    else localStorage.removeItem(DEVICE_NAME_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * @returns {string}
 */
export function getLocalDeviceName() {
  if (typeof window === 'undefined') return ''
  try {
    return String(localStorage.getItem(DEVICE_NAME_KEY) ?? '').trim().slice(0, 80)
  } catch {
    return ''
  }
}

/**
 * @param {string} ua
 * @returns {'mobile' | 'desktop' | 'tablet'}
 */
export function detectFormFactor(ua = '') {
  if (typeof navigator !== 'undefined') {
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    const touch =
      typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1
    const narrow =
      typeof window.innerWidth === 'number' && window.innerWidth <= 820
    if (coarse && touch && narrow) return 'mobile'
    if ((coarse || touch) && narrow) return 'tablet'
  }
  if (/iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua)) return 'mobile'
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet'
  return 'desktop'
}

/**
 * @param {string} ua
 * @returns {string}
 */
export function detectOs(ua) {
  if (/Windows NT 10/i.test(ua)) return 'Windows 10+'
  if (/Windows NT/i.test(ua)) return 'Windows'
  if (/Mac OS X/i.test(ua)) return 'macOS'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Unknown OS'
}

/**
 * @param {string} ua
 * @returns {string}
 */
export function detectBrowser(ua) {
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera'
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'Safari'
  return 'Browser'
}

/**
 * @returns {{
 *   deviceId: string,
 *   name: string,
 *   os: string,
 *   formFactor: 'mobile' | 'desktop' | 'tablet',
 *   browser: string,
 *   userAgent: string,
 * }}
 */
export function collectDeviceInfo() {
  const ua =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : ''
  const os = detectOs(ua)
  const browser = detectBrowser(ua)
  const formFactor = detectFormFactor(ua)
  const defaultName = `${browser} on ${os}`.slice(0, 80)
  const savedName = getLocalDeviceName()
  return {
    deviceId: getOrCreateDeviceId(),
    name: savedName || defaultName,
    os,
    formFactor,
    browser,
    userAgent: ua.slice(0, 512),
  }
}

/**
 * @param {unknown} formFactor
 * @returns {string}
 */
export function formatFormFactorLabel(formFactor) {
  const s = String(formFactor ?? '').toLowerCase()
  if (s === 'mobile') return 'Mobile'
  if (s === 'tablet') return 'Tablet'
  return 'Desktop'
}
