import { cancelRun, isRunnerBusy } from './runner.mjs'
import { cancelBlockRun, isBlockRunnerBusy } from './blocks.mjs'
import { closeContext } from './browser.mjs'

export function isAnyPlaywrightRunnerBusy() {
  return isRunnerBusy() || isBlockRunnerBusy()
}

/** Abort scenario runner and block automation runner. */
export function cancelAllPlaywrightRuns() {
  cancelRun()
  cancelBlockRun()
}

/**
 * Wait until both runners have finished teardown (browser closed in their finally blocks).
 * @param {number} [maxMs]
 * @returns {Promise<boolean>} true when idle
 */
export async function waitForPlaywrightIdle(maxMs = 15_000) {
  const deadline = Date.now() + maxMs
  while (isAnyPlaywrightRunnerBusy() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  if (!isAnyPlaywrightRunnerBusy()) return true

  try {
    await closeContext()
  } catch {
    /* ignore */
  }

  const forceDeadline = Date.now() + 2_000
  while (isAnyPlaywrightRunnerBusy() && Date.now() < forceDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  return !isAnyPlaywrightRunnerBusy()
}
