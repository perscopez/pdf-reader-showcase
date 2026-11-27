import { describe, expect, it } from 'vitest'
import { audioCursorTime, normalizeAudioCursor } from '@/lib/audioLinkedNotes'

describe('audio-linked note cursors', () => {
  it('normalizes a Google TTS cursor without trusting invalid fields', () => {
    expect(normalizeAudioCursor({
      page: 4.8,
      wordIndex: 12.9,
      source: 'tts',
      provider: 'google',
      timeMs: 91_500,
      durationMs: 120_000,
      text: '  spoken word  ',
      ignored: 'value',
    })).toEqual({
      page: 4,
      wordIndex: 12,
      source: 'tts',
      provider: 'google',
      timeMs: 91_500,
      durationMs: 120_000,
      text: 'spoken word',
    })
    expect(audioCursorTime({ page: 1, wordIndex: 0, source: 'tts', timeMs: 91_500 })).toBe('1:31')
  })

  it('accepts RSVP cursors and rejects stale or malformed positions', () => {
    expect(normalizeAudioCursor({ page: 2, wordIndex: 3, source: 'rsvp' })).toEqual({ page: 2, wordIndex: 3, source: 'rsvp' })
    expect(normalizeAudioCursor({ page: 0, wordIndex: -4, source: 'tts' })).toEqual({ page: 1, wordIndex: 0, source: 'tts' })
    expect(normalizeAudioCursor({ page: 2, wordIndex: 3, source: 'recording' })).toBeNull()
    expect(normalizeAudioCursor({ page: '2', wordIndex: 3, source: 'tts' })).toBeNull()
  })
})
