/**
 * Inspect & Check Out — steps after the home gate (warning, begin inspection, dolly/seals/trailer).
 * Uses visible text and placeholders; buttons via textLocators when role/name is unreliable.
 */

import { buttonLikeByVisibleText } from './textLocators.mjs'

/** FedEx copy — tune if the app changes. */
const RX = {
  warningTitle: /warning/i,
  acknowledgeBtn: /acknowledge/i,
  checkInSuccessful: /check\s+in\s+successful/i,
  beginInspection: /begin\s+inspection/i,
  validateDolly: /validate\s+dolly/i,
  dollyValidationOk: /dolly\s+validation\s+successful/i,
  validateSeals: /validate\s+seals/i,
  validateSeal: /validate\s+seal/i,
}

const WARN_MODAL_MS = 4_000
const BEGIN_INSPECTION_MS = 20_000
const AFTER_CLICK_MS = 2_500
const IDLE_EXIT_MS = 12_000
const POLL_MS = 450
const MAX_DOLLY_ATTEMPTS = 6
const DOLLY_SUCCESS_WAIT_MS = 18_000

/**
 * @param {import('playwright').Page} page
 * @param {RegExp} re
 */
async function firstVisiblePlaceholderInput(page, re) {
  const loc = page.locator('input:visible, textarea:visible')
  const n = await loc.count()
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i)
    const ph = (await el.getAttribute('placeholder').catch(() => '')) || ''
    if (ph && re.test(ph)) {
      const vis = await el.isVisible().catch(() => false)
      if (vis) return el
    }
  }
  return null
}

/**
 * @param {unknown} assignment
 * @returns {string}
 */
function dollySlotId(assignment) {
  const slots = Array.isArray(assignment?.photoSlots) ? assignment.photoSlots : []
  const d = slots.find((s) => s && s.kind === 'dolly')
  return typeof d?.id === 'string' ? d.id : 'dolly'
}

/**
 * @param {unknown} assignment
 * @param {number} trailerIndex 1-based
 * @param {'seal' | 'trailer'} kind
 * @returns {string}
 */
function slotIdForTrailer(assignment, trailerIndex, kind) {
  const slots = Array.isArray(assignment?.photoSlots) ? assignment.photoSlots : []
  const ofKind = slots.filter((s) => s && s.kind === kind)
  const slot = ofKind[trailerIndex - 1]
  if (slot && typeof slot.id === 'string') return slot.id
  return `trailer${trailerIndex}`
}

/**
 * @param {string} ph
 * @returns {number}
 */
function trailerIndexFromPlaceholder(ph) {
  const u = String(ph).toUpperCase()
  const m = u.match(/TRAILER\s*(\d+)/) || u.match(/^(\d+)\s*[—\-]/)
  return m ? parseInt(m[1], 10) : 1
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
  const phIn = await firstVisiblePlaceholderInput(page, /dolly/i)
  if (!phIn) return false
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
 * Run post-gate Inspect & Check Out until idle (no recognized screen) or abort.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts
 * @param {(type: string, message: string, extra?: object) => void} opts.log
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.runId]
 * @param {unknown} [opts.assignment]
 * @param {(o: { field: string, message: string }) => Promise<string>} opts.waitForInspectField
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runInspectCheckoutAfterGate(page, opts) {
  const { log, signal, assignment = {}, waitForInspectField } = opts

  const baseFv =
    assignment.fieldValues && typeof assignment.fieldValues === 'object'
      ? /** @type {Record<string, string>} */ (assignment.fieldValues)
      : {}
  /** Mutable copy so user prompts can persist for this run. */
  const fv = { ...baseFv }

  await dismissInspectWarningIfPresent(page, log)
  await clickBeginInspectionIfPresent(page, log)

  let lastProgress = Date.now()
  let dollyAttempts = 0

  const aborted = () => {
    if (signal?.aborted) throw new Error('Aborted')
  }

  for (;;) {
    aborted()
    await page.waitForTimeout(POLL_MS)

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
      const slot = dollySlotId(assignment)
      let val = String(fv[slot] ?? '').trim()
      if (!val) {
        val = (
          await waitForInspectField({
            field: 'dolly',
            message: 'Enter dolly number for Inspect & Check Out (not saved in Assignment).',
          })
        ).trim()
        if (val) fv[slot] = val
      }
      if (!val) {
        throw new Error('Inspect: dolly number required')
      }
      const inp = await firstVisiblePlaceholderInput(page, /dolly/i)
      if (inp) await inp.fill(val)
      log('info', 'Filled dolly number')
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
        log('warn', 'Dolly validation did not advance — re-enter dolly number')
        val = (
          await waitForInspectField({
            field: 'dolly',
            message: 'Dolly validation did not succeed. Re-enter dolly number.',
          })
        ).trim()
        if (val) fv[slot] = val
      }
      continue
    }

    // --- Seal or trailer number by placeholder ---
    const n = await page.locator('input:visible').count()
    let handled = false
    for (let i = 0; i < n; i++) {
      aborted()
      const el = page.locator('input:visible').nth(i)
      const ph = (await el.getAttribute('placeholder').catch(() => '')) || ''
      if (!ph || /search|filter/i.test(ph)) continue
      const vis = await el.isVisible().catch(() => false)
      if (!vis) continue

      const upper = ph.toUpperCase()

      // Seal
      if (/SEAL/i.test(upper) && /TRAILER|TRLR|\d/.test(upper)) {
        const idx = trailerIndexFromPlaceholder(ph)
        const slot = slotIdForTrailer(assignment, idx, 'seal')
        let val = String(fv[slot] ?? '').trim()
        if (!val) {
          val = (
            await waitForInspectField({
              field: slot,
              message: `Enter seal for ${slot} (not in Assignment field values).`,
            })
          ).trim()
          if (val) fv[slot] = val
        }
        if (!val) throw new Error(`Inspect: seal required for ${slot}`)
        await el.fill(val)
        log('info', `Filled seal field (${slot})`)
        const btn = buttonLikeByVisibleText(page, RX.validateSeal).first()
        if (await btn.isVisible().catch(() => false)) {
          await btn.click()
          log('info', 'Clicked VALIDATE SEAL')
          lastProgress = Date.now()
          await page.waitForTimeout(AFTER_CLICK_MS)
        }
        handled = true
        break
      }

      // Trailer number (empties / non-seal)
      if (
        (/TRAILER|TRLR|EMPTY/i.test(upper) && /NUMBER|NBR|NO\.?/i.test(upper) && !/SEAL/i.test(upper)) ||
        (/EMPTY/i.test(upper) && /LOAD/i.test(upper))
      ) {
        const idx = trailerIndexFromPlaceholder(ph)
        const slot = slotIdForTrailer(assignment, idx, 'trailer')
        let val = String(fv[slot] ?? '').trim()
        if (!val) {
          val = (
            await waitForInspectField({
              field: slot,
              message: `Enter trailer number for ${slot} (empties / not in Assignment).`,
            })
          ).trim()
          if (val) fv[slot] = val
        }
        if (!val) throw new Error(`Inspect: trailer number required for ${slot}`)
        await el.fill(val)
        log('info', `Filled trailer number (${slot})`)
        const submit = page
          .getByRole('button', {
            name: /validate|submit|continue|next/i,
          })
          .first()
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
