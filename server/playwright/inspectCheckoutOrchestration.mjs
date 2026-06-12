/**
 * Inspect & Check Out — Smart automation with label-based field detection,
 * seal fallback logic, and complete dispatch flow.
 *
 * Timing: DOM settle waits use PAGE_SETTLE_MS (2s cap) so we do not interact before
 * domcontentloaded. Phase caps keep each automation step within ~2s waits where
 * possible; slow FedEx may need env tuning.
 *
 * Key behavior:
 * - Detects field type by floating LABEL text (not placeholder)
 * - Auto-fills dolly from trip data
 * - Tries all seal numbers from trip data before prompting driver
 * - Always prompts for empty trailer numbers (driver reads physically)
 * - Completes inspection checklist
 * - Clicks AGREE AND CHECK OUT, DISPATCH, YES, detects "You are Dispatched!"
 */

import { buttonLikeByVisibleText } from './textLocators.mjs'
import {
  getDollyCandidates,
  getSealCandidates,
  detectFieldType,
  extractTrailerIndex,
  buildPromptMessage,
  buildTripDataFromAssignment,
} from './inspectFieldResolver.mjs'
/** @type {typeof import('../trailer-number-store.mjs').getTrailerNumberCandidates | null} */
let _getTrailerNumberCandidates = null
async function loadTrailerNumberCandidates(legSeq) {
  try {
    if (!_getTrailerNumberCandidates) {
      const mod = await import('../trailer-number-store.mjs')
      _getTrailerNumberCandidates = mod.getTrailerNumberCandidates
    }
    return await _getTrailerNumberCandidates(legSeq)
  } catch { return [] }
}

/** FedEx copy patterns — tune if the app changes. */
const RX = {
  warningTitle: /warning/i,
  acknowledgeBtn: /acknowledge/i,
  /** Single-trailer empty assignment dialog (Trip Summary / inspect path). */
  emptyTrailerModalBody: /assigned\s+an\s+empty\s+trailer/i,
  checkInSuccessful: /check\s+in\s+successful/i,
  beginInspection: /begin\s+inspection/i,
  validateDolly: /validate\s+dolly/i,
  dollyValidationOk: /dolly\s+validation\s+successful/i,
  validateSeals: /validate\s+seals/i,
  validateSeal: /validate\s+seal/i,
  validateMtTrailer: /validate\s+mt\s+trailer/i,
  validateTrailer: /validate\s+trailer/i,
  validateGeneric: /^validate$/i,
  invalidSealNumber: /invalid\s+seal\s+number/i,
  invalidTrailerNumber: /invalid\s+trailer\s+number|trailer\s+number\s+invalid|invalid\s+trailer/i,
  agreeAndCheckOut: /agree\s+and\s+check\s+out/i,
  dispatch: /^dispatch$/i,
  dispatchConfirmYes: /^yes$/i,
  youAreDispatched: /you\s+are\s+dispatched/i,
  goToHome: /go\s+to\s+home/i,
  checkOffItems: /check\s+off\s+items/i,
  dispatchSummary: /dispatch\s+summary/i,
  reviewStartTrip: /review\s+and\s+start\s+trip/i,
  newTripDetails: /new\s+trip\s+details/i,
  tripDetailsChanged: /details.*have\s+been\s+changed|no\s+longer\s+match/i,
  refreshBtn: /^refresh$/i,
}

/**
 * Max time to wait for DOM navigation settle per step (domcontentloaded). Keeps automation
 * from acting before paint while staying within a tight full-flow budget (~15s happy path).
 */
const PAGE_SETTLE_MS = 2_000

const WARN_MODAL_MS = 1_800
/** FedEx "Empty Trailer" info dialog — click VERIFIED to continue inspect/checkout. */
const EMPTY_TRAILER_MODAL_MS = 2_000
const BEGIN_INSPECTION_MS = 2_000
/** Post-click bounded advance (paired with element polls, not blind multi-second sleeps). */
const AFTER_CLICK_MS = 500
/** No recognized progress before giving up on a screen (keeps total flow bounded). */
const IDLE_EXIT_MS = 10_000
/** Main orchestration loop idle stride — lower = faster screen detection, same branch order. */
const POLL_MS = 35
/** Tighter polling inside bounded post-click waits (dispatch / success detection). */
const FAST_POLL_MS = 28
const MAX_DOLLY_ATTEMPTS = 6
/** Max wait after VALIDATE SEAL(s) for error or next-step UI (per attempt). */
const SEAL_VALIDATION_WAIT_MS = 1_600
/** Poll interval while waiting for seal validation result (max wait unchanged). */
const SEAL_POLL_STEP_MS = 28
/** Poll for invalid-trailer banner after validate (max wait unchanged). */
const TRAILER_POLL_STEP_MS = 28
const DOLLY_POLL_MS = 28
/** Max wall time after VALIDATE DOLLY click until success or leaving dolly entry (per attempt). */
const DOLLY_CLICK_TO_OUTCOME_MS = 1_500
const CHECKLIST_CHECKBOX_DELAY_MS = 12
/** Post-AGREE: dispatch summary load (was 2s via DISPATCH_CONFIRM_WAIT_MS). */
const POST_CHECKLIST_DISPATCH_WAIT_MS = 3_500
/** Idle after AGREE before dispatch_not_clicked (was 10s general IDLE_EXIT_MS). */
const POST_CHECKLIST_IDLE_MS = 13_000
const DISPATCH_CONFIRM_WAIT_MS = 2_000
const DISPATCHED_SUCCESS_WAIT_MS = 2_000
/** Post-AGREE settle poll (was 500ms AFTER_CLICK_MS). */
const POST_AGREE_SETTLE_MS = 800

/**
 * @param {import('playwright').Page} page
 */
async function waitForPageSettle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: PAGE_SETTLE_MS }).catch(() => {})
}

/**
 * Find visible input by floating label text pattern.
 * FedEx uses Material-style floating labels, not placeholders.
 * @param {import('playwright').Page} page
 * @param {RegExp} labelPattern
 * @returns {Promise<{ input: import('playwright').Locator, labelText: string } | null>}
 */
async function findInputByLabel(page, labelPattern) {
  // Try various label patterns used by FedEx
  const labelSelectors = [
    'label',
    '.mat-form-field-label',
    '.mdc-floating-label',
    '[class*="label"]',
    'legend',
  ]

  for (const selector of labelSelectors) {
    const labels = page.locator(`${selector}:visible`)
    const count = await labels.count()
    for (let i = 0; i < count; i++) {
      const label = labels.nth(i)
      const text = (await label.textContent().catch(() => '')) || ''
      if (labelPattern.test(text)) {
        // Find associated input - either by 'for' attribute or nearby
        const forAttr = await label.getAttribute('for').catch(() => null)
        if (forAttr) {
          const input = page.locator(`#${forAttr}:visible`)
          if ((await input.count()) > 0) {
            return { input: input.first(), labelText: text.trim() }
          }
        }
        // Try input within same container
        const container = label.locator('xpath=./ancestor::*[.//input or .//textarea][1]')
        const input = container.locator('input:visible, textarea:visible').first()
        if ((await input.count().catch(() => 0)) > 0) {
          return { input, labelText: text.trim() }
        }
      }
    }
  }

  // Fallback: look for text on page near inputs
  const allInputs = page.locator('input:visible, textarea:visible')
  const inputCount = await allInputs.count()
  for (let i = 0; i < inputCount; i++) {
    const input = allInputs.nth(i)
    // Check aria-label
    const ariaLabel = (await input.getAttribute('aria-label').catch(() => '')) || ''
    if (labelPattern.test(ariaLabel)) {
      return { input, labelText: ariaLabel.trim() }
    }
    // Check placeholder as last resort
    const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || ''
    if (labelPattern.test(placeholder)) {
      return { input, labelText: placeholder.trim() }
    }
  }

  return null
}

