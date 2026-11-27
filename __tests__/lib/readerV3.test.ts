import { describe, expect, it } from 'vitest'
import {
  calculateReaderPageWindow,
  createReadingCursor,
  nextReaderPage,
  normalizeReaderSearchKey,
  parseReaderPreferences,
  parseReadingCursor,
  serializeReadingCursor,
} from '@/lib/readerV3'

describe('reader v3 contracts', () => {
  it('clamps virtual page windows to the document', () => {
    expect(calculateReaderPageWindow(1, 5, 2)).toEqual({ start: 1, end: 3, pages: [1, 2, 3] })
    expect(calculateReaderPageWindow(5, 5, 2)).toEqual({ start: 3, end: 5, pages: [3, 4, 5] })
    expect(calculateReaderPageWindow(99, 0)).toEqual({ start: 0, end: 0, pages: [] })
  })

  it('migrates and clamps reader ergonomics preferences', () => {
    expect(parseReaderPreferences({ mode: 'continuous', fontScale: 9, lineHeight: 0.1, columnWidth: 500, readingRuler: true })).toMatchObject({
      mode: 'continuous', fontScale: 1.8, lineHeight: 1.1, columnWidth: 110, readingRuler: true, eInkMode: false, readingDirection: 'auto',
    })
    expect(parseReaderPreferences({ eInkMode: true, readingDirection: 'rtl' })).toMatchObject({ eInkMode: true, readingDirection: 'rtl' })
  })

  it('round-trips the shared reading cursor', () => {
    const cursor = createReadingCursor(4, 12, 'tts', 123)
    expect(parseReadingCursor(serializeReadingCursor(cursor))).toEqual(cursor)
    expect(parseReadingCursor('{bad json', createReadingCursor(2))).toEqual(createReadingCursor(2))
  })

  it('clamps next/previous navigation and normalizes Turkish search keys', () => {
    expect(nextReaderPage(1, 10, -1)).toBe(1)
    expect(nextReaderPage(10, 10, 1)).toBe(10)
    expect(normalizeReaderSearchKey('  İNCE   ÇALIŞMA  ')).toBe('ince çalışma')
  })
})
