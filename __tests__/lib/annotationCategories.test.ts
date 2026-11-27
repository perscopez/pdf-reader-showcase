import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_CATEGORY_COLORS,
  categoryNameKey,
  normalizeCategoryColor,
  normalizeCategoryName,
  parseCategoryId,
} from '@/lib/annotationCategories'

describe('annotation categories', () => {
  it('normalizes bounded names and Turkish duplicate identity', () => {
    expect(normalizeCategoryName('  Araştırma   Notları  ')).toBe('Araştırma Notları')
    expect(normalizeCategoryName('a'.repeat(60))).toHaveLength(40)
    expect(categoryNameKey('İnceleme')).toBe(categoryNameKey('İNCELEME'))
  })

  it('allows only the restrained palette', () => {
    expect(normalizeCategoryColor(ANNOTATION_CATEGORY_COLORS[3])).toBe(ANNOTATION_CATEGORY_COLORS[3])
    expect(normalizeCategoryColor('#ffffff')).toBe(ANNOTATION_CATEGORY_COLORS[0])
  })

  it('parses optional positive category IDs', () => {
    expect(parseCategoryId(4)).toBe(4)
    expect(parseCategoryId(null)).toBeNull()
    expect(parseCategoryId(-1)).toBeNull()
  })
})