/**
 * Find all visible inputs with their associated label text.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ input: import('playwright').Locator, labelText: string }>>}
 */
async function getAllLabeledInputs(page) {
  const results = []

  // Strategy 1: Look for label elements with text containing field keywords
  const textPatterns = [
    /dolly/i,
    /trailer.*number/i,
    /seal.*number/i,
    /tractor/i,
  ]

  for (const pattern of textPatterns) {
    const found = await findInputByLabel(page, pattern)
    if (found) {
      results.push(found)
    }
  }

  // Strategy 2: Scan all visible text for field labels
  const pageText = await page.locator('body').textContent().catch(() => '')
  const allInputs = page.locator('input:visible:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')
  const inputCount = await allInputs.count()

  for (let i = 0; i < inputCount; i++) {
    const input = allInputs.nth(i)
    // Get label from parent/sibling text
    const container = input.locator('xpath=./ancestor::*[position() <= 3]')
    const containerText = (await container.first().textContent().catch(() => '')) || ''

    // Check for known field patterns in container text
    if (/DOLLY\s*NUMBER/i.test(containerText)) {
      results.push({ input, labelText: 'DOLLY NUMBER' })
    } else if (/TRAILER\s*\d+\s*SEAL\s*NUMBER/i.test(containerText)) {
      const match = containerText.match(/TRAILER\s*\d+\s*SEAL\s*NUMBER/i)
      if (match) results.push({ input, labelText: match[0] })
    } else if (/TRAILER\s*\d+\s*NUMBER/i.test(containerText) && !/SEAL/i.test(containerText)) {
      const match = containerText.match(/TRAILER\s*\d+\s*NUMBER/i)
      if (match) results.push({ input, labelText: match[0] })
    }
  }

  return results
}

/**
 * All visible seal inputs on the current step (Trailer 1 / Trailer 2, etc.).
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ input: import('playwright').Locator, trailerIndex: number, labelText: string }>>}
 */
async function collectVisibleSealInputs(page) {
  const inputs = page.locator(
    'input:visible:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
  )
  const count = await inputs.count()
  /** @type {Array<{ input: import('playwright').Locator, trailerIndex: number, labelText: string }>} */
  const found = []
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i)
    if (!(await input.isVisible().catch(() => false))) continue
    let blob =
      (await input
        .locator('xpath=ancestor::mat-form-field[1]')
        .first()
        .innerText()
        .catch(() => '')) || ''
    if (!blob.trim()) {
      blob =
        (await input
          .locator('xpath=./ancestor::*[position()<=8]')
          .first()
          .innerText()
          .catch(() => '')) || ''
    }
    const compact = blob.replace(/\s+/g, ' ').trim()
    const detected = detectFieldType(compact)
    if (detected.type !== 'seal') continue
    found.push({
      input,
      trailerIndex: detected.trailerIndex,
      labelText: compact.slice(0, 120),
    })
  }
  found.sort((a, b) => a.trailerIndex - b.trailerIndex)
  const seen = new Set()
  return found.filter((x) => {
    if (seen.has(x.trailerIndex)) return false
    seen.add(x.trailerIndex)
    return true
  })
}

/**
 * Empty-trailer number inputs (no seal) on the current step.
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ input: import('playwright').Locator, trailerIndex: number, labelText: string }>>}
 */
async function collectVisibleTrailerNumberInputs(page) {
  const inputs = page.locator(
    'input:visible:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])',
  )
  const count = await inputs.count()
  /** @type {Array<{ input: import('playwright').Locator, trailerIndex: number, labelText: string }>} */
  const found = []
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i)
    if (!(await input.isVisible().catch(() => false))) continue
    let blob =
      (await input
        .locator('xpath=ancestor::mat-form-field[1]')
        .first()
        .innerText()
        .catch(() => '')) || ''
    if (!blob.trim()) {
      blob =
        (await input
          .locator('xpath=./ancestor::*[position()<=8]')
          .first()
          .innerText()
          .catch(() => '')) || ''
    }
    const compact = blob.replace(/\s+/g, ' ').trim()
    const detected = detectFieldType(compact)
    if (detected.type !== 'trailerNumber') continue
    found.push({
      input,
      trailerIndex: detected.trailerIndex,
      labelText: compact.slice(0, 120),
    })
  }
  found.sort((a, b) => a.trailerIndex - b.trailerIndex)
  const seen = new Set()
  return found.filter((x) => {
    if (seen.has(x.trailerIndex)) return false
    seen.add(x.trailerIndex)
    return true
  })
}

/**
 * @param {import('playwright').Page} page
 */
async function clickSealValidateButton(page) {
  const plural = buttonLikeByVisibleText(page, RX.validateSeals).first()
  if (await plural.isVisible().catch(() => false)) {
    await plural.click()
    return true
  }
  const singular = buttonLikeByVisibleText(page, RX.validateSeal).first()
  if (await singular.isVisible().catch(() => false)) {
    await singular.click()
    return true
  }
  return false
}

/**
 * Click any visible trailer validation button (VALIDATE MT TRAILER / VALIDATE TRAILER / VALIDATE).
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function clickTrailerValidateButton(page) {
  const mtTrailer = buttonLikeByVisibleText(page, RX.validateMtTrailer).first()
  if (await mtTrailer.isVisible().catch(() => false)) {
    await mtTrailer.click()
    return true
  }
  const trailer = buttonLikeByVisibleText(page, RX.validateTrailer).first()
  if (await trailer.isVisible().catch(() => false)) {
    await trailer.click()
    return true
  }
  const generic = buttonLikeByVisibleText(page, RX.validateGeneric).first()
  if (await generic.isVisible().catch(() => false)) {
    await generic.click()
    return true
  }
  const roleBtn = page.getByRole('button', { name: /^validate$/i }).first()
  if (await roleBtn.isVisible().catch(() => false)) {
    await roleBtn.click()
    return true
  }
  return false
}

/**
 * Check if an invalid trailer number error is visible.
 * @param {import('playwright').Page} page
 */
async function hasInvalidTrailerError(page) {
  const errorBanner = page.getByText(RX.invalidTrailerNumber).first()
  return await errorBanner.isVisible().catch(() => false)
}

/**
 * True when the UI already shows a later inspect/checkout step (same checks the main loop uses),
 * so we can stop waiting for validate API / spinners without changing branch outcomes.
 * @param {import('playwright').Page} page
 */
async function inspectAdvancedPastEntryValidate(page) {
  if (await isInspectionChecklistScreen(page)) return true
  if (await isDispatchScreen(page)) return true
  if (await isDispatchedSuccessScreen(page)) return true
  if (await isDispatchConfirmModal(page)) return true
  if (await isNewTripDetailsModal(page)) return true
  return false
}

/**
 * After trailer validate click, wait up to `maxMs` (same cap as a blind sleep) but return
 * as soon as the invalid-trailer banner appears.
 * @param {import('playwright').Page} page
 * @param {number} maxMs
 * @param {number} [stepMs]
 */
