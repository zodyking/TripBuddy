import { describe, it, expect } from 'vitest'
import {
  federalHolidayDateKeysForYear,
  isUsFederalHolidayMs,
  localDateKeyFromMs,
} from './usFederalHolidays.js'

describe('usFederalHolidays', () => {
  it('includes observed New Year when Jan 1 is Saturday', () => {
    const keys2027 = federalHolidayDateKeysForYear(2027)
    expect(keys2027.has('2026-12-31')).toBe(true)
  })

  it('detects Independence Day on calendar day and observed Friday', () => {
    const satJuly4 = new Date(2026, 6, 4, 12, 0, 0, 0).getTime()
    expect(isUsFederalHolidayMs(satJuly4)).toBe(true)
    expect(localDateKeyFromMs(satJuly4)).toBe('2026-07-04')
    const friObserved = new Date(2026, 6, 3, 12, 0, 0, 0).getTime()
    expect(isUsFederalHolidayMs(friObserved)).toBe(true)
  })

  it('detects Thanksgiving (4th Thursday of November)', () => {
    const thanks2025 = new Date(2025, 10, 27, 12, 0, 0, 0).getTime()
    expect(isUsFederalHolidayMs(thanks2025)).toBe(true)
  })
})
