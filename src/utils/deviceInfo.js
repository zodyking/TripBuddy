const DEVICE_ID_KEY = 'fedextool-device-id'
const DEVICE_NAME_KEY = 'fedextool-device-name'

/** @typedef {'iphone' | 'ipad' | 'ipod' | 'android-phone' | 'android-tablet' | 'windows-pc' | 'mac' | 'chromebook' | 'linux-pc' | 'unknown'} DeviceClass */

/**
 * @typedef {Object} DeviceEnvHints
 * @property {number} [maxTouchPoints]
 * @property {string} [platform]
 * @property {boolean} [uaMobile]
 * @property {number} [screenMinCssPx]
 * @property {number} [screenMaxCssPx]
 */

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
 * @returns {string}
 */
function parseIosVersion(ua) {
  const m = ua.match(/(?:iPhone OS|CPU (?:iPhone )?OS|iPad; CPU OS)\s+([\d_]+)/i)
  if (m) return m[1].replace(/_/g, '.')
  const macLike = ua.match(/Version\/([\d.]+)/i)
  if (macLike && /iPhone|iPad|iPod|Mobile/i.test(ua)) return macLike[1]
  return ''
}

/**
 * @param {string} ua
 * @returns {string}
 */
function parseAndroidVersion(ua) {
  const m = ua.match(/Android\s+([\d.]+)/i)
  return m ? m[1] : ''
}

/**
 * @param {string} ua
 * @returns {string}
 */
function parseWindowsVersion(ua) {
  if (/Windows NT 10\.0/i.test(ua)) return '11'
  if (/Windows NT 6\.3/i.test(ua)) return '8.1'
  if (/Windows NT 6\.2/i.test(ua)) return '8'
  if (/Windows NT 6\.1/i.test(ua)) return '7'
  return ''
}

/**
 * @param {string} ua
 * @returns {string}
 */
function parseMacOsVersion(ua) {
  const m = ua.match(/Mac OS X\s+([\d_]+)/i)
  return m ? m[1].replace(/_/g, '.') : ''
}

/**
 * @param {DeviceEnvHints} hints
 */
function touchMacintosh(hints) {
  const platform = String(hints.platform ?? '')
  const touch = typeof hints.maxTouchPoints === 'number' && hints.maxTouchPoints > 1
  return touch && /Mac|iPhone|iPod|iPad/i.test(platform)
}

/**
 * @param {string} ua
 * @param {DeviceEnvHints} hints
 */
function detectDeviceClass(ua, hints = {}) {
  if (/iPhone/i.test(ua)) return 'iphone'
  if (/iPad/i.test(ua)) return 'ipad'
  if (/iPod/i.test(ua)) return 'ipod'

  if (touchMacintosh(hints) || (/\bMacintosh\b/i.test(ua) && hints.uaMobile === true)) {
    const minSide =
      typeof hints.screenMinCssPx === 'number' && hints.screenMinCssPx > 0
        ? hints.screenMinCssPx
        : 430
    return minSide >= 744 ? 'ipad' : 'iphone'
  }

  if (/Android/i.test(ua)) {
    return /Mobile/i.test(ua) ? 'android-phone' : 'android-tablet'
  }

  if (/CrOS/i.test(ua)) return 'chromebook'
  if (/Windows NT/i.test(ua)) return 'windows-pc'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac'
  if (/Linux/i.test(ua)) return 'linux-pc'
  return 'unknown'
}

/**
 * @param {DeviceClass} deviceClass
 * @param {string} ua
 * @returns {string}
 */
function osLabelForClass(deviceClass, ua) {
  const iosVer = parseIosVersion(ua)
  switch (deviceClass) {
    case 'iphone':
    case 'ipod':
      return iosVer ? `iOS ${iosVer}` : 'iOS'
    case 'ipad':
      return iosVer ? `iPadOS ${iosVer}` : 'iPadOS'
    case 'android-phone':
    case 'android-tablet': {
      const av = parseAndroidVersion(ua)
      return av ? `Android ${av}` : 'Android'
    }
    case 'windows-pc': {
      const wv = parseWindowsVersion(ua)
      return wv ? `Windows ${wv}` : 'Windows'
    }
    case 'mac': {
      const mv = parseMacOsVersion(ua)
      return mv ? `macOS ${mv}` : 'macOS'
    }
    case 'chromebook':
      return 'ChromeOS'
    case 'linux-pc':
      return 'Linux'
    default:
      return 'Unknown OS'
  }
}

/**
 * @param {string} ua
 * @returns {string}
 */