async function waitForTrailerValidationSettle(page, maxMs, stepMs = TRAILER_POLL_STEP_MS) {
  await waitForPageSettle(page)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await hasInvalidTrailerError(page)) return
    if (await inspectAdvancedPastEntryValidate(page)) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await page.waitForTimeout(Math.min(stepMs, remaining))
  }
}

/**
 * @param {import('playwright').Locator} loc
 * @param {number} timeout
 */
async function clickIfVisible(loc, timeout = 2_000) {
  try {
    await loc.first().click({ timeout })
    return true
  } catch {
    return false
  }
}

/**
 * Check if "Invalid Seal Number" error banner is visible.
 * @param {import('playwright').Page} page
 */
async function hasInvalidSealError(page) {
  const errorBanner = page.getByText(RX.invalidSealNumber).first()
  return await errorBanner.isVisible().catch(() => false)
}

/**
 * After a seal validate click, wait up to `maxMs` (same cap as a fixed sleep) but return
 * as soon as the invalid-seal banner appears, or when a later step is already visible.
 * @param {import('playwright').Page} page
 * @param {number} maxMs
 * @param {number} [stepMs]
 */
async function waitForSealValidationSettle(page, maxMs, stepMs = SEAL_POLL_STEP_MS) {
  await waitForPageSettle(page)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await hasInvalidSealError(page)) return
    if (await inspectAdvancedPastEntryValidate(page)) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await page.waitForTimeout(Math.min(stepMs, remaining))
  }
}

/**
 * Optional TSPA warning — dismiss with ACKNOWLEDGE.
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 */
export async function dismissInspectWarningIfPresent(page, log) {
  const warnText = page.getByText(RX.warningTitle).first()
  const appearDeadline = Date.now() + 350
  while (Date.now() < appearDeadline) {
    if (await warnText.isVisible().catch(() => false)) break
    await page.waitForTimeout(40)
  }
  if (!(await warnText.isVisible().catch(() => false))) return

  const deadline = Date.now() + WARN_MODAL_MS
  while (Date.now() < deadline) {
    const hasWarn = await warnText.isVisible().catch(() => false)
    if (!hasWarn) {
      await waitForPageSettle(page)
      return
    }
    const ack = buttonLikeByVisibleText(page, RX.acknowledgeBtn).first()
    if (await ack.isVisible().catch(() => false)) {
      await ack.click()
      log('info', 'Dismissed Inspect warning (ACKNOWLEDGE)')
      await waitForPageSettle(page)
      await page.waitForTimeout(100)
      return
    }
    await page.waitForTimeout(55)
  }
}

/**
 * Single empty-trailer assignment notice — dismiss with VERIFIED (extra step before
 * dolly / MT trailer validation on some single-trailer dispatches).
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 */
async function dismissEmptyTrailerVerifiedModalIfPresent(page, log) {
  const verified = page.getByRole('button', { name: /^\s*verified\s*$/i }).first()
  const appearDeadline = Date.now() + 350
  while (Date.now() < appearDeadline) {
    if (await verified.isVisible().catch(() => false)) break
    await page.waitForTimeout(40)
  }
  if (!(await verified.isVisible().catch(() => false))) return

  const wrongContextGiveUp = Date.now() + 450
  const deadline = Date.now() + EMPTY_TRAILER_MODAL_MS
  while (Date.now() < deadline) {
    const bodyHit = await page
      .getByText(RX.emptyTrailerModalBody)
      .first()
      .isVisible()
      .catch(() => false)
    const titleHit = await page
      .getByText(/\bempty\s+trailer\b/i)
      .first()
      .isVisible()
      .catch(() => false)
    if (!bodyHit && !titleHit) {
      if (Date.now() >= wrongContextGiveUp) return
      await page.waitForTimeout(55)
      continue
    }
    try {
      await verified.click({ timeout: 2_000 })
    } catch {
      const alt = buttonLikeByVisibleText(page, /^verified$/i).first()
      if (await alt.isVisible().catch(() => false)) await alt.click({ timeout: 2_000 })
    }
    log('info', 'Dismissed Empty Trailer modal (VERIFIED)')
    await waitForPageSettle(page)
    await page.waitForTimeout(100)
    return
  }
}

/**
 * Check In Successful → BEGIN INSPECTION.
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 */
export async function clickBeginInspectionIfPresent(page, log) {
  const deadline = Date.now() + BEGIN_INSPECTION_MS
  while (Date.now() < deadline) {
    const beginBtn = buttonLikeByVisibleText(page, RX.beginInspection).first()
    const hasBegin = await beginBtn.isVisible().catch(() => false)
    if (hasBegin) {
      await beginBtn.click()
      log('info', 'Clicked Begin Inspection')
      await waitForPageSettle(page)
      await page.waitForTimeout(90)
      return
    }
    const anyBegin = await page.getByText(RX.beginInspection).first().isVisible().catch(() => false)
    if (anyBegin) {
      await clickIfVisible(buttonLikeByVisibleText(page, RX.beginInspection))
      log('info', 'Clicked Begin Inspection (relaxed match)')
      await page.waitForTimeout(90)
      return
    }
    await page.waitForTimeout(45)
  }
  log('warn', 'Begin Inspection not found within timeout — continuing to form loop')
}

/**
 * @param {import('playwright').Page} page
 */
async function isDollyEntryScreen(page) {
  const dollyInput = await findInputByLabel(page, /dolly/i)
  if (!dollyInput) return false
  const vd = buttonLikeByVisibleText(page, RX.validateDolly).first()
  return await vd.isVisible().catch(() => false)
}

/**
 * @param {import('playwright').Page} page
 */
async function isDollySuccessScreen(page) {
  const ok = page.getByText(RX.dollyValidationOk).first()
  return await ok.isVisible().catch(() => false)
}

/**
 * Check if we're on the inspection checklist screen.
 * @param {import('playwright').Page} page
 */
async function isInspectionChecklistScreen(page) {
  const checkOffText = page.getByText(RX.checkOffItems).first()
  const agreeBtn = buttonLikeByVisibleText(page, RX.agreeAndCheckOut).first()
  const hasText = await checkOffText.isVisible().catch(() => false)
  const hasBtn = await agreeBtn.isVisible().catch(() => false)
  return hasText || hasBtn
}

/**
 * Check if we're on the Review and Start Trip / Dispatch Summary screen.
 * FedEx renders the DISPATCH action as various element types (<button>, <a>, styled <div>)
 * so we try multiple strategies.
 * @param {import('playwright').Page} page
 */
async function isDispatchScreen(page) {
  const dispatchRole = page.getByRole('button', { name: /^dispatch$/i }).first()
  if (await dispatchRole.isVisible().catch(() => false)) return true
  const dispatchBtn = buttonLikeByVisibleText(page, RX.dispatch).first()
  if (await dispatchBtn.isVisible().catch(() => false)) return true

  const onSummaryPage =
    (await page.getByText(RX.dispatchSummary).first().isVisible().catch(() => false)) ||
    (await page.getByText(RX.reviewStartTrip).first().isVisible().catch(() => false))

  if (onSummaryPage) {
    const looseRole = page.getByRole('button', { name: /dispatch/i }).first()
    if (await looseRole.isVisible().catch(() => false)) return true
    const looseLink = page.getByRole('link', { name: /dispatch/i }).first()
    if (await looseLink.isVisible().catch(() => false)) return true
    const anyClickable = page
      .locator('a, button, [role="button"], [class*="button"], [class*="btn"]')
      .filter({ hasText: /dispatch/i })
      .first()
    if (await anyClickable.isVisible().catch(() => false)) return true
    const textOnly = page.getByText(/^dispatch$/i).first()
    if (await textOnly.isVisible().catch(() => false)) return true
  }
  return false
}

