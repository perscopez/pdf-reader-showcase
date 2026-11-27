import { describe, expect, it } from 'vitest'
import {
  AUDIO_NOTE_MAX_BYTES,
  audioExtensionForMime,
  audioNoteSessionHasFile,
  audioNoteStreamUrl,
  isAllowedAudioMime,
  normalizeAudioDuration,
  normalizeAudioPage,
  normalizeAudioTitle,
} from '@/lib/audioNotes'

describe('audio note validation and local replay helpers', () => {
  it('accepts MediaRecorder MIME parameters but stores a safe base MIME', () => {
    expect(isAllowedAudioMime('audio/webm;codecs=opus')).toBe(true)
    expect(isAllowedAudioMime('video/webm')).toBe(false)
    expect(audioExtensionForMime('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
  })

  it('bounds user-controlled session metadata and duration', () => {
    expect(normalizeAudioTitle(`  ${'x'.repeat(200)}  `)).toHaveLength(120)
    expect(normalizeAudioDuration(-1)).toBe(0)
    expect(normalizeAudioDuration(Infinity)).toBe(0)
    expect(normalizeAudioPage(3.8)).toBe(3)
  })

  it('keeps stream URLs private and distinguishes uploaded sessions', () => {
    expect(audioNoteStreamUrl(42)).toBe('/api/audio-notes/42/stream')
    expect(audioNoteSessionHasFile({ file_path: null })).toBe(false)
    expect(audioNoteSessionHasFile({ file_path: 'audio-notes/7/42.webm' })).toBe(true)
    expect(AUDIO_NOTE_MAX_BYTES).toBe(150 * 1024 * 1024)
  })
})