export function detectBrowser(ua) {
  if (/EdgiOS\//i.test(ua)) return 'Edge'
  if (/CriOS\//i.test(ua)) return 'Chrome'
  if (/FxiOS\//i.test(ua)) return 'Firefox'
  if (/OPiOS\//i.test(ua) || /OPR\/.*Mobile/i.test(ua)) return 'Opera'
  if (/DuckDuckGo\//i.test(ua)) return 'DuckDuckGo'
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Internet'
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera'
  if (/Chrome\//i.test(ua) && !/Edg|Chromium/i.test(ua)) return 'Chrome'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/Safari/i.test(ua)) return 'Safari'
  return 'Browser'
}

/**
 * @param {DeviceClass} deviceClass
 * @returns {'mobile' | 'desktop' | 'tablet'}
 */
export function formFactorForDeviceClass(deviceClass) {
  if (deviceClass === 'iphone' || deviceClass === 'ipod' || deviceClass === 'android-phone') {
    return 'mobile'
  }
  if (deviceClass === 'ipad' || deviceClass === 'android-tablet') return 'tablet'
  return 'desktop'
}

/**
 * @param {string} ua
 * @param {DeviceEnvHints} [hints]
 * @returns {'mobile' | 'desktop' | 'tablet'}
 */
export function detectFormFactor(ua = '', hints = {}) {
  const deviceClass = detectDeviceClass(ua, hints)
  return formFactorForDeviceClass(deviceClass)
}

/**
 * @param {string} ua
 * @param {DeviceEnvHints} [hints]
 * @returns {string}
 */
export function detectOs(ua, hints = {}) {
  const deviceClass = detectDeviceClass(ua, hints)
  return osLabelForClass(deviceClass, ua)
}

/**
 * @param {DeviceClass} deviceClass
 * @returns {string}
 */
export function formatDeviceClassLabel(deviceClass) {
  switch (deviceClass) {
    case 'iphone':
      return 'iPhone'
    case 'ipad':
      return 'iPad'
    case 'ipod':
      return 'iPod'
    case 'android-phone':
      return 'Android phone'
    case 'android-tablet':
      return 'Android tablet'
    case 'windows-pc':
      return 'Windows PC'
    case 'mac':
      return 'Mac'
    case 'chromebook':
      return 'Chromebook'
    case 'linux-pc':
      return 'Linux PC'
    default:
      return 'Unknown device'
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

/**
 * @param {string} browser
 * @param {DeviceClass} deviceClass
 * @param {string} os
 * @returns {string}
 */
export function formatDeviceDefaultName(browser, deviceClass, os) {
  const dev = formatDeviceClassLabel(deviceClass)
  if (deviceClass === 'iphone' || deviceClass === 'ipad' || deviceClass === 'ipod') {
    return `${browser} on ${dev}`.slice(0, 80)
  }
  if (deviceClass === 'android-phone' || deviceClass === 'android-tablet') {
    return `${browser} on ${dev}`.slice(0, 80)
  }
  return `${browser} on ${os || dev}`.slice(0, 80)
}

/**
 * @param {string} ua
 * @param {DeviceEnvHints} [hints]
 */
export function parseDeviceFromUserAgent(ua, hints = {}) {
  const deviceClass = detectDeviceClass(ua, hints)
  const os = osLabelForClass(deviceClass, ua)
  const browser = detectBrowser(ua)
  const formFactor = formFactorForDeviceClass(deviceClass)
  const defaultName = formatDeviceDefaultName(browser, deviceClass, os)
  return {
    deviceClass,
    os,
    browser,
    formFactor,
    defaultName,
  }
}

/**
 * @returns {DeviceEnvHints}
 */
export function readDeviceEnvHints() {
  if (typeof navigator === 'undefined') return {}
  /** @type {DeviceEnvHints} */
  const hints = {
    maxTouchPoints:
      typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0,
    platform: typeof navigator.platform === 'string' ? navigator.platform : '',
  }
  const uad = /** @type {{ mobile?: boolean } | undefined} */ (navigator.userAgentData)
  if (uad && typeof uad.mobile === 'boolean') {
    hints.uaMobile = uad.mobile
  }
  if (typeof window !== 'undefined' && window.screen) {
    const w = window.screen.width || 0
    const h = window.screen.height || 0
    if (w > 0 && h > 0) {
      hints.screenMinCssPx = Math.min(w, h)
      hints.screenMaxCssPx = Math.max(w, h)
    }
  }
  return hints
}

/**
 * @returns {{
 *   deviceId: string,
 *   name: string,
 *   os: string,
 *   deviceClass: DeviceClass,
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
  const hints = readDeviceEnvHints()
  const parsed = parseDeviceFromUserAgent(ua, hints)
  const savedName = getLocalDeviceName()
  return {
    deviceId: getOrCreateDeviceId(),
    name: savedName || parsed.defaultName,
    os: parsed.os,
    deviceClass: parsed.deviceClass,
    formFactor: parsed.formFactor,
    browser: parsed.browser,
    userAgent: ua.slice(0, 512),
  }
}

/**
 * Prefer deviceClass label when available; fall back to form factor.
 * @param {{ deviceClass?: string, formFactor?: string }} device
 */
export function formatDeviceTypeLabel(device) {
  const cls = String(device?.deviceClass ?? '').trim()
  if (cls) return formatDeviceClassLabel(/** @type {DeviceClass} */ (cls))
  return formatFormFactorLabel(device?.formFactor)
}
