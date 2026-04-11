import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { USER_DATA_DIR } from '../config.mjs'
import { emitLog } from '../log-bus.mjs'

/** @type {import('playwright').BrowserContext | null} */
let context = null
/** @type {string | null} */
let activeLaunchKey = null

export function getContext() {
  return context
}

function launchKey(options) {
  const { headless = true, slowMo = 0 } = options
  return JSON.stringify({ headless: !!headless, slowMo: Number(slowMo) || 0 })
}

export async function ensureContext(options = {}) {
  const {
    headless = true,
    slowMo = 0,
  } = options

  const key = launchKey(options)
  if (context && activeLaunchKey === key) {
    return context
  }

  if (context) {
    await closeContext()
  }

  fs.mkdirSync(USER_DATA_DIR, { recursive: true })

  emitLog('browser', `Launching persistent context (headless=${headless})`)

  const channel = process.env.PLAYWRIGHT_CHANNEL
  context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    slowMo: slowMo || undefined,
    ...(channel ? { channel } : {}),
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  })

  activeLaunchKey = key

  context.on('close', () => {
    context = null
    activeLaunchKey = null
    emitLog('browser', 'Context closed')
  })

  return context
}

export async function closeContext() {
  if (context) {
    await context.close().catch(() => {})
    context = null
    activeLaunchKey = null
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
