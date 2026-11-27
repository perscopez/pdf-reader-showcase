export type ReaderMode = 'pdf' | 'continuous' | 'reflow'

export type ReaderCommandScope = 'global' | 'reader' | 'selection' | 'modal'

export interface ReaderCommand {
  id: string
  label: string
  hint?: string
  shortcut?: string
  scope: ReaderCommandScope
  keywords?: string[]
  run: () => void
  disabled?: boolean
}

export interface ReaderReadingCursor {
  page: number
  wordIndex: number
  source: 'idle' | 'tts' | 'rsvp'
  updatedAt: number
}

export interface ReaderNetworkState {
  online: boolean
  pdf: 'ready' | 'loading' | 'offline' | 'error'
  text: 'ready' | 'loading' | 'offline' | 'error'
  sync: 'idle' | 'queued' | 'syncing' | 'error'
  lastError?: string
}

export interface ReaderPageWindow {
  start: number
  end: number
  pages: number[]
}

export interface ReaderPreferences {
  mode: ReaderMode
  fontScale: number
  lineHeight: number
  columnWidth: number
  readingRuler: boolean
  focusLine: boolean
  highContrast: boolean
  eInkMode: boolean
  readingDirection: 'auto' | 'ltr' | 'rtl'
  reducedMotion: boolean
  prefetchPages: boolean
}

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  mode: 'pdf',
  fontScale: 1,
  lineHeight: 1.6,
  columnWidth: 72,
  readingRuler: false,
  focusLine: false,
  highContrast: false,
  eInkMode: false,
  readingDirection: 'auto',
  reducedMotion: false,
  prefetchPages: true,
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function parseReaderPreferences(raw: unknown, defaults: ReaderPreferences = DEFAULT_READER_PREFERENCES): ReaderPreferences {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const mode = value.mode === 'continuous' || value.mode === 'reflow' || value.mode === 'pdf'
    ? value.mode
    : defaults.mode
  return {
    mode,
    fontScale: Math.min(1.8, Math.max(0.8, finiteNumber(value.fontScale, defaults.fontScale))),
    lineHeight: Math.min(2.4, Math.max(1.1, finiteNumber(value.lineHeight, defaults.lineHeight))),
    columnWidth: Math.min(110, Math.max(42, Math.round(finiteNumber(value.columnWidth, defaults.columnWidth)))),
    readingRuler: typeof value.readingRuler === 'boolean' ? value.readingRuler : defaults.readingRuler,
    focusLine: typeof value.focusLine === 'boolean' ? value.focusLine : defaults.focusLine,
    highContrast: typeof value.highContrast === 'boolean' ? value.highContrast : defaults.highContrast,
    eInkMode: typeof value.eInkMode === 'boolean' ? value.eInkMode : defaults.eInkMode,
    readingDirection: value.readingDirection === 'ltr' || value.readingDirection === 'rtl' || value.readingDirection === 'auto'
      ? value.readingDirection
      : defaults.readingDirection,
    reducedMotion: typeof value.reducedMotion === 'boolean' ? value.reducedMotion : defaults.reducedMotion,
    prefetchPages: typeof value.prefetchPages === 'boolean' ? value.prefetchPages : defaults.prefetchPages,
  }
}

export function calculateReaderPageWindow(currentPage: number, totalPages: number, radius = 2): ReaderPageWindow {
  const total = Math.max(0, Math.floor(totalPages))
  if (total === 0) return { start: 0, end: 0, pages: [] }
  const page = Math.min(total, Math.max(1, Math.floor(currentPage)))
  const safeRadius = Math.max(0, Math.floor(radius))
  const start = Math.max(1, page - safeRadius)
  const end = Math.min(total, page + safeRadius)
  return { start, end, pages: Array.from({ length: end - start + 1 }, (_, index) => start + index) }
}

export function createReadingCursor(page = 1, wordIndex = 0, source: ReaderReadingCursor['source'] = 'idle', now = Date.now()): ReaderReadingCursor {
  return {
    page: Math.max(1, Math.floor(page)),
    wordIndex: Math.max(0, Math.floor(wordIndex)),
    source,
    updatedAt: now,
  }
}

export function serializeReadingCursor(cursor: ReaderReadingCursor) {
  return JSON.stringify(createReadingCursor(cursor.page, cursor.wordIndex, cursor.source, cursor.updatedAt))
}

export function parseReadingCursor(raw: unknown, fallback = createReadingCursor()): ReaderReadingCursor {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object') return fallback
    const item = value as Record<string, unknown>
    const source = item.source === 'tts' || item.source === 'rsvp' || item.source === 'idle' ? item.source : fallback.source
    return createReadingCursor(
      finiteNumber(item.page, fallback.page),
      finiteNumber(item.wordIndex, fallback.wordIndex),
      source,
      finiteNumber(item.updatedAt, fallback.updatedAt),
    )
  } catch {
    return fallback
  }
}

export function nextReaderPage(currentPage: number, totalPages: number, delta: number) {
  return Math.min(Math.max(1, Math.floor(totalPages) || 1), Math.max(1, Math.floor(currentPage) + Math.sign(delta)))
}

export function normalizeReaderSearchKey(query: string) {
  return query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')
}
