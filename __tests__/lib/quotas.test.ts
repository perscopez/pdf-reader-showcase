import { describe, it, expect, beforeAll } from 'vitest'
import { getTodayDateString, estimateTtsDuration } from '@/lib/quotas'

describe('getTodayDateString', () => {
  it('should return today date in YYYY-MM-DD format', () => {
    const dateStr = getTodayDateString()
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const d = new Date()
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(dateStr).toBe(expected)
  })
})

describe('estimateTtsDuration', () => {
  it('should estimate duration for simple text', () => {
    const text = 'Hello World'
    const duration = estimateTtsDuration(text)
    // 2 words / 2.5 words per second = 0.8 seconds
    expect(duration).toBeCloseTo(0.8, 1)
  })

  it('should estimate duration for longer text', () => {
    const text = 'one two three four five six seven eight nine ten'
    const duration = estimateTtsDuration(text)
    // 10 words / 2.5 words per second = 4 seconds
    expect(duration).toBeCloseTo(4.0, 1)
  })

  it('should adjust duration by speaking rate', () => {
    const text = 'one two three four five'
    const normal = estimateTtsDuration(text, 1.0)
    const fast = estimateTtsDuration(text, 2.0)
    const slow = estimateTtsDuration(text, 0.5)
    expect(fast).toBeCloseTo(normal / 2, 1)
    expect(slow).toBeCloseTo(normal * 2, 1)
  })

  it('should return 0 for empty text', () => {
    expect(estimateTtsDuration('')).toBe(0)
    expect(estimateTtsDuration('   ')).toBe(0)
  })

  it('should handle text with punctuation and extra spaces', () => {
    const text = '  Hello,   World!  '
    const duration = estimateTtsDuration(text)
    expect(duration).toBeCloseTo(0.8, 1)
  })
})
