/**
 * Inspect & Check Out — Smart automation with label-based field detection,
 * seal fallback logic, and complete dispatch flow.
 *
 * Key improvements:
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

/** FedEx copy patterns — tune if the app changes. */
const RX = {
  warningTitle: /warning/i,
  acknowledgeBtn: /acknowledge/i,
  checkInSuccessful: /check\s+in\s+successful/i,
  beginInspection: /begin\s+inspection/i,
  validateDolly: /validate\s+dolly/i,
  dollyValidationOk: /dolly\s+validation\s+successful/i,
  validateSeals: /validate\s+seals/i,
  validateSeal: /validate\s+seal/i,
  validateMtTrailer: /validate\s+mt\s+trailer/i,
  invalidSealNumber: /invalid\s+seal\s+number/i,
  agreeAndCheckOut: /agree\s+and\s+check\s+out/i,
  dispatch: /^dispatch$/i,
  dispatchConfirmYes: /^yes$/i,
  youAreDispatched: /you\s+are\s+dispatched/i,
  goToHome: /go\s+to\s+home/i,
  checkOffItems: /check\s+off\s+items/i,
  dispatchSummary: /dispatch\s+summary/i,
  reviewStartTrip: /review\s+and\s+start\s+trip/i,
}

const WARN_MODAL_MS = 4_000
const BEGIN_INSPECTION_MS = 20_000
const AFTER_CLICK_MS = 2_500
const IDLE_EXIT_MS = 18_000
const POLL_MS = 450
const MAX_DOLLY_ATTEMPTS = 6
const DOLLY_SUCCESS_WAIT_MS = 18_000
const SEAL_VALIDATION_WAIT_MS = 4_000
const CHECKLIST_CHECKBOX_DELAY_MS = 150
const DISPATCH_CONFIRM_WAIT_MS = 10_000
const DISPATCHED_SUCCESS_WAIT_MS = 15_000

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
 * @param {import('playwright').Locator} loc
 * @param {number} timeout
 */
