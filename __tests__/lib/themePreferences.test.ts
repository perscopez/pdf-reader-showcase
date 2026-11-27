import { describe, it, expect } from 'vitest'
import { THEME_STORAGE } from '@/lib/themePreferences'

describe('THEME_STORAGE', () => {
  it('should have required storage keys', () => {
    expect(THEME_STORAGE.library).toBe('library-theme')
    expect(THEME_STORAGE.reader).toBe('reader-settings')
    expect(THEME_STORAGE.rsvp).toBe('rsvp-theme')
    expect(THEME_STORAGE.rsvpPreviewBackground).toBe('rsvp-preview-background')
  })

  it('should generate per-book reader keys', () => {
    expect(THEME_STORAGE.readerBook(1)).toBe('reader-settings:1')
    expect(THEME_STORAGE.readerBook(42)).toBe('reader-settings:42')
    expect(THEME_STORAGE.readerBook(0)).toBe('reader-settings:0')
  })

  it('should return distinct keys for different book ids', () => {
    const k1 = THEME_STORAGE.readerBook(1)
    const k2 = THEME_STORAGE.readerBook(2)
    expect(k1).not.toBe(k2)
  })
})
