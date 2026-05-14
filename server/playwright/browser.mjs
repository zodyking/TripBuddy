import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { USER_DATA_DIR } from '../config.mjs'
import { emitLog } from '../log-bus.mjs'

/** @type {import('playwright').BrowserContext | null} */
let context = null
/** @type {string | null} */
let activeLaunchKey = null
/** @type {{ latitude: number, longitude: number, accuracy?: number } | null} */
let activeGeolocation = null

export function getContext() {
  return context
}

function launchKey(options) {
  const { headless = true, slowMo = 0, geolocation } = options
  const geoKey = geolocation
    ? `${geolocation.latitude},${geolocation.longitude}`
    : null
  return JSON.stringify({ headless: !!headless, slowMo: Number(slowMo) || 0, geo: geoKey })
}

export async function ensureContext(options = {}) {
  const {
    headless = true,
    slowMo = 0,
    geolocation = null,
  } = options

  const key = launchKey(options)
  if (context && activeLaunchKey === key) {
    return context
  }

  if (context) {
    await closeContext()
  }

  fs.mkdirSync(USER_DATA_DIR, { recursive: true })

  const geoLogPart = geolocation
    ? `, geolocation=${geolocation.latitude.toFixed(4)},${geolocation.longitude.toFixed(4)}`
    : ''
  emitLog('browser', `Launching persistent context (headless=${headless}${geoLogPart})`)

  const channel = process.env.PLAYWRIGHT_CHANNEL
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    slowMo: slowMo || undefined,
    ...(channel ? { channel } : {}),
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
    permissions: geolocation ? ['geolocation'] : [],
    geolocation: geolocation || undefined,
  })

  activeLaunchKey = key
  activeGeolocation = geolocation || null

  context.on('close', () => {
    context = null
    activeLaunchKey = null
    activeGeolocation = null
    emitLog('browser', 'Context closed')
  })

  return context
}

/**
 * Update geolocation on the current context (if running).
 * @param {{ latitude: number, longitude: number, accuracy?: number } | null} geo
 */
export async function setContextGeolocation(geo) {
  if (!context) return
  if (geo) {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({
      latitude: geo.latitude,
      longitude: geo.longitude,
      accuracy: geo.accuracy ?? 10,
    })
    activeGeolocation = geo
    emitLog('browser', `Geolocation set: ${geo.latitude.toFixed(4)},${geo.longitude.toFixed(4)}`)
  } else {
    await context.clearPermissions()
    activeGeolocation = null
    emitLog('browser', 'Geolocation cleared')
  }
}

/**
 * Get current active geolocation, if any.
 */
export function getActiveGeolocation() {
  return activeGeolocation
}

export async function closeContext() {
  if (context) {
    await context.close().catch(() => {})
    context = null
    activeLaunchKey = null
    activeGeolocation = null
  }
}

export async function getOrCreatePage() {
  if (!context) {
    throw new Error('Browser context not started; call ensureContext first')
  }
  const pages = context.pages()
  if (pages.length > 0) return pages[0]
  return context.newPage()
}
