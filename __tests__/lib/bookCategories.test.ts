import { describe, expect, it } from 'vitest'
import { normalizeBookCategoryIds } from '@/lib/bookCategories'

describe('book category helpers', () => {
  it('normalizes positive category IDs without duplicates', () => {
    expect(normalizeBookCategoryIds([3, '2', 3, 0, -1, 'x', 7.5])).toEqual([3, 2])
  })

  it('accepts a JSON compatibility value', () => {
    expect(normalizeBookCategoryIds('[4, 2, 4]')).toEqual([4, 2])
    expect(normalizeBookCategoryIds('not-json')).toEqual([])
  })

  it('bounds category and book membership lists', () => {
    expect(normalizeBookCategoryIds(Array.from({ length: 80 }, (_, index) => index + 1))).toHaveLength(50)
    expect(normalizeBookCategoryIds(Array.from({ length: 600 }, (_, index) => index + 1), 500)).toHaveLength(500)
  })
})
