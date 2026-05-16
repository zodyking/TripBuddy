import { FORM_FALLBACK } from '../selectors.mjs'

async function firstMatchingInput(page, hints) {
  for (const sel of hints) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return loc
    }
  }
  return null
}

/**
 * @param {import('playwright').Page} page
 * @param {{ orderedValues?: string[], dolly?: string, field1?: string, field2?: string }} data
 */
export async function fillInspectCheckoutForm(page, data, log) {
  await page.waitForTimeout(100)

  let ordered =
    Array.isArray(data.orderedValues) && data.orderedValues.length > 0
      ? data.orderedValues.map((v) => (v == null ? '' : String(v)))
      : [
          data.dolly == null ? '' : String(data.dolly),
          data.field1 == null ? '' : String(data.field1),
          data.field2 == null ? '' : String(data.field2),
        ]

  const all = page.locator('input:not([type="hidden"]):visible')
  const count = await all.count()

  if (count === 0 && ordered.some((x) => x !== '')) {
    const loc =
      (await firstMatchingInput(page, FORM_FALLBACK.dolly)) ?? all.first()
    if ((await loc.count()) > 0) {
      await loc.fill(ordered[0] ?? '')
      log('info', 'Filled first visible input (fallback)')
    }
  } else {
    const n = Math.min(ordered.length, count)
    for (let i = 0; i < n; i++) {
      await all.nth(i).fill(ordered[i])
      log('info', `Filled field ${i + 1} of ${n}`)
    }
  }

  const submit = page.getByRole('button', { name: /submit|continue|next|save|confirm|done/i }).first()
  if (await submit.isVisible().catch(() => false)) {
    await submit.click()
    log('info', 'Clicked primary action after fill')
  }
}