/**
 * Check if dispatch confirmation modal ("Do you wish to Dispatch?") is visible.
 * @param {import('playwright').Page} page
 */
async function isDispatchConfirmModal(page) {
  const modalText = page.getByText(/do you wish to dispatch/i).first()
  const hasModal = await modalText.isVisible().catch(() => false)
  if (!hasModal) {
    const altText = page.getByText(/once dispatched.*trip will begin/i).first()
    if (!(await altText.isVisible().catch(() => false))) return false
  }
  const yesRole = page.getByRole('button', { name: /^yes$/i }).first()
  if (await yesRole.isVisible().catch(() => false)) return true
  const yesBtn = buttonLikeByVisibleText(page, RX.dispatchConfirmYes).first()
  if (await yesBtn.isVisible().catch(() => false)) return true
  const yesLink = page.getByRole('link', { name: /^yes$/i }).first()
  if (await yesLink.isVisible().catch(() => false)) return true
  const yesAny = page
    .locator('a, button, [role="button"], [class*="button"], [class*="btn"]')
    .filter({ hasText: /^yes$/i })
    .first()
  return await yesAny.isVisible().catch(() => false)
}

/**
 * Click the DISPATCH button using multiple fallback strategies.
 * @param {import('playwright').Page} page
 */
async function clickDispatchButton(page) {
  const dispatchRole = page.getByRole('button', { name: /^dispatch$/i }).first()
  if (await dispatchRole.isVisible().catch(() => false)) {
    await dispatchRole.click()
    return
  }
  const dispatchBtn = buttonLikeByVisibleText(page, RX.dispatch).first()
  if (await dispatchBtn.isVisible().catch(() => false)) {
    await dispatchBtn.click()
    return
  }
  const dispatchLink = page.getByRole('link', { name: /dispatch/i }).first()
  if (await dispatchLink.isVisible().catch(() => false)) {
    await dispatchLink.click()
    return
  }
  const anyClickable = page
    .locator('a, button, [role="button"], [class*="button"], [class*="btn"]')
    .filter({ hasText: /dispatch/i })
    .first()
  if (await anyClickable.isVisible().catch(() => false)) {
    await anyClickable.click()
    return
  }
  const textEl = page.getByText(/^dispatch$/i).first()
  await textEl.click()
}

/**
 * Click YES on the dispatch confirmation modal using multiple fallbacks.
 * @param {import('playwright').Page} page
 */
async function clickDispatchConfirmYes(page) {
  const yesRole = page.getByRole('button', { name: /^yes$/i }).first()
  if (await yesRole.isVisible().catch(() => false)) {
    await yesRole.click()
    return
  }
  const yesBtn = buttonLikeByVisibleText(page, RX.dispatchConfirmYes).first()
  if (await yesBtn.isVisible().catch(() => false)) {
    await yesBtn.click()
    return
  }
  const yesLink = page.getByRole('link', { name: /^yes$/i }).first()
  if (await yesLink.isVisible().catch(() => false)) {
    await yesLink.click()
    return
  }
  const yesAny = page
    .locator('a, button, [role="button"], [class*="button"], [class*="btn"]')
    .filter({ hasText: /^yes$/i })
    .first()
  if (await yesAny.isVisible().catch(() => false)) {
    await yesAny.click()
    return
  }
  await page.getByText(/^yes$/i).first().click()
}

/**
 * Check if "You are Dispatched!" success screen is visible.
 * @param {import('playwright').Page} page
 */
async function isDispatchedSuccessScreen(page) {
  const successText = page.getByText(RX.youAreDispatched).first()
  return await successText.isVisible().catch(() => false)
}

/**
 * Check if "New Trip Details" modal is visible (trip changed mid-inspection).
 * @param {import('playwright').Page} page
 */
async function isNewTripDetailsModal(page) {
  const title = page.getByText(RX.newTripDetails).first()
  if (!(await title.isVisible().catch(() => false))) return false
  const refreshRole = page.getByRole('button', { name: /^refresh$/i }).first()
  if (await refreshRole.isVisible().catch(() => false)) return true
  const refreshBtn = buttonLikeByVisibleText(page, RX.refreshBtn).first()
  return await refreshBtn.isVisible().catch(() => false)
}

/**
 * After YES on dispatch confirm: same max as a blind sleep, exit early when the
 * following loop would see success or New Trip Details.
 * @param {import('playwright').Page} page
 * @param {number} maxMs
 * @param {number} [stepMs]
 */
async function waitForPostDispatchConfirmSettle(page, maxMs, stepMs = FAST_POLL_MS) {
  await waitForPageSettle(page)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await isDispatchedSuccessScreen(page)) return
    if (await isNewTripDetailsModal(page)) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await page.waitForTimeout(Math.min(stepMs, remaining))
  }
}

/**
 * After DISPATCH: same max as blind sleep, exit early when confirm modal or success shows.
 * @param {import('playwright').Page} page
 * @param {number} maxMs
 * @param {number} [stepMs]
 */
async function waitForPostDispatchButtonSettle(page, maxMs, stepMs = FAST_POLL_MS) {
  await waitForPageSettle(page)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await isDispatchConfirmModal(page)) return
    if (await isDispatchedSuccessScreen(page)) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await page.waitForTimeout(Math.min(stepMs, remaining))
  }
}

/**
 * After AGREE AND CHECK OUT: same max as blind sleep, exit early when dispatch flow appears.
 * @param {import('playwright').Page} page
 * @param {number} maxMs
 * @param {number} [stepMs]
 */
async function waitForPostAgreeCheckOutSettle(page, maxMs, stepMs = FAST_POLL_MS) {
  await waitForPageSettle(page)
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    if (await isDispatchScreen(page)) return
    if (await isDispatchedSuccessScreen(page)) return
    if (await isDispatchConfirmModal(page)) return
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await page.waitForTimeout(Math.min(stepMs, remaining))
  }
}

/**
 * Handle "New Trip Details" modal — click REFRESH and signal re-checkin needed.
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 * @returns {Promise<boolean>} true if handled
 */
async function handleNewTripDetailsModal(page, log) {
  if (!(await isNewTripDetailsModal(page))) return false

  log('warn', 'New Trip Details modal detected — trip changed mid-inspection')

  const refreshRole = page.getByRole('button', { name: /^refresh$/i }).first()
  if (await refreshRole.isVisible().catch(() => false)) {
    await refreshRole.click()
    log('info', 'Clicked REFRESH on New Trip Details modal')
    await waitForPageSettle(page)
    await page.waitForTimeout(80)
    return true
  }
  const refreshBtn = buttonLikeByVisibleText(page, RX.refreshBtn).first()
  if (await refreshBtn.isVisible().catch(() => false)) {
    await refreshBtn.click()
    log('info', 'Clicked REFRESH on New Trip Details modal')
    await waitForPageSettle(page)
    await page.waitForTimeout(80)
  }

  return true
}

