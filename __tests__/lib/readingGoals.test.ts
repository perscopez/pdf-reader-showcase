import { describe, expect, it } from 'vitest'
import { computeStreak, formatReadingDay, goalProgressPercent } from '@/lib/readingGoals'

describe('readingGoals', () => {
  it('formats reading days as YYYY-MM-DD', () => {
    expect(formatReadingDay(new Date(2026, 6, 6))).toBe('2026-07-06')
  })

  it('computes streak when today has reading', () => {
    const today = formatReadingDay(new Date(2026, 6, 6))
    const yesterday = formatReadingDay(new Date(2026, 6, 5))
    expect(computeStreak([today, yesterday], new Date(2026, 6, 6))).toBe(2)
  })

  it('computes streak when only yesterday has reading', () => {
    const yesterday = formatReadingDay(new Date(2026, 6, 5))
    expect(computeStreak([yesterday], new Date(2026, 6, 6))).toBe(1)
  })

  it('returns zero when streak is broken', () => {
    const old = formatReadingDay(new Date(2026, 6, 1))
    expect(computeStreak([old], new Date(2026, 6, 6))).toBe(0)
  })

  it('calculates goal progress percent', () => {
    expect(goalProgressPercent(900, 30)).toBe(50)
    expect(goalProgressPercent(3600, 30)).toBe(100)
  })
})
