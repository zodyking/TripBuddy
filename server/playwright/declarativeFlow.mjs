import { DISPATCH_ENTRY_URL } from '../config.mjs'
import { clickMenuIfEnabled } from './pages/dispatchHome.mjs'

/**
 * @param {import('playwright').Page} page
 * @param {object[]} steps
 * @param {{
 *   log: (type: string, message: string, extra?: object) => void
 *   signal?: AbortSignal
 *   runBuiltin: (name: string) => Promise<void>
 * }} ctx
 */
export async function runDeclarativeSteps(page, steps, ctx) {
  const { log, signal, runBuiltin } = ctx
  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) throw new Error('Aborted')
    const step = steps[i]
    log('detail', `Custom flow step ${i + 1}/${steps.length}: ${step.op}`)
    switch (step.op) {
      case 'goto': {
        const url =
          step.url === 'dispatch_entry' ? DISPATCH_ENTRY_URL : step.url
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 120_000,
        })
        break
      }
      case 'waitMs':
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, step.ms)
          if (!signal) return
          const onAbort = () => {
            clearTimeout(t)
            reject(new Error('Aborted'))
          }
          signal.addEventListener('abort', onAbort, { once: true })
        })
        break
      case 'waitLoadState':
        await page.waitForLoadState(step.state, { timeout: 60_000 })
        break
      case 'clickMenu':
        await clickMenuIfEnabled(page, step.key, log)
        break
      case 'fill':
        await page
          .locator(step.selector)
          .first()
          .fill(step.value, { timeout: 30_000 })
        break
      case 'click':
        await page
          .locator(step.selector)
          .first()
          .click({ timeout: 30_000 })
        break
      case 'pressKey':
        await page.keyboard.press(step.key)
        break
      case 'builtin':
        await runBuiltin(step.name)
        break
      default:
        throw new Error(`Unsupported flow op: ${step.op}`)
    }
  }
}
