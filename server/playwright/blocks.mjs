import { DISPATCH_ENTRY_URL } from '../config.mjs'
import { emitLog } from '../log-bus.mjs'
import { ensureContext, getOrCreatePage, closeContext } from './browser.mjs'
import {
  clickMenuIfEnabled,
  menuHumanName,
  inspectCheckoutHomeGate,
} from './pages/dispatchHome.mjs'
import { ensureDispatchAppReady } from './dispatchAuthGate.mjs'
import { getUsername, getDecryptedPassword, getTractorNumber } from '../credentials-store.mjs'
import { readAssignment, writeAssignment } from '../assignment-store.mjs'
import {
  getResolvedCheckInXpaths,
  CHECKIN_LOC_VISIBLE_MS,
  CHECKIN_LOC_VISIBLE_SHORT_MS,
} from './checkInFlow.mjs'
import { runCheckInEndToEnd } from './checkInOrchestration.mjs'
import { runArriveEndToEnd } from './arriveOrchestration.mjs'
import { normalizePhoneForFill, clickSignOutModalConfirm } from './postCheckInFlow.mjs'
import {
  startPreviewCapture,
  stopPreviewCapture,
  setBlockAutomationBusy,
} from './runner.mjs'
import { runInspectCheckoutAfterGate } from './inspectCheckoutOrchestration.mjs'

let runAbort = null
let runnerBusy = false
let currentRunId = null
let currentPage = null

/** Pending location retry resolver (like runner.mjs but for block runs) */
let pendingBlockRetry = null
/** Pending Inspect & Check Out field (dolly / seal / trailer) from dashboard */
let pendingBlockInspectField = null
const BLOCK_RETRY_WAIT_MS = 5 * 60 * 1000

/** FedEx Linehaul banner when saved dispatch location does not match driver location */
const DRIVER_LOCATION_MISMATCH_SNIPPET =
  'Driver ID is currently not located where the tractor is trying to dispatch from'

function normalizeFedexBannerTextForMatch(text) {
  let s = String(text).normalize('NFKC')
  s = s.replace(/[\u2018\u2019\u201c\u201d]/g, "'")
  s = s.replace(/\u00a0/g, ' ')
  s = s.replace(/\s+/g, ' ')
  return s.trim().toLowerCase()
}

function bannerIndicatesLocationMismatch(text) {
  const n = normalizeFedexBannerTextForMatch(text)
  const snippet = normalizeFedexBannerTextForMatch(DRIVER_LOCATION_MISMATCH_SNIPPET)
  if (n.includes(snippet)) return true
  if (n.includes('linehaul office') && n.includes('not located')) return true
  return false
}

/** Post-check-in tail — keep in sync with [`postCheckInFlow.mjs`](./postCheckInFlow.mjs). */
const DIALOG_MS = 2_000
const ACTION_MS = 2_000
const TOOLBAR_MS = 5_000

const T = {
  phoneModalWait: DIALOG_MS,
  phoneFill: ACTION_MS,
  phoneSend: ACTION_MS,
}

/** Action types that should NOT trigger a step screenshot (control flow / no visual change) */
const SKIP_SCREENSHOT_TYPES = new Set([
  'delay',
  'stop',
  'if',
  'choose',
  'repeat',
  'parallel',
  'runAutomation',
  'checkInEndToEnd',
  'arriveEndToEnd',
  'inspectCheckoutHomeGate',
  'inspectCheckoutContinue',
])

/**
 * Capture a JPEG screenshot and emit it to SSE log stream.
 * @param {import('playwright').Page} page
 * @param {{ runId: string }} ctx
 * @param {string} stepName
 */
async function captureStepScreenshot(page, ctx, stepName) {
  try {
    if (page.isClosed()) return
    const buf = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false })
    emitLog('screenshot', stepName, {
      runId: ctx.runId,
      image: buf.toString('base64'),
      ts: Date.now(),
    })
  } catch {
    /* page closed or navigation in progress */
  }
}