async function clickIfVisible(loc, timeout = 1_500) {
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
 * Optional TSPA warning — dismiss with ACKNOWLEDGE.
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 */
export async function dismissInspectWarningIfPresent(page, log) {
  const deadline = Date.now() + WARN_MODAL_MS
  while (Date.now() < deadline) {
    const warnText = page.getByText(RX.warningTitle).first()
    const hasWarn = await warnText.isVisible().catch(() => false)
    if (!hasWarn) {
      await page.waitForTimeout(200)
      continue
    }
    const ack = buttonLikeByVisibleText(page, RX.acknowledgeBtn).first()
    if (await ack.isVisible().catch(() => false)) {
      await ack.click()
      log('info', 'Dismissed Inspect warning (ACKNOWLEDGE)')
      await page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {})
      await page.waitForTimeout(400)
      return
    }
    await page.waitForTimeout(200)
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
      await page.waitForLoadState('domcontentloaded', { timeout: 12_000 }).catch(() => {})
      await page.waitForTimeout(500)
      return
    }
    const anyBegin = await page.getByText(RX.beginInspection).first().isVisible().catch(() => false)
    if (anyBegin) {
      await clickIfVisible(buttonLikeByVisibleText(page, RX.beginInspection))
      log('info', 'Clicked Begin Inspection (relaxed match)')
      await page.waitForTimeout(500)
      return
    }
    await page.waitForTimeout(300)
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
 * Check if we're on the Review and Start Trip / Dispatch Summary screen (primary DISPATCH action).
 * @param {import('playwright').Page} page
 */
async function isDispatchScreen(page) {
  const dispatchRole = page.getByRole('button', { name: /^dispatch$/i }).first()
  if (await dispatchRole.isVisible().catch(() => false)) return true
  const dispatchBtn = buttonLikeByVisibleText(page, RX.dispatch).first()
  if (await dispatchBtn.isVisible().catch(() => false)) return true
  const summaryHint =
    (await page.getByText(RX.dispatchSummary).first().isVisible().catch(() => false)) ||
    (await page.getByText(RX.reviewStartTrip).first().isVisible().catch(() => false))
  if (summaryHint) {
    const loose = page.getByRole('button', { name: /dispatch/i }).first()
    return await loose.isVisible().catch(() => false)
  }
  return false
}

/**
 * Check if dispatch confirmation modal is visible.
 * @param {import('playwright').Page} page
 */
async function isDispatchConfirmModal(page) {
  const modalText = page.getByText(/do you wish to dispatch/i).first()
  const hasModal = await modalText.isVisible().catch(() => false)
  if (!hasModal) return false
  const yesRole = page.getByRole('button', { name: /^yes$/i }).first()
  if (await yesRole.isVisible().catch(() => false)) return true
  const yesBtn = buttonLikeByVisibleText(page, RX.dispatchConfirmYes).first()
  return await yesBtn.isVisible().catch(() => false)
}

/**
 * @param {import('playwright').Page} page
 */
async function clickDispatchButton(page) {
  const dispatchRole = page.getByRole('button', { name: /^dispatch$/i }).first()
  if (await dispatchRole.isVisible().catch(() => false)) {
    await dispatchRole.click()
    return
  }
  await buttonLikeByVisibleText(page, RX.dispatch).first().click()
}

/**
 * @param {import('playwright').Page} page
 */
async function clickDispatchConfirmYes(page) {
  const yesRole = page.getByRole('button', { name: /^yes$/i }).first()
  if (await yesRole.isVisible().catch(() => false)) {
    await yesRole.click()
    return
  }
  await buttonLikeByVisibleText(page, RX.dispatchConfirmYes).first().click()
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
 * Click all unchecked checkboxes in the inspection checklist.
 * @param {import('playwright').Page} page
 * @param {(type: string, message: string, extra?: object) => void} log
 */
async function completeInspectionChecklist(page, log) {
  const checkboxes = page.locator('input[type="checkbox"]:visible')
  const count = await checkboxes.count()
  let clicked = 0

  for (let i = 0; i < count; i++) {
    const checkbox = checkboxes.nth(i)
    const isChecked = await checkbox.isChecked().catch(() => false)
    if (!isChecked) {
      await checkbox.click().catch(() => {})
      clicked++
      await page.waitForTimeout(CHECKLIST_CHECKBOX_DELAY_MS)
    }
  }

  log('info', `Clicked ${clicked} checkboxes in inspection checklist`)
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
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runInspectCheckoutAfterGate(page, opts) {
  const { log, signal, assignment = {}, tripData = {}, waitForInspectField } = opts

  const tripDataEffective = {
    ...buildTripDataFromAssignment(assignment),
    ...(tripData && typeof tripData === 'object' ? tripData : {}),
  }

  // Track used seal candidates to avoid re-trying
  const triedSeals = new Set()
  let lastProgress = Date.now()
  let dollyAttempts = 0

  const aborted = () => {
    if (signal?.aborted) throw new Error('Aborted')
  }

  await dismissInspectWarningIfPresent(page, log)
  await clickBeginInspectionIfPresent(page, log)

  for (;;) {
    aborted()
    await page.waitForTimeout(POLL_MS)

    // --- Check for "You are Dispatched!" success ---
    if (await isDispatchedSuccessScreen(page)) {
      log('info', 'Inspect & Check Out complete: You are Dispatched!', {
        inspectCheckoutPhaseDone: true,
        dispatched: true,
      })
      return { ok: true, reason: 'dispatched' }
    }

    // --- Dispatch confirmation modal (YES/NO) ---
    if (await isDispatchConfirmModal(page)) {
      await clickDispatchConfirmYes(page)
      log('info', 'Clicked YES on dispatch confirmation')
      lastProgress = Date.now()
      await page.waitForTimeout(AFTER_CLICK_MS)

      // Wait for dispatched success
      const t0 = Date.now()
      while (Date.now() - t0 < DISPATCHED_SUCCESS_WAIT_MS) {
        aborted()
        if (await isDispatchedSuccessScreen(page)) {
          log('info', 'Inspect & Check Out complete: You are Dispatched!', {
            inspectCheckoutPhaseDone: true,
            dispatched: true,
          })
          return { ok: true, reason: 'dispatched' }
        }
        await page.waitForTimeout(POLL_MS)
      }
      continue
    }

    // --- Dispatch screen (Review and Start Trip / Dispatch Summary) ---
    if (await isDispatchScreen(page)) {
      await clickDispatchButton(page)
      log('info', 'Clicked DISPATCH button')
      lastProgress = Date.now()
      await page.waitForTimeout(AFTER_CLICK_MS)
      continue
    }

    // --- Inspection checklist screen ---
    if (await isInspectionChecklistScreen(page)) {
      await completeInspectionChecklist(page, log)
      await page.waitForTimeout(500)

      const agreeBtn = buttonLikeByVisibleText(page, RX.agreeAndCheckOut).first()
      if (await agreeBtn.isVisible().catch(() => false)) {
        await agreeBtn.click()
        log('info', 'Clicked AGREE AND CHECK OUT')
        lastProgress = Date.now()
        await page.waitForTimeout(AFTER_CLICK_MS)
      }
      continue
    }

    // --- Dolly validation success → VALIDATE SEALS ---
    if (await isDollySuccessScreen(page)) {
      const vs = buttonLikeByVisibleText(page, RX.validateSeals).first()
      if (await vs.isVisible().catch(() => false)) {
        await vs.click()
        log('info', 'Clicked VALIDATE SEALS after dolly success')
        lastProgress = Date.now()
        await page.waitForTimeout(AFTER_CLICK_MS)
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
        await page.waitForTimeout(AFTER_CLICK_MS)
        continue
      }
    }

    // --- Dolly entry ---
    if (await isDollyEntryScreen(page)) {
      dollyAttempts += 1
      if (dollyAttempts > MAX_DOLLY_ATTEMPTS) {
        throw new Error('Inspect: dolly validation failed too many times')
      }

      // Get dolly candidates from trip data
      const dollyCandidates = getDollyCandidates(tripDataEffective)
      let val = dollyCandidates[0] || ''

      // If no dolly in trip data, prompt driver
      if (!val) {
        val = (
          await waitForInspectField({
            field: 'dolly',
            message: buildPromptMessage('dolly', 0),
          })
        ).trim()
      }

      if (!val) {
        throw new Error('Inspect: dolly number required')
      }

      const dollyInput = await findInputByLabel(page, /dolly/i)
      if (dollyInput?.input) {
        await dollyInput.input.fill(val)
      }
      log('info', `Filled dolly number: ${val}`)

      const vd = buttonLikeByVisibleText(page, RX.validateDolly).first()
      await vd.click()
      lastProgress = Date.now()
      await page.waitForTimeout(AFTER_CLICK_MS)

      const t0 = Date.now()
      let advanced = false
      while (Date.now() - t0 < DOLLY_SUCCESS_WAIT_MS) {
        aborted()
        if (await isDollySuccessScreen(page)) {
          advanced = true
          lastProgress = Date.now()
          break
        }
        if (!(await isDollyEntryScreen(page))) {
          advanced = true
          lastProgress = Date.now()
          break
        }
        await page.waitForTimeout(350)
      }

      if (!advanced && (await isDollyEntryScreen(page))) {
        log('warn', 'Dolly validation did not advance — prompting for re-entry')
        val = (
          await waitForInspectField({
            field: 'dolly',
            message: 'Dolly validation failed. Please re-enter dolly number.',
          })
        ).trim()
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
      if (batchSeals) {
        let filledAny = false
        for (const row of sealRows) {
          aborted()
          const trailerIndex = row.trailerIndex
          const sealCandidates = getSealCandidates(tripDataEffective, trailerIndex - 1)
          let val = sealCandidates[0] || ''
          if (!val) {
            val = (
              await waitForInspectField({
                field: `trailer${trailerIndex}_seal`,
                message: buildPromptMessage('seal', trailerIndex),
              })
            ).trim()
          }
          if (!val) throw new Error(`Inspect: seal required for Trailer ${trailerIndex}`)
          await row.input.fill(val)
          triedSeals.add(val)
          filledAny = true
          log('info', `Batch seal pre-fill Trailer ${trailerIndex}`)
        }
        if (filledAny) {
          const clickedValidate = await clickSealValidateButton(page)
          if (clickedValidate) {
            log('info', 'Clicked seal validation after batch trailer seal fill')
            lastProgress = Date.now()
            await page.waitForTimeout(Math.max(SEAL_VALIDATION_WAIT_MS, 2_000))
            if (!(await hasInvalidSealError(page))) {
              continue
            }
            log('warn', 'Batch seal validation failed — retrying with per-field handling')
          }
        }
      }
    }

    // --- Batch empty-trailer numbers (multiple fields, one validate) ---
    if (!(await isDollyEntryScreen(page))) {
      const trailerRows = await collectVisibleTrailerNumberInputs(page)
      const vmtBtn = buttonLikeByVisibleText(page, RX.validateMtTrailer).first()
      const batchMt =
        trailerRows.length >= 2 ||
        (trailerRows.length >= 1 && (await vmtBtn.isVisible().catch(() => false)))
      if (batchMt) {
        for (const row of trailerRows) {
          aborted()
          const trailerIndex = row.trailerIndex
          log('info', `Empty trailer batch — prompting for Trailer ${trailerIndex} number`)
          const val = (
            await waitForInspectField({
              field: `trailer${trailerIndex}_number`,
              message: buildPromptMessage('trailerNumber', trailerIndex),
            })
          ).trim()
          if (!val) throw new Error(`Inspect: trailer number required for Trailer ${trailerIndex}`)
          await row.input.fill(val)
        }
        if (await vmtBtn.isVisible().catch(() => false)) {
          await vmtBtn.click()
          log('info', 'Clicked VALIDATE MT TRAILER after batch trailer numbers')
          lastProgress = Date.now()
          await page.waitForTimeout(AFTER_CLICK_MS)
          continue
        }
        const fallbackBtn = page
          .getByRole('button', { name: /validate|submit|continue|next/i })
          .first()
        if (await fallbackBtn.isVisible().catch(() => false)) {
          await fallbackBtn.click()
          lastProgress = Date.now()
          await page.waitForTimeout(AFTER_CLICK_MS)
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

      // --- SEAL NUMBER (loaded trailers) ---
      if (detected.type === 'seal') {
        const trailerIndex = detected.trailerIndex
        const sealCandidates = getSealCandidates(tripDataEffective, trailerIndex - 1)

        // Filter out already-tried seals
        const untried = sealCandidates.filter((s) => !triedSeals.has(s))

        let val = ''
        let validationSuccess = false

        // Try each seal candidate
        for (const candidate of untried) {
          triedSeals.add(candidate)
          await input.fill(candidate)
          log('info', `Trying seal candidate: ${candidate} for Trailer ${trailerIndex}`)

          const validateBtn = buttonLikeByVisibleText(page, RX.validateSeal).first()
          if (await validateBtn.isVisible().catch(() => false)) {
            await validateBtn.click()
            lastProgress = Date.now()
            await page.waitForTimeout(SEAL_VALIDATION_WAIT_MS)
          }

          // Check for error
          if (await hasInvalidSealError(page)) {
            log('warn', `Invalid seal number: ${candidate} — trying next`)
            await input.clear()
            await page.waitForTimeout(500)
            continue
          }

          // Success - seal was accepted
          val = candidate
          validationSuccess = true
          log('info', `Seal validated successfully: ${candidate}`)
          break
        }

        // If all candidates failed, prompt driver as last resort
        if (!validationSuccess) {
          log('info', 'All seal candidates exhausted — prompting driver')
          val = (
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
            log('info', `Clicked VALIDATE SEAL with driver-provided value: ${val}`)
            lastProgress = Date.now()
            await page.waitForTimeout(AFTER_CLICK_MS)
          }
        }

        handled = true
        break
      }

      // --- TRAILER NUMBER (empty trailers - always prompt driver) ---
      if (detected.type === 'trailerNumber') {
        const trailerIndex = detected.trailerIndex
        log('info', `Empty trailer detected — prompting for Trailer ${trailerIndex} number`)

        const val = (
          await waitForInspectField({
            field: `trailer${trailerIndex}_number`,
            message: buildPromptMessage('trailerNumber', trailerIndex),
          })
        ).trim()

        if (!val) throw new Error(`Inspect: trailer number required for Trailer ${trailerIndex}`)

        await input.fill(val)
        log('info', `Filled trailer number: ${val}`)

        // Click VALIDATE MT TRAILER button
        const validateBtn = buttonLikeByVisibleText(page, RX.validateMtTrailer).first()
        if (await validateBtn.isVisible().catch(() => false)) {
          await validateBtn.click()
          log('info', 'Clicked VALIDATE MT TRAILER')
          lastProgress = Date.now()
          await page.waitForTimeout(AFTER_CLICK_MS)
        } else {
          // Fallback to generic validate/submit button
          const fallbackBtn = page
            .getByRole('button', { name: /validate|submit|continue|next/i })
            .first()
          if (await fallbackBtn.isVisible().catch(() => false)) {
            await fallbackBtn.click()
            lastProgress = Date.now()
            await page.waitForTimeout(AFTER_CLICK_MS)
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

      // Seal by placeholder
      if (/SEAL/i.test(upper) && /TRAILER|TRLR|\d/.test(upper)) {
        const trailerIndex = extractTrailerIndex(ph)
        const sealCandidates = getSealCandidates(tripDataEffective, trailerIndex - 1)
        const untried = sealCandidates.filter((s) => !triedSeals.has(s))

        let validationSuccess = false

        for (const candidate of untried) {
          triedSeals.add(candidate)
          await el.fill(candidate)
          log('info', `Trying seal (placeholder): ${candidate}`)

          const btn = buttonLikeByVisibleText(page, RX.validateSeal).first()
          if (await btn.isVisible().catch(() => false)) {
            await btn.click()
            lastProgress = Date.now()
            await page.waitForTimeout(SEAL_VALIDATION_WAIT_MS)
          }

          if (await hasInvalidSealError(page)) {
            log('warn', `Invalid seal: ${candidate}`)
            await el.clear()
            await page.waitForTimeout(500)
            continue
          }

          validationSuccess = true
          break
        }

        if (!validationSuccess) {
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
            await page.waitForTimeout(AFTER_CLICK_MS)
          }
        }

        handled = true
        break
      }

      // Trailer number by placeholder (empties)
      if (
        (/TRAILER|TRLR|EMPTY/i.test(upper) && /NUMBER|NBR|NO\.?/i.test(upper) && !/SEAL/i.test(upper)) ||
        (/EMPTY/i.test(upper) && /LOAD/i.test(upper))
      ) {
        const trailerIndex = extractTrailerIndex(ph)
        const val = (
          await waitForInspectField({
            field: `trailer${trailerIndex}_number`,
            message: buildPromptMessage('trailerNumber', trailerIndex),
          })
        ).trim()
        if (!val) throw new Error(`Inspect: trailer number required for Trailer ${trailerIndex}`)
        await el.fill(val)
        log('info', `Filled trailer number (placeholder): ${val}`)

        const submit = page.getByRole('button', { name: /validate|submit|continue|next/i }).first()
        if (await submit.isVisible().catch(() => false)) {
          await submit.click()
          lastProgress = Date.now()
          await page.waitForTimeout(AFTER_CLICK_MS)
        }

        handled = true
        break
      }
    }

    if (handled) continue

    // Idle exit
    if (Date.now() - lastProgress > IDLE_EXIT_MS) {
      log('info', 'Inspect & Check Out: no recognized screen for idle window — completing', {
        inspectCheckoutPhaseDone: true,
      })
      return { ok: true, reason: 'idle' }
    }
  }
}
