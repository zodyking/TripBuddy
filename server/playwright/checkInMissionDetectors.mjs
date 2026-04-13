/**
 * Page-text detectors for check-in completion (no sign-out).
 * Order: new trip (trip summary + Begin inspection) → trip ready (summary only) → plain success.
 */

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<'new_trip' | 'trip_ready' | 'plain_success' | null>}
 */
export async function detectCheckInMissionPageState(page) {
  try {
    const body = await page.locator('body').innerText({ timeout: 8_000 })
    const lower = body.toLowerCase()
    if (!lower.includes('check in successful')) return null

    const hasTripSummary = lower.includes('trip summary')
    const beginInspection = page.getByRole('button', { name: /begin inspection/i })
    const beginVisible = await beginInspection.first().isVisible().catch(() => false)

    if (hasTripSummary && beginVisible) return 'new_trip'
    if (hasTripSummary) return 'trip_ready'
    return 'plain_success'
  } catch {
    return null
  }
}