export function isBlockRunnerBusy() {
  return runnerBusy
}

export function cancelBlockRun() {
  runAbort?.abort()
  rejectPendingBlockRetryIfAny(new Error('Block run cancelled'))
  rejectPendingBlockInspectFieldIfAny(new Error('Block run cancelled'))
}

export function getBlockRunId() {
  return currentRunId
}

export function getBlockPage() {
  return currentPage
}

function waitForBlockRetryLocation(runId, signal) {
  return new Promise((resolve, reject) => {
    if (pendingBlockRetry) {
      try {
        pendingBlockRetry.reject(new Error('Superseded'))
      } catch { /* ignore */ }
      pendingBlockRetry = null
    }
    let state = null
    const cleanup = () => {
      if (state?.timeoutId) clearTimeout(state.timeoutId)
      signal?.removeEventListener('abort', onAbort)
      if (pendingBlockRetry === state) pendingBlockRetry = null
    }
    const onAbort = () => {
      if (!state) return
      cleanup()
      reject(new Error('Aborted'))
    }
    state = {
      runId,
      timeoutId: setTimeout(() => {
        if (pendingBlockRetry !== state) return
        cleanup()
        reject(new Error('Block retry location timed out'))
      }, BLOCK_RETRY_WAIT_MS),
      resolve: (loc) => {
        cleanup()
        resolve(loc)
      },
      reject: (e) => {
        cleanup()
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingBlockRetry = state
  })
}

export function submitBlockRetryLocation(runId, location) {
  const loc = String(location || '').trim()
  if (!loc) return { ok: false, error: 'location required' }
  if (!pendingBlockRetry || pendingBlockRetry.runId !== runId) {
    return { ok: false, error: 'No pending block retry for this run' }
  }
  pendingBlockRetry.resolve(loc)
  return { ok: true }
}

export function cancelBlockRetry(runId) {
  if (!pendingBlockRetry || pendingBlockRetry.runId !== runId) {
    return { ok: false, error: 'No pending block retry' }
  }
  pendingBlockRetry.reject(new Error('Block retry cancelled'))
  return { ok: true }
}

function rejectPendingBlockRetryIfAny(reason) {
  if (!pendingBlockRetry) return
  try {
    pendingBlockRetry.reject(reason instanceof Error ? reason : new Error(String(reason)))
  } catch { /* ignore */ }
  pendingBlockRetry = null
}

export function hasPendingBlockRetry() {
  return pendingBlockRetry !== null
}

function waitForBlockInspectField(runId, signal) {
  return new Promise((resolve, reject) => {
    if (pendingBlockInspectField) {
      try {
        pendingBlockInspectField.reject(new Error('Superseded'))
      } catch { /* ignore */ }
      pendingBlockInspectField = null
    }
    let state = null
    const cleanup = () => {
      if (state?.timeoutId) clearTimeout(state.timeoutId)
      signal?.removeEventListener('abort', onAbort)
      if (pendingBlockInspectField === state) pendingBlockInspectField = null
    }
    const onAbort = () => {
      if (!state) return
      cleanup()
      reject(new Error('Aborted'))
    }
    state = {
      runId,
      timeoutId: setTimeout(() => {
        if (pendingBlockInspectField !== state) return
        cleanup()
        reject(new Error('Inspect field input timed out'))
      }, BLOCK_RETRY_WAIT_MS),
      resolve: (v) => {
        cleanup()
        resolve(v)
      },
      reject: (e) => {
        cleanup()
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pendingBlockInspectField = state
  })
}

/**
 * @param {string} runId
 * @param {string} value
 */
export function submitBlockInspectField(runId, value) {
  const v = String(value ?? '').trim()
  if (!v) return { ok: false, error: 'value required' }
  if (!pendingBlockInspectField || pendingBlockInspectField.runId !== runId) {
    return { ok: false, error: 'No pending inspect field input for this run' }
  }
  pendingBlockInspectField.resolve(v)
  return { ok: true }
}

/**
 * @param {string} runId
 */
export function cancelBlockInspectField(runId) {
  if (!pendingBlockInspectField || pendingBlockInspectField.runId !== runId) {
    return { ok: false, error: 'No pending inspect field input' }
  }
  pendingBlockInspectField.reject(new Error('Inspect field input cancelled'))
  return { ok: true }
}

function rejectPendingBlockInspectFieldIfAny(reason) {
  if (!pendingBlockInspectField) return
  try {
    pendingBlockInspectField.reject(reason instanceof Error ? reason : new Error(String(reason)))
  } catch { /* ignore */ }
  pendingBlockInspectField = null
}

function makeLog(runId) {
  return (type, message, extra = {}) => {
    emitLog(type, message, { runId, ...extra })
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function resolveSelector(selector) {
  if (!selector) return null
  if (selector.startsWith('xpath=') || selector.startsWith('//')) {
    return selector.startsWith('//') ? `xpath=${selector}` : selector
  }
  if (selector.startsWith('text=') || selector.startsWith('"')) {
    return selector
  }
  return selector
}

async function resolveValue(value, ctx) {
  if (!value || typeof value !== 'string') return value
  return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    const parts = path.split('.')
    let obj = ctx.variables
    if (parts[0] === 'credentials') {
      if (parts[1] === 'username') return ctx.credentials?.username || ''
      if (parts[1] === 'password') return ctx.credentials?.password || ''
      if (parts[1] === 'tractor') return ctx.credentials?.tractor || ''
      return ''
    }
    if (parts[0] === 'assignment') {
      if (parts[1] === 'tractorLocation') return ctx.assignment?.tractorLocation || ''
      if (parts[1] === 'driverPhone') return ctx.assignment?.driverPhone || ''
      return ''
    }
    for (const p of parts) {
      if (obj && typeof obj === 'object') obj = obj[p]
      else return match
    }
    return obj !== undefined ? String(obj) : match
  })
}

async function evaluateCondition(condition, page, ctx) {
  const { type } = condition
  switch (type) {
    case 'elementVisible': {
      const sel = resolveSelector(condition.selector)
      if (!sel) return false
      try {
        const loc = page.locator(sel).first()
        await loc.waitFor({ state: 'visible', timeout: condition.timeout || 5000 })
        return true
      } catch {
        return false
      }
    }
    case 'elementHidden': {
      const sel = resolveSelector(condition.selector)
      if (!sel) return true
      try {
        const loc = page.locator(sel).first()
        await loc.waitFor({ state: 'hidden', timeout: condition.timeout || 5000 })
        return true
      } catch {
        return false
      }
    }
    case 'urlMatches': {
      const url = page.url()
      const pattern = condition.pattern
      if (!pattern) return false
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        const regex = new RegExp(pattern.slice(1, -1))
        return regex.test(url)
      }
      return url.includes(pattern)
    }
    case 'variableEquals': {
      const varValue = ctx.variables[condition.variable]
      return String(varValue) === String(condition.value)
    }
    default:
      return false
  }
}

async function executeAction(action, page, ctx) {
  const { log, signal } = ctx
  if (signal?.aborted) throw new Error('Aborted')

  const { type } = action
  log('detail', `Executing: ${type}`, { actionId: action.id })

  switch (type) {
    case 'goto': {
      const url = action.url === 'dispatch_entry' ? DISPATCH_ENTRY_URL : await resolveValue(action.url, ctx)
      await page.goto(url, {
        waitUntil: action.waitUntil || 'domcontentloaded',
        timeout: 120_000,
      })
      log('info', `Navigated to ${url}`)
      break
    }

    case 'goBack': {
      await page.goBack()
      log('info', 'Navigated back')
      break
    }

    case 'goForward': {
      await page.goForward()
      log('info', 'Navigated forward')
      break
    }

    case 'reload': {
      await page.reload({ waitUntil: action.waitUntil || 'domcontentloaded' })
      log('info', 'Page reloaded')
      break
    }

    case 'delay': {
      const ms = Number(action.ms) || 1000
      log('detail', `Waiting ${ms}ms`)
      await sleep(ms, signal)
      break
    }

    case 'waitForLoadState': {
      const state = action.state || 'domcontentloaded'
      await page.waitForLoadState(state, { timeout: action.timeout || 30000 })
      log('info', `Page reached ${state}`)
      break
    }

    case 'waitForSelector': {
      const sel = resolveSelector(action.selector)
      const state = action.state || 'visible'
      await page.locator(sel).first().waitFor({ state, timeout: action.timeout || 30000 })
      log('info', `Element ${state}: ${action.selector}`)
      break
    }

    case 'waitForUrl': {
      const pattern = action.url
      await page.waitForURL(pattern, { timeout: action.timeout || 30000 })
      log('info', `URL matched: ${pattern}`)
      break
    }

    case 'click': {
      const sel = resolveSelector(action.selector)
      const loc = page.locator(sel).first()
      await loc.click({
        button: action.button || 'left',
        clickCount: action.clickCount || 1,
        timeout: action.timeout || 30000,
      })
      log('info', `Clicked: ${action.selector}`)
      break
    }

    case 'fill': {
      const sel = resolveSelector(action.selector)
      const value = await resolveValue(action.value, ctx)
      await page.locator(sel).first().fill(value, { timeout: action.timeout || 30000 })
      log('info', `Filled: ${action.selector}`)
      break
    }

    case 'clear': {
      const sel = resolveSelector(action.selector)
      await page.locator(sel).first().clear()
      log('info', `Cleared: ${action.selector}`)
      break
    }

    case 'check': {
      const sel = resolveSelector(action.selector)
      await page.locator(sel).first().check()
      log('info', `Checked: ${action.selector}`)
      break
    }

    case 'uncheck': {
      const sel = resolveSelector(action.selector)
      await page.locator(sel).first().uncheck()
      log('info', `Unchecked: ${action.selector}`)
      break
    }

    case 'selectOption': {
      const sel = resolveSelector(action.selector)
      const value = await resolveValue(action.value, ctx)
      await page.locator(sel).first().selectOption(value)
      log('info', `Selected option: ${value}`)
      break
    }

    case 'hover': {
      const sel = resolveSelector(action.selector)
      await page.locator(sel).first().hover()
      log('info', `Hovered: ${action.selector}`)
      break
    }

    case 'focus': {
      const sel = resolveSelector(action.selector)
      await page.locator(sel).first().focus()
      log('info', `Focused: ${action.selector}`)
      break
    }

    case 'press': {
      const key = action.key
      if (action.selector) {
        const sel = resolveSelector(action.selector)
        await page.locator(sel).first().press(key)
      } else {
        await page.keyboard.press(key)
      }
      log('info', `Pressed: ${key}`)
      break
    }

    case 'screenshot': {
      const name = action.name || `screenshot-${Date.now()}`
      const buf = await page.screenshot({
        fullPage: action.fullPage || false,
        type: 'png',
      })
      ctx.screenshots = ctx.screenshots || []
      ctx.screenshots.push({ name, data: buf.toString('base64'), ts: Date.now() })
      log('info', `Screenshot: ${name}`)
      break
    }

    case 'getText': {
      const sel = resolveSelector(action.selector)
      const text = await page.locator(sel).first().innerText()
      if (action.variable) {
        ctx.variables[action.variable] = text
      }
      log('info', `Got text from ${action.selector}: "${text.slice(0, 50)}..."`)
      break
    }

    case 'getAttribute': {
      const sel = resolveSelector(action.selector)
      const attr = await page.locator(sel).first().getAttribute(action.attribute)
      if (action.variable) {
        ctx.variables[action.variable] = attr || ''
      }
      log('info', `Got attribute ${action.attribute}: "${attr}"`)
      break
    }

    case 'evaluate': {
      const result = await page.evaluate(action.script)
      if (action.variable) {
        ctx.variables[action.variable] = result
      }
      log('info', `Evaluated script, result: ${JSON.stringify(result).slice(0, 100)}`)
      break
    }

    case 'if': {
      const condition = {
        type: action.conditionType,
        selector: action.selector,
        pattern: action.pattern,
        variable: action.variable,
        value: action.value,
        timeout: action.timeout,
      }
      const result = await evaluateCondition(condition, page, ctx)
      log('detail', `If condition "${action.conditionType}": ${result}`)
      const branch = result ? action.children?.then : action.children?.else
      if (Array.isArray(branch)) {
        for (const childAction of branch) {
          await executeAction(childAction, page, ctx)
        }
      }
      break
    }

    case 'choose': {
      const options = action.children?.options || []
      let matched = false
      for (const opt of options) {
        if (opt.condition) {
          const result = await evaluateCondition(opt.condition, page, ctx)
          if (result) {
            matched = true
            for (const childAction of opt.actions || []) {
              await executeAction(childAction, page, ctx)
            }
            break
          }
        }
      }
      if (!matched && action.children?.default) {
        for (const childAction of action.children.default) {
          await executeAction(childAction, page, ctx)
        }
      }
      break
    }

    case 'repeat': {
      const mode = action.mode || 'count'
      const sequence = action.children?.sequence || []

      if (mode === 'count') {
        const count = action.count || 1
        for (let i = 0; i < count; i++) {
          if (signal?.aborted) throw new Error('Aborted')
          log('detail', `Repeat iteration ${i + 1}/${count}`)
          for (const childAction of sequence) {
            await executeAction(childAction, page, ctx)
          }
        }
      } else if (mode === 'while' || mode === 'until') {
        const condition = {
          type: action.conditionType,
          selector: action.selector,
          variable: action.variable,
          value: action.value,
        }
        let iterCount = 0
        const maxIter = 100
        while (iterCount < maxIter) {
          if (signal?.aborted) throw new Error('Aborted')
          const result = await evaluateCondition(condition, page, ctx)
          const shouldContinue = mode === 'while' ? result : !result
          if (!shouldContinue) break
          log('detail', `Repeat iteration ${iterCount + 1}`)
          for (const childAction of sequence) {
            await executeAction(childAction, page, ctx)
          }
          iterCount++
        }
      }
      break
    }

    case 'parallel': {
      const branches = action.children?.branches || []
      await Promise.all(
        branches.map(async (branch) => {
          for (const childAction of branch) {
            await executeAction(childAction, page, ctx)
          }
        })
      )
      log('info', `Parallel branches completed: ${branches.length}`)
      break
    }

    case 'stop': {
      log('info', `Stopping: ${action.reason || 'Manual stop'}`)
      throw new Error(`STOP: ${action.reason || 'Automation stopped'}`)
    }

    case 'runAutomation': {
      log('info', `Would run automation: ${action.automationId} (nested calls not yet supported)`)
      break
    }

    case 'ensureSignedIn': {
      await ensureDispatchAppReady(page, {
        tryOktaLogin: true,
        log,
        signal,
      })
      log('info', 'Ensured signed in')
      break
    }

    case 'inspectCheckoutHomeGate': {
      if (signal?.aborted) throw new Error('Aborted')
      const gate = await inspectCheckoutHomeGate(page, log)
      if (gate.outcome === 'opened') break
      if (gate.outcome === 'no_trip') {
        ctx.variables._inspectCheckoutCancelled = true
        log('info', 'No trip to inspect', { inspectCheckoutCancelled: true })
        throw new Error('STOP: No trip to inspect')
      }
      throw new Error(
        `Inspect/checkout gate: cannot continue (${gate.reason}${
          gate.checkInEnabled !== undefined
            ? ` — Check In enabled=${gate.checkInEnabled}, Inspect enabled=${gate.inspectEnabled}`
            : ''
        })`,
      )
    }

    case 'inspectCheckoutContinue': {
      if (signal?.aborted) throw new Error('Aborted')
      if (!ctx.runId) throw new Error('inspectCheckoutContinue requires runId')
      const waitForInspectField = async ({ field, message }) => {
        log('info', message, {
          inspectFieldRetryNeeded: true,
          runId: ctx.runId,
          field,
          message,
        })
        return waitForBlockInspectField(ctx.runId, signal)
      }
      const outcome = await runInspectCheckoutAfterGate(page, {
        log,
        signal,
        runId: ctx.runId,
        assignment: ctx.assignment,
        tripData: ctx.tripData || {},
        waitForInspectField,
      })
      ctx.variables._inspectCheckoutContinue = outcome
      log('info', 'Inspect & Check Out post-gate finished', { inspectCheckoutContinue: outcome })
      break
    }

    case 'openMenu': {
      const menuKey = action.menuKey
      const opened = await clickMenuIfEnabled(page, menuKey, log)
      if (!opened && action.optional !== true) {
        throw new Error(
          `${menuHumanName(menuKey)} is not on screen or not available — cannot continue`,
        )
      }
      break
    }

    case 'checkInEndToEnd': {
      if (signal?.aborted) throw new Error('Aborted')
      const payload = await runCheckInEndToEnd(page, {
        log,
        signal,
        tryOktaLogin: action.tryOktaLogin !== false,
        runId: ctx.runId,
        waitForLocationRetry: waitForBlockRetryLocation,
      })
      ctx.variables._checkInPayload = payload
      break
    }

    case 'arriveEndToEnd': {
      if (signal?.aborted) throw new Error('Aborted')
      const arrivePayload = await runArriveEndToEnd(page, {
        log,
        signal,
        tryOktaLogin: action.tryOktaLogin !== false,
      })
      ctx.variables._arrivePayload = arrivePayload
      break
    }

    case 'fillCheckInForm': {
      const CX = await getResolvedCheckInXpaths()
      let tractor = ''
      let location = ''

      if (action.tractorSource === 'settings') {
        tractor = ctx.credentials?.tractor || ''
      } else if (action.tractorSource === 'variable') {
        tractor = ctx.variables[action.tractorValue] || ''
      } else {
        tractor = action.tractorValue || ''
      }

      if (action.locationSource === 'settings') {
        location = ctx.assignment?.tractorLocation || ''
      } else if (action.locationSource === 'variable') {
        location = ctx.variables[action.locationValue] || ''
      } else {
        location = action.locationValue || ''
      }

      const tractorEl = page.locator(`xpath=${CX.tractorInput}`)
      const locationEl = page.locator(`xpath=${CX.locationInput}`)
      await tractorEl.waitFor({ state: 'visible', timeout: CHECKIN_LOC_VISIBLE_MS })
      await locationEl.waitFor({ state: 'visible', timeout: CHECKIN_LOC_VISIBLE_SHORT_MS })
      await tractorEl.fill(tractor)
      await locationEl.fill(location)
      log('info', `Filled check-in form: tractor=${tractor}, location=${location}`)
      break
    }

    case 'handleBanner': {
      const CX = await getResolvedCheckInXpaths()
      const banner = page.locator(`xpath=${CX.banner}`)
      const timeout = action.timeout || 11000
      const pollUntil = Date.now() + timeout
      const BANNER_TEXT_MIN_LEN = 20

      async function readSubmitBannerOutcome() {
        const visible = await banner.isVisible().catch(() => false)
        if (visible) {
          const text = (await banner.innerText().catch(() => '')).trim()
          return {
            bannerText: text || '(banner with no text)',
            locationMismatch: bannerIndicatesLocationMismatch(text),
          }
        }
        const count = await banner.count().catch(() => 0)
        if (count === 0) return null
        const raw = await banner.first().evaluate((el) => el?.textContent || '').catch(() => '')
        const text = String(raw).replace(/\s+/g, ' ').trim()
        if (text.length >= BANNER_TEXT_MIN_LEN || bannerIndicatesLocationMismatch(text)) {
          return {
            bannerText: text,
            locationMismatch: bannerIndicatesLocationMismatch(text),
          }
        }
        return null
      }

      await sleep(50, signal)
      let outcome = null
      while (Date.now() < pollUntil) {
        if (signal?.aborted) throw new Error('Aborted')
        outcome = await readSubmitBannerOutcome()
        if (outcome) break
        await sleep(80, signal)
      }

      if (outcome) {
        ctx.variables._bannerText = outcome.bannerText
        ctx.variables._bannerMismatch = outcome.locationMismatch
        ctx.variables._bannerDetected = true

        log('warn', 'FedEx reported a message after submit', {
          checkInBanner: true,
          bannerText: outcome.bannerText,
          locationMismatch: outcome.locationMismatch,
          ...(ctx.runId ? { locationRetryNeeded: outcome.locationMismatch, runId: ctx.runId } : {}),
        })

        if (outcome.locationMismatch) {
          if (action.onMismatch === 'stop') {
            throw new Error(`Location mismatch: ${outcome.bannerText}`)
          } else if (action.onMismatch === 'retry') {
            log('info', 'Waiting for location retry from UI...')
            const newLoc = await waitForBlockRetryLocation(ctx.runId, signal)
            const locationEl = page.locator(`xpath=${CX.locationInput}`)
            await locationEl.waitFor({
              state: 'visible',
              timeout: CHECKIN_LOC_VISIBLE_SHORT_MS,
            })
            await locationEl.fill(newLoc)
            log('info', `Retrying with new location: ${newLoc}`)
            await page.locator(`xpath=${CX.submit}`).click()
            log('info', 'Submitted retry')
          }
        }
      } else {
        ctx.variables._bannerDetected = false
        log('info', 'Check-in finished (no banner)')
      }
      break
    }

    case 'fillPhoneModal': {
      let phone = ''
      if (action.phoneSource === 'settings') {
        phone = ctx.assignment?.driverPhone || ''
      } else if (action.phoneSource === 'variable') {
        phone = ctx.variables[action.phoneValue] || ''
      } else {
        phone = action.phoneValue || ''
      }

      const digits = normalizePhoneForFill(phone)
      if (!digits) throw new Error('Driver phone is empty')

      const CX = await getResolvedCheckInXpaths()
      const modal = page.locator('app-not-scheduled-phone-number-modal')
      await modal.waitFor({ state: 'visible', timeout: T.phoneModalWait })

      const inpInModal = modal.locator('input').first()
      const inpTyped = modal.locator('input[type="tel"], input[type="text"]').first()
      const inpBySettings = page.locator(`xpath=${CX.phoneModalInput}`)

      if (signal?.aborted) throw new Error('Aborted')

      try {
        await inpInModal.fill(digits, { force: true, timeout: T.phoneFill })
      } catch {
        try {
          await inpTyped.fill(digits, { force: true, timeout: T.phoneFill })
        } catch {
          await inpBySettings.fill(digits, { force: true, timeout: T.phoneFill })
        }
      }
      log('info', `Filled phone: ${digits}`)

      if (signal?.aborted) throw new Error('Aborted')

      const sendByRole = modal.getByRole('button', { name: /send/i })
      const sendBtn = page.locator(`xpath=${CX.phoneModalSend}`)

      try {
        await sendByRole.click({ force: true, timeout: T.phoneSend })
      } catch {
        await sendBtn.click({ force: true, timeout: T.phoneSend })
      }
      log('info', 'Sent phone number')
      break
    }

    case 'contactLinehaulConfirm': {
      if (signal?.aborted) throw new Error('Aborted')
      log('info', 'Contact Linehaul confirm')
      const dlg = page
        .locator('mat-dialog-container')
        .filter({
          hasText: /Contact Linehaul|Is this information correct|No Approved Trip/i,
        })
        .last()
      const confirmBtn = dlg.getByRole('button', { name: /^confirm$/i })
      await confirmBtn.click({ force: true, timeout: ACTION_MS })
      log('info', 'Confirmed Contact Linehaul')
      break
    }

    case 'assistanceConfirm': {
      if (signal?.aborted) throw new Error('Aborted')
      log('info', 'Checking for assistance modal')
      const CX = await getResolvedCheckInXpaths()
      const assistByRole = page
        .locator('app-assistance-confirmation-modal')
        .getByRole('button', { name: /confirm|continue|ok/i })
        .first()
      const assistBtn = page.locator(`xpath=${CX.assistanceConfirmButton}`)
      try {
        await assistByRole.click({ force: true, timeout: ACTION_MS })
        log('info', 'Confirmed assistance')
      } catch {
        try {
          await assistBtn.click({ force: true, timeout: ACTION_MS })
          log('info', 'Confirmed assistance')
        } catch {
          log('info', 'No assistance modal — continuing')
        }
      }
      break
    }

    case 'signOut': {
      if (signal?.aborted) throw new Error('Aborted')
      const CX = await getResolvedCheckInXpaths()
      const signOutToolbar = page.locator(`xpath=${CX.toolbarSignOut}`)
      await signOutToolbar.click({ force: true, timeout: TOOLBAR_MS })
      log('info', 'Opened sign out')

      if (signal?.aborted) throw new Error('Aborted')

      await clickSignOutModalConfirm(page, CX, signal)
      log('info', 'Signed out', { checkInComplete: true })
      break
    }

    default:
      log('warn', `Unknown action type: ${type}`)
  }

  if (!SKIP_SCREENSHOT_TYPES.has(type)) {
    await captureStepScreenshot(page, ctx, `step_${type}`)
  }
}

export async function runAutomation(automation, opts = {}) {
  const runId = `auto-${Date.now()}`
  const log = makeLog(runId)
  runAbort = new AbortController()
  const signal = runAbort.signal

  const { headless = true, slowMo = 0, tripData = {} } = opts

  runnerBusy = true
  setBlockAutomationBusy(true)
  currentRunId = runId

  const ctx = {
    log,
    signal,
    runId,
    variables: { ...(automation.variables || {}) },
    credentials: {},
    assignment: {},
    screenshots: [],
    tripData,
  }

  try {
    const [username, password, tractor] = await Promise.all([
      getUsername(),
      getDecryptedPassword(),
      getTractorNumber(),
    ])
    ctx.credentials = { username, password, tractor }
    ctx.assignment = await readAssignment()

    for (const condition of automation.conditions || []) {
      log('detail', `Checking condition: ${condition.type}`)
    }

    await ensureContext({ headless, slowMo })
    const page = await getOrCreatePage()
    currentPage = page
    startPreviewCapture(page)

    log('info', `Starting automation: ${automation.name}`)

    for (const action of automation.actions || []) {
      if (signal.aborted) throw new Error('Aborted')
      try {
        await executeAction(action, page, ctx)
      } catch (e) {
        if (e.message?.startsWith('STOP:')) {
          log('info', e.message.replace('STOP:', '').trim())
          break
        }
        try {
          if (!page.isClosed()) {
            const buf = await page.screenshot({ type: 'jpeg', quality: 55 })
            emitLog('screenshot', `error_${action.type}`, {
              runId,
              image: buf.toString('base64'),
              ts: Date.now(),
              error: e.message,
            })
          }
        } catch { /* page closed */ }
        throw e
      }
    }

    log('info', `Automation completed: ${automation.name}`)

    return {
      ok: true,
      runId,
      variables: ctx.variables,
      screenshots: ctx.screenshots,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log('error', msg)
    return { ok: false, runId, error: msg }
  } finally {
    stopPreviewCapture()
    setBlockAutomationBusy(false)
    runnerBusy = false
    currentRunId = null
    currentPage = null
    runAbort = null
    rejectPendingBlockRetryIfAny(new Error('Block run ended'))
    rejectPendingBlockInspectFieldIfAny(new Error('Block run ended'))
    try {
      await closeContext()
    } catch {
      /* ignore */
    }
  }
}
