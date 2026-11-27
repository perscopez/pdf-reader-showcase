import type { AudioCursor } from '@/components/ReaderTypes'

export function normalizeAudioCursor(value: unknown): AudioCursor | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if ((item.source !== 'tts' && item.source !== 'rsvp') || !Number.isFinite(item.page) || !Number.isFinite(item.wordIndex)) return null
  const cursor: AudioCursor = {
    page: Math.max(1, Math.floor(item.page as number)),
    wordIndex: Math.max(0, Math.floor(item.wordIndex as number)),
    source: item.source,
  }
  if (typeof item.text === 'string' && item.text.trim()) cursor.text = item.text.trim().slice(0, 180)
  if (item.provider === 'browser' || item.provider === 'google') cursor.provider = item.provider
  for (const key of ['timeMs', 'durationMs', 'chunkStartWord', 'chunkEndWord'] as const) {
    if (Number.isFinite(item[key])) cursor[key] = Math.max(0, Math.floor(item[key] as number))
  }
  return cursor
}

export function audioCursorLabel(cursor: AudioCursor): string {
  const source = cursor.source === 'rsvp' ? 'RSVP' : 'TTS'
  return `${source} · ${cursor.wordIndex + 1}`
}

export function audioCursorTime(cursor: AudioCursor): string | null {
  if (cursor.timeMs === undefined) return null
  const seconds = Math.max(0, Math.floor(cursor.timeMs / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