/**
 * Locate AGREE AND CHECK OUT using the same fallback chain as DISPATCH.
 * @param {import('playwright').Page} page
 */
async function findAgreeAndCheckOutButton(page) {
  const agreeRole = page.getByRole('button', { name: RX.agreeAndCheckOut }).first()
  if (await agreeRole.isVisible().catch(() => false)) return agreeRole
  const agreeBtn = buttonLikeByVisibleText(page, RX.agreeAndCheckOut).first()
  if (await agreeBtn.isVisible().catch(() => false)) return agreeBtn
  const agreeLink = page.getByRole('link', { name: RX.agreeAndCheckOut }).first()
  if (await agreeLink.isVisible().catch(() => false)) return agreeLink
  const agreeAny = page
    .locator('a, button, [role="button"], [class*="button"], [class*="btn"]')
    .filter({ hasText: RX.agreeAndCheckOut })
    .first()
  if (await agreeAny.isVisible().catch(() => false)) return agreeAny
  const agreeText = page.getByText(RX.agreeAndCheckOut).first()
  if (await agreeText.isVisible().catch(() => false)) return agreeText
  return null
}

/**
 * @param {import('playwright').Locator} el
 */
async function isChecklistControlChecked(el) {
  const tag = (await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => '')) || ''
  if (tag === 'input') {
    return await el.isChecked().catch(() => false)
  }
  const aria = await el.getAttribute('aria-checked').catch(() => null)
  if (aria === 'true') return true
  const cls = (await el.getAttribute('class').catch(() => '')) || ''
  if (/mat-checkbox-checked|mdc-checkbox--selected|is-checked/i.test(cls)) return true
  return false
}

/**
 * Click all unchecked checkboxes in the inspection checklist.
 * FedEx may use native inputs, mat-checkbox, or role=checkbox.
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 */
async function completeInspectionChecklist(page, log) {
  const uncheckedSelectors = [
    'mat-checkbox:not(.mat-checkbox-checked)',
    '[role="checkbox"][aria-checked="false"]',
    'input[type="checkbox"]:not(:checked)',
  ]

  let totalClicked = 0
  for (let pass = 0; pass < 4; pass++) {
    let clicked = 0
    for (const selector of uncheckedSelectors) {
      const items = page.locator(selector)
      const count = await items.count()
      for (let i = 0; i < count; i++) {
        const item = items.nth(i)
        if (await isChecklistControlChecked(item)) continue
        await item.click({ force: true }).catch(() => {})
        clicked++
        await page.waitForTimeout(CHECKLIST_CHECKBOX_DELAY_MS)
      }
    }
    totalClicked += clicked
    if (clicked === 0) break
    await page.waitForTimeout(60)
  }

  log('info', `Clicked ${totalClicked} checkboxes in inspection checklist`)
}

/**
 * Wait until AGREE AND CHECK OUT is visible and enabled (all items checked).
 * @param {import('playwright').Page} page
 * @param {number} maxMs
 */
async function waitForAgreeAndCheckOutReady(page, maxMs) {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const btn = await findAgreeAndCheckOutButton(page)
    if (btn) {
      const enabled = await btn.isEnabled().catch(() => true)
      const disabled = await btn.getAttribute('disabled').catch(() => null)
      const ariaDisabled = await btn.getAttribute('aria-disabled').catch(() => null)
      if (enabled && !disabled && ariaDisabled !== 'true') return btn
    }
    await page.waitForTimeout(FAST_POLL_MS)
  }
  return findAgreeAndCheckOutButton(page)
}

/**
 * @typedef {{ label: string, jpeg: string, ts: number }} ProofScreenshot
 */

/**
 * Capture a compressed proof screenshot (JPEG q40).
 * @param {import('playwright').Page} page
 * @param {string} label
 * @param {ProofScreenshot[]} bucket
 * @param {(type: string, message: string, extra?: object) => void} log
 */
async function captureProof(page, label, bucket, log) {
  try {
    if (page.isClosed()) return
    const buf = await page.screenshot({ type: 'jpeg', quality: 40, fullPage: false })
    bucket.push({ label, jpeg: buf.toString('base64'), ts: Date.now() })
    log('info', `Proof screenshot: ${label}`)
  } catch { /* page closed or nav */ }
}

/**
 * Run post-gate Inspect & Check Out with smart field resolution.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.runId]
 * @param {unknown} [opts.assignment]
 * @param {import('./inspectFieldResolver.mjs').TripData} [opts.tripData]
 * @param {(o: { field: string, message: string }) => Promise<string>} opts.waitForInspectField
 * @returns {Promise<{ ok: boolean, reason?: string, proofScreenshots?: ProofScreenshot[] }>}
 */
