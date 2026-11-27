import { describe, expect, it } from 'vitest'
import { isComparablePdf, normalizeCompareSelection } from '@/lib/compare'

describe('comparison selection', () => {
  it('accepts only unencrypted PDFs', () => {
    expect(isComparablePdf({ id: 1, title: 'A', filename: 'a.pdf' })).toBe(true)
    expect(isComparablePdf({ id: 2, title: 'B', filename: 'b.epub' })).toBe(false)
    expect(isComparablePdf({ id: 3, title: 'C', filename: 'c.pdf', is_encrypted: 1 })).toBe(false)
  })

  it('normalizes distinct positive A/B ids', () => {
    expect(normalizeCompareSelection('4', '4')).toEqual([4, 0])
    expect(normalizeCompareSelection('4', '7')).toEqual([4, 7])
    expect(normalizeCompareSelection('nope', 2)).toEqual([0, 2])
  })
})