export async function runInspectCheckoutAfterGate(page, opts) {
  const { log, signal, assignment = {}, tripData = {}, waitForInspectField } = opts

  const tripDataEffective = {
    ...buildTripDataFromAssignment(assignment),
    ...(tripData && typeof tripData === 'object' ? tripData : {}),
  }

  /** @type {ProofScreenshot[]} */
  const proofScreenshots = []

  /** Pre-entered trailer numbers from the home page (for empty trailers). */
  /** @type {Map<number, string>} */
  const preEnteredTrailerNbrs = new Map()
  const legSeq = String(tripDataEffective.dailyTripLegSequence || '').trim()
  if (legSeq) {
    const stored = await loadTrailerNumberCandidates(legSeq)
    for (const s of stored) preEnteredTrailerNbrs.set(s.index, s.number)
    if (preEnteredTrailerNbrs.size) {
      log('info', `Loaded ${preEnteredTrailerNbrs.size} pre-entered trailer number(s) for leg ${legSeq}`)
    }
  }

  /** Per-trailer seal tracking — seals that failed for trailer N may still be valid for trailer M (swap). */
  /** @type {Map<number, Set<string>>} */
  const triedSealsByTrailer = new Map()
  /** @param {number} idx 1-based trailer index */
  const getTriedSeals = (idx) => {
    if (!triedSealsByTrailer.has(idx)) triedSealsByTrailer.set(idx, new Set())
    return /** @type {Set<string>} */ (triedSealsByTrailer.get(idx))
  }
  let batchSealsAttempted = false
  let lastProgress = Date.now()
  let dollyAttempts = 0
  let dispatchClicked = false
  let checklistDone = false
  /** Wall clock when AGREE AND CHECK OUT was clicked (post-checklist idle budget). */
  let checklistCompletedAt = 0

  const aborted = () => {
    if (signal?.aborted) throw new Error('Aborted')
  }

  await dismissInspectWarningIfPresent(page, log)
  await dismissEmptyTrailerVerifiedModalIfPresent(page, log)
  await clickBeginInspectionIfPresent(page, log)

  let mainLoopIteration = 0
  for (;;) {
    aborted()
    mainLoopIteration += 1
    if (mainLoopIteration > 1) await page.waitForTimeout(POLL_MS)
    await dismissEmptyTrailerVerifiedModalIfPresent(page, log)

    // --- Check for "You are Dispatched!" success ---
    if (await isDispatchedSuccessScreen(page)) {
      await captureProof(page, 'You Are Dispatched', proofScreenshots, log)
      log('info', 'Inspect & Check Out complete: You are Dispatched!', {
        inspectCheckoutPhaseDone: true,
        dispatched: true,
      })
      return { ok: true, reason: 'dispatched', proofScreenshots }
    }

    // --- Check for "New Trip Details" modal (trip changed mid-inspection) ---
    if (await isNewTripDetailsModal(page)) {
      await captureProof(page, 'New Trip Details', proofScreenshots, log)
      log('warn', 'New Trip Details detected — trip details changed mid-inspection, need re-checkin', {
        inspectCheckoutPhaseDone: true,
        dispatched: false,
        newTripDetails: true,
      })
      await handleNewTripDetailsModal(page, log)
      return {
        ok: false,
        reason: 'new_trip_details',
        proofScreenshots,
        requiresReCheckin: true,
        speechMessage: 'Inspect and Checkout failed, new trip details added',
      }
    }

    // --- Dispatch confirmation modal (YES/NO) ---
    if (await isDispatchConfirmModal(page)) {
      await clickDispatchConfirmYes(page)
      log('info', 'Clicked YES on dispatch confirmation')
      lastProgress = Date.now()
      await waitForPostDispatchConfirmSettle(page, AFTER_CLICK_MS)

      // Wait for dispatched success or new trip details
      const t0 = Date.now()
      while (Date.now() - t0 < DISPATCHED_SUCCESS_WAIT_MS) {
        aborted()
        if (await isDispatchedSuccessScreen(page)) {
          await captureProof(page, 'You Are Dispatched', proofScreenshots, log)
          log('info', 'Inspect & Check Out complete: You are Dispatched!', {
            inspectCheckoutPhaseDone: true,
            dispatched: true,
          })
          return { ok: true, reason: 'dispatched', proofScreenshots }
        }
        // Check for "New Trip Details" modal after dispatch confirmation
        if (await isNewTripDetailsModal(page)) {
          await captureProof(page, 'New Trip Details', proofScreenshots, log)
          log('warn', 'New Trip Details after dispatch confirm — trip changed, need re-checkin', {
            inspectCheckoutPhaseDone: true,
            dispatched: false,
            newTripDetails: true,
          })
          await handleNewTripDetailsModal(page, log)
          return {
            ok: false,
            reason: 'new_trip_details',
            proofScreenshots,
            requiresReCheckin: true,
            speechMessage: 'Inspect and Checkout failed, new trip details added',
          }
        }
        await page.waitForTimeout(FAST_POLL_MS)
      }
      continue
    }

    // --- Dispatch screen (Review and Start Trip / Dispatch Summary) ---
    if (await isDispatchScreen(page)) {
      await captureProof(page, 'Dispatch Summary', proofScreenshots, log)
      await clickDispatchButton(page)
      dispatchClicked = true
      log('info', 'Clicked DISPATCH button')
      lastProgress = Date.now()
      await waitForPostDispatchButtonSettle(page, AFTER_CLICK_MS)

      // Wait briefly for the confirmation modal to appear
      const dWait = Date.now()
      while (Date.now() - dWait < DISPATCH_CONFIRM_WAIT_MS) {
        aborted()
        if (await isDispatchConfirmModal(page)) break
        if (await isDispatchedSuccessScreen(page)) break
        await page.waitForTimeout(FAST_POLL_MS)
      }
      continue
    }

    // --- Inspection checklist screen ---
    if (await isInspectionChecklistScreen(page)) {
      if (!checklistDone) {
        await completeInspectionChecklist(page, log)
        await page.waitForTimeout(80)

        await captureProof(page, 'Inspection Checklist', proofScreenshots, log)
        const agreeBtn = await waitForAgreeAndCheckOutReady(page, POST_CHECKLIST_DISPATCH_WAIT_MS)
        if (agreeBtn) {
          await agreeBtn.click()
          checklistDone = true
          checklistCompletedAt = Date.now()
          log('info', 'Clicked AGREE AND CHECK OUT')
          lastProgress = Date.now()
          await waitForPostAgreeCheckOutSettle(page, POST_AGREE_SETTLE_MS)
        } else {
          log('warn', 'AGREE AND CHECK OUT not ready after completing checklist')
        }
      } else if (checklistCompletedAt && Date.now() - checklistCompletedAt > POST_CHECKLIST_IDLE_MS) {
        log('warn', 'Inspect & Check Out: timed out after checklist — DISPATCH button was never clicked', {
          inspectCheckoutPhaseDone: true,
          dispatched: false,
        })
        return { ok: false, reason: 'dispatch_not_clicked', proofScreenshots }
      }

      // Keep polling while FedEx transitions checklist → dispatch summary
      const cWait = Date.now()
      while (Date.now() - cWait < POST_CHECKLIST_DISPATCH_WAIT_MS) {
        aborted()
        if (await isDispatchScreen(page)) break
        if (await isDispatchedSuccessScreen(page)) break
        if (await isDispatchConfirmModal(page)) break
        if (!checklistDone) {
          const retryAgree = await waitForAgreeAndCheckOutReady(page, FAST_POLL_MS * 4)
          if (retryAgree) {
            await retryAgree.click()
            checklistDone = true
            checklistCompletedAt = Date.now()
            log('info', 'Clicked AGREE AND CHECK OUT (retry)')
            lastProgress = Date.now()
            await waitForPostAgreeCheckOutSettle(page, POST_AGREE_SETTLE_MS)
          }
        }
        await page.waitForTimeout(FAST_POLL_MS)
      }
      continue
    }

    // --- Dolly validation success → VALIDATE SEALS ---
    if (await isDollySuccessScreen(page)) {
      await captureProof(page, 'Dolly Validated', proofScreenshots, log)
      const vs = buttonLikeByVisibleText(page, RX.validateSeals).first()
      if (await vs.isVisible().catch(() => false)) {
        await vs.click()
        log('info', 'Clicked VALIDATE SEALS after dolly success')
        lastProgress = Date.now()
        await waitForSealValidationSettle(page, AFTER_CLICK_MS)
        continue
      }
    }

    // --- Warning / Begin (late) ---
    await dismissInspectWarningIfPresent(page, log)
    const beginLate = buttonLikeByVisibleText(page, RX.beginInspection).first()
    if (await beginLate.isVisible().catch(() => false)) {
      const clicked = await clickIfVisible(buttonLikeByVisibleText(page, RX.beginInspection))
      if (clicked) {
        log('info', 'Clicked Begin Inspection (late)')
        lastProgress = Date.now()
        await waitForPageSettle(page)
        await page.waitForTimeout(60)
        continue
      }
    }

    // --- Dolly entry — try every candidate from trip data before prompting ---
    if (await isDollyEntryScreen(page)) {
      dollyAttempts += 1
      if (dollyAttempts > MAX_DOLLY_ATTEMPTS) {
        throw new Error('Inspect: dolly validation failed too many times')
      }

      const dollyCandidates = getDollyCandidates(tripDataEffective)
      let dollyAdvanced = false

      for (const candidate of dollyCandidates) {
        aborted()
        const dollyInput = await findInputByLabel(page, /dolly/i)
        if (!dollyInput?.input) break

        await dollyInput.input.fill(candidate)
        log('info', `Trying dolly candidate: ${candidate}`)

        const vd = buttonLikeByVisibleText(page, RX.validateDolly).first()
        await vd.click()
        lastProgress = Date.now()
        await waitForPageSettle(page)
        const t0 = Date.now()
        while (Date.now() - t0 < DOLLY_CLICK_TO_OUTCOME_MS) {
          aborted()
          if (await isDollySuccessScreen(page)) { dollyAdvanced = true; break }
          if (!(await isDollyEntryScreen(page))) { dollyAdvanced = true; break }
          await page.waitForTimeout(DOLLY_POLL_MS)
        }

        if (dollyAdvanced) {
          log('info', `Dolly validated: ${candidate}`)
          lastProgress = Date.now()
          break
        }
        log('warn', `Dolly candidate rejected: ${candidate} — trying next`)
      }

      if (!dollyAdvanced && (await isDollyEntryScreen(page))) {
        log('info', 'All dolly candidates exhausted — prompting driver')
        const val = (
          await waitForInspectField({
            field: 'dolly',
            message: buildPromptMessage('dolly', 0),
          })
        ).trim()
        if (!val) throw new Error('Inspect: dolly number required')

        const dollyInput = await findInputByLabel(page, /dolly/i)
        if (dollyInput?.input) await dollyInput.input.fill(val)
        log('info', `Filled dolly number (driver): ${val}`)

        const vd = buttonLikeByVisibleText(page, RX.validateDolly).first()
        await vd.click()
        lastProgress = Date.now()
        await waitForPageSettle(page)
        const tDriver = Date.now()
        while (Date.now() - tDriver < AFTER_CLICK_MS) {
          aborted()
          if (await isDollySuccessScreen(page)) break
          if (!(await isDollyEntryScreen(page))) break
          await page.waitForTimeout(DOLLY_POLL_MS)
        }
      }
      continue
    }

    // --- Batch seal entry (Trailer 1 + 2 on one step, single VALIDATE SEALS) ---
    if (!(await isDollyEntryScreen(page))) {
      const sealRows = await collectVisibleSealInputs(page)
      const pluralSealsBtn = buttonLikeByVisibleText(page, RX.validateSeals).first()
      const batchSeals =
        sealRows.length >= 2 ||
        (sealRows.length >= 1 && (await pluralSealsBtn.isVisible().catch(() => false)))
      if (batchSeals && !batchSealsAttempted) {
        batchSealsAttempted = true
        let filledAny = false
        let missingCandidate = false
        for (const row of sealRows) {
          aborted()
          const trailerIndex = row.trailerIndex
          const sealCandidates = getSealCandidates(tripDataEffective, trailerIndex - 1)
          const val = sealCandidates[0] || ''
          if (!val) { missingCandidate = true; break }
          await row.input.fill(val)
          filledAny = true
          log('info', `Batch seal pre-fill Trailer ${trailerIndex}: ${val}`)
        }
        if (filledAny && !missingCandidate) {
          const clickedValidate = await clickSealValidateButton(page)
          if (clickedValidate) {
            log('info', 'Clicked seal validation after batch trailer seal fill')
            lastProgress = Date.now()
            await waitForSealValidationSettle(page, Math.max(SEAL_VALIDATION_WAIT_MS, 1_200))
            if (!(await hasInvalidSealError(page))) {
              await captureProof(page, 'Seals Validated', proofScreenshots, log)
              continue
            }
            log('warn', 'Batch seal validation failed — falling through to per-field swap handling')
          }
        }
      }
    }

    // --- Batch empty-trailer numbers (multiple fields, one validate) ---
    // Same flow as commit 1e894cf: after dolly (and seals if loaded), fill every visible
    // empty-trailer field then click validate once — matches FedEx two-empty + dolly UX.
    if (!(await isDollyEntryScreen(page))) {
      const trailerRows = await collectVisibleTrailerNumberInputs(page)
      const vmtBtn = buttonLikeByVisibleText(page, RX.validateMtTrailer).first()
      const batchMt =
        trailerRows.length >= 2 ||
        (trailerRows.length >= 1 && (await vmtBtn.isVisible().catch(() => false)))
      if (batchMt) {
        log('info', `Detected ${trailerRows.length} empty trailer input(s) — batch fill then validate`)
        for (const row of trailerRows) {
          aborted()
          const trailerIndex = row.trailerIndex
          const preEntered = preEnteredTrailerNbrs.get(trailerIndex) || ''
          let val = preEntered
          if (val) {
            log('info', `Using pre-entered trailer number for Trailer ${trailerIndex}: ${val}`)
          } else {
            log('info', `No pre-entered number for Trailer ${trailerIndex} — prompting`)
            val = (
              await waitForInspectField({
                field: `trailer${trailerIndex}_number`,
                message: buildPromptMessage('trailerNumber', trailerIndex),
              })
            ).trim()
          }
          if (!val) throw new Error(`Inspect: trailer number required for Trailer ${trailerIndex}`)
          await row.input.fill(val)
        }
        const clickedValidate = await clickTrailerValidateButton(page)
        if (clickedValidate) {
          log('info', 'Clicked trailer validate after batch trailer numbers')
          lastProgress = Date.now()
          await waitForTrailerValidationSettle(page, AFTER_CLICK_MS)
          if (await hasInvalidTrailerError(page)) {
            log('warn', 'Invalid trailer number after batch validate — will retry next pass')
            await page.waitForTimeout(100)
          }
          continue
        }
        const fallbackBtn = page
          .getByRole('button', { name: /validate|submit|continue|next/i })
          .first()
        if (await fallbackBtn.isVisible().catch(() => false)) {
          await fallbackBtn.click()
          log('info', 'Clicked fallback validate after batch trailer numbers')
          lastProgress = Date.now()
          await waitForTrailerValidationSettle(page, AFTER_CLICK_MS)
          continue
        }
      }
    }

    // --- Detect field by label text ---
    const labeledInputs = await getAllLabeledInputs(page)

    let handled = false
    for (const { input, labelText } of labeledInputs) {
      aborted()
      const vis = await input.isVisible().catch(() => false)
      if (!vis) continue

      const detected = detectFieldType(labelText)

      // --- SEAL NUMBER (loaded trailers) — try all known seals (swap-aware) ---
      if (detected.type === 'seal') {
        const trailerIndex = detected.trailerIndex
        const tried = getTriedSeals(trailerIndex)
        const sealCandidates = getSealCandidates(tripDataEffective, trailerIndex - 1)
        const untried = sealCandidates.filter((s) => !tried.has(s))

        let validationSuccess = false

        for (const candidate of untried) {
          tried.add(candidate)
          await input.fill(candidate)
          log('info', `Trying seal candidate: ${candidate} for Trailer ${trailerIndex}`)

          const validateBtn = buttonLikeByVisibleText(page, RX.validateSeal).first()
          if (await validateBtn.isVisible().catch(() => false)) {
            await validateBtn.click()
            lastProgress = Date.now()
            await waitForSealValidationSettle(page, SEAL_VALIDATION_WAIT_MS)
          }

          if (await hasInvalidSealError(page)) {
            log('warn', `Invalid seal: ${candidate} for Trailer ${trailerIndex} — trying next`)
            await input.clear()
            await page.waitForTimeout(110)
            continue
          }

          validationSuccess = true
          log('info', `Seal validated: ${candidate} for Trailer ${trailerIndex}`)
          break
        }

        if (!validationSuccess) {
          log('info', `All seal candidates exhausted for Trailer ${trailerIndex} — prompting driver`)
          const val = (
            await waitForInspectField({
              field: `trailer${trailerIndex}_seal`,
              message: buildPromptMessage('seal', trailerIndex),
            })
          ).trim()

          if (!val) throw new Error(`Inspect: seal required for Trailer ${trailerIndex}`)

          await input.fill(val)
          const validateBtn = buttonLikeByVisibleText(page, RX.validateSeal).first()
          if (await validateBtn.isVisible().catch(() => false)) {
            await validateBtn.click()
            log('info', `Clicked VALIDATE SEAL with driver value: ${val}`)
            lastProgress = Date.now()
            await waitForSealValidationSettle(page, AFTER_CLICK_MS)
          }
        }

        handled = true
        break
      }

      // --- TRAILER NUMBER (empty trailers — use pre-entered, then prompt) ---
      if (detected.type === 'trailerNumber') {
        const trailerIndex = detected.trailerIndex
        const preEntered = preEnteredTrailerNbrs.get(trailerIndex) || ''
        let val = preEntered
        if (val) {
          log('info', `Using pre-entered trailer number for Trailer ${trailerIndex}: ${val}`)
        } else {
          log('info', `No pre-entered number for Trailer ${trailerIndex} — prompting`)
          val = (
            await waitForInspectField({
              field: `trailer${trailerIndex}_number`,
              message: buildPromptMessage('trailerNumber', trailerIndex),
            })
          ).trim()
        }

        if (!val) throw new Error(`Inspect: trailer number required for Trailer ${trailerIndex}`)

        await input.fill(val)
        log('info', `Filled trailer number: ${val}`)

        // Click VALIDATE MT TRAILER button
        const validateBtn = buttonLikeByVisibleText(page, RX.validateMtTrailer).first()
        if (await validateBtn.isVisible().catch(() => false)) {
          await validateBtn.click()
          log('info', 'Clicked VALIDATE MT TRAILER')
          lastProgress = Date.now()
          await waitForTrailerValidationSettle(page, AFTER_CLICK_MS)
        } else {
          // Fallback to generic validate/submit button
          const fallbackBtn = page
            .getByRole('button', { name: /validate|submit|continue|next/i })
            .first()
          if (await fallbackBtn.isVisible().catch(() => false)) {
            await fallbackBtn.click()
            lastProgress = Date.now()
            await waitForTrailerValidationSettle(page, AFTER_CLICK_MS)
          }
        }

        handled = true
        break
      }
    }

    if (handled) continue

    // --- Fallback: Check for inputs by placeholder (legacy) ---
    const n = await page.locator('input:visible').count()
    for (let i = 0; i < n; i++) {
      aborted()
      const el = page.locator('input:visible').nth(i)
      const ph = (await el.getAttribute('placeholder').catch(() => '')) || ''
      if (!ph || /search|filter/i.test(ph)) continue
      const vis = await el.isVisible().catch(() => false)
      if (!vis) continue

      const upper = ph.toUpperCase()

      // Seal by placeholder — swap-aware: try all known seals per-trailer
      if (/SEAL/i.test(upper) && /TRAILER|TRLR|\d/.test(upper)) {
        const trailerIndex = extractTrailerIndex(ph)
        const tried = getTriedSeals(trailerIndex)
        const sealCandidates = getSealCandidates(tripDataEffective, trailerIndex - 1)
        const untried = sealCandidates.filter((s) => !tried.has(s))

        let validationSuccess = false

        for (const candidate of untried) {
          tried.add(candidate)
          await el.fill(candidate)
          log('info', `Trying seal (placeholder): ${candidate} for Trailer ${trailerIndex}`)

          const btn = buttonLikeByVisibleText(page, RX.validateSeal).first()
          if (await btn.isVisible().catch(() => false)) {
            await btn.click()
            lastProgress = Date.now()
            await waitForSealValidationSettle(page, SEAL_VALIDATION_WAIT_MS)
          }

          if (await hasInvalidSealError(page)) {
            log('warn', `Invalid seal: ${candidate} for Trailer ${trailerIndex}`)
            await el.clear()
            await page.waitForTimeout(110)
            continue
          }

          validationSuccess = true
          break
        }

        if (!validationSuccess) {
          log('info', `All seal candidates exhausted for Trailer ${trailerIndex} — prompting driver`)
          const val = (
            await waitForInspectField({
              field: `trailer${trailerIndex}_seal`,
              message: buildPromptMessage('seal', trailerIndex),
            })
          ).trim()
          if (!val) throw new Error(`Inspect: seal required for Trailer ${trailerIndex}`)
          await el.fill(val)
          const btn = buttonLikeByVisibleText(page, RX.validateSeal).first()
          if (await btn.isVisible().catch(() => false)) {
            await btn.click()
            lastProgress = Date.now()
            await waitForSealValidationSettle(page, AFTER_CLICK_MS)
          }
        }

        handled = true
        break
      }

      // Trailer number by placeholder (empties — use pre-entered, then prompt)
      if (
        (/TRAILER|TRLR|EMPTY/i.test(upper) && /NUMBER|NBR|NO\.?/i.test(upper) && !/SEAL/i.test(upper)) ||
        (/EMPTY/i.test(upper) && /LOAD/i.test(upper))
      ) {
        const trailerIndex = extractTrailerIndex(ph)
        const preEntered = preEnteredTrailerNbrs.get(trailerIndex) || ''
        let val = preEntered
        if (val) {
          log('info', `Using pre-entered trailer number (placeholder) for Trailer ${trailerIndex}: ${val}`)
        } else {
          val = (
            await waitForInspectField({
              field: `trailer${trailerIndex}_number`,
              message: buildPromptMessage('trailerNumber', trailerIndex),
            })
          ).trim()
        }
        if (!val) throw new Error(`Inspect: trailer number required for Trailer ${trailerIndex}`)
        await el.fill(val)
        log('info', `Filled trailer number (placeholder): ${val}`)

        const submit = page.getByRole('button', { name: /validate|submit|continue|next/i }).first()
        if (await submit.isVisible().catch(() => false)) {
          await submit.click()
          lastProgress = Date.now()
          await waitForTrailerValidationSettle(page, AFTER_CLICK_MS)
        }

        handled = true
        break
      }
    }

    if (handled) continue

    // Idle exit — report failure if dispatch was never completed
    if (
      checklistDone &&
      !dispatchClicked &&
      checklistCompletedAt &&
      Date.now() - checklistCompletedAt > POST_CHECKLIST_IDLE_MS
    ) {
      log('warn', 'Inspect & Check Out: timed out after checklist — DISPATCH button was never clicked', {
        inspectCheckoutPhaseDone: true,
        dispatched: false,
      })
      return { ok: false, reason: 'dispatch_not_clicked', proofScreenshots }
    }

    if (Date.now() - lastProgress > IDLE_EXIT_MS) {
      if (checklistDone && !dispatchClicked) {
        log('warn', 'Inspect & Check Out: timed out after checklist — DISPATCH button was never clicked', {
          inspectCheckoutPhaseDone: true,
          dispatched: false,
        })
        return { ok: false, reason: 'dispatch_not_clicked', proofScreenshots }
      }
      if (dispatchClicked) {
        log('warn', 'Inspect & Check Out: timed out after clicking DISPATCH — "You are Dispatched!" never appeared', {
          inspectCheckoutPhaseDone: true,
          dispatched: false,
        })
        return { ok: false, reason: 'dispatch_not_confirmed', proofScreenshots }
      }
      log('info', 'Inspect & Check Out: no recognized screen for idle window — completing', {
        inspectCheckoutPhaseDone: true,
      })
      return { ok: true, reason: 'idle', proofScreenshots }
    }
  }
}
