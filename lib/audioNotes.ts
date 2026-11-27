export type AudioNoteSessionStatus = 'draft' | 'recording' | 'paused' | 'completed' | 'failed'

export interface AudioNoteMarker {
  id: number | string
  session_id: number | string
  annotation_id: number | null
  page: number
  timestamp_ms: number
  created_at?: string
}

export interface AudioNoteSession {
  id: number
  book_id: number
  title: string
  duration_ms: number
  file_path: string | null
  mime_type: string
  status: AudioNoteSessionStatus
  created_at?: string
  updated_at?: string
  markers?: AudioNoteMarker[]
}

export interface LocalAudioNoteDraft {
  id: string
  bookId: number
  title: string
  page: number
  durationMs: number
  mimeType: string
  updatedAt: string
  markers: AudioNoteMarker[]
  blob?: Blob
}

export const AUDIO_NOTE_MAX_BYTES = 150 * 1024 * 1024
export const AUDIO_NOTE_MAX_TITLE_LENGTH = 120
export const AUDIO_NOTE_DRAFT_DB = 'pdf-reader-audio-notes'

const AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
] as const

export function isAllowedAudioMime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const mime = value.toLowerCase().split(';', 1)[0].trim()
  return AUDIO_MIME_TYPES.includes(mime as typeof AUDIO_MIME_TYPES[number])
}

export function normalizeAudioMime(value: unknown): string {
  if (!isAllowedAudioMime(value)) return 'audio/webm'
  return String(value).toLowerCase().split(';', 1)[0].trim()
}

export function audioExtensionForMime(value: unknown): string {
  switch (normalizeAudioMime(value)) {
    case 'audio/ogg': return 'ogg'
    case 'audio/mp4': return 'm4a'
    case 'audio/mpeg': return 'mp3'
    case 'audio/wav':
    case 'audio/x-wav': return 'wav'
    default: return 'webm'
  }
}

export function normalizeAudioTitle(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFC').trim().slice(0, AUDIO_NOTE_MAX_TITLE_LENGTH)
}

export function normalizeAudioDuration(value: unknown): number {
  const duration = Number(value)
  return Number.isFinite(duration) ? Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.floor(duration))) : 0
}

export function normalizeAudioPage(value: unknown): number {
  const page = Number(value)
  return Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
}

export function normalizeAudioTimestamp(value: unknown): number {
  return normalizeAudioDuration(value)
}

export function normalizeAudioStatus(value: unknown): AudioNoteSessionStatus {
  return value === 'recording' || value === 'paused' || value === 'completed' || value === 'failed' ? value : 'draft'
}

export function createLocalAudioDraftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `local-${crypto.randomUUID()}`
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function audioNoteStreamUrl(sessionId: number) {
  return `/api/audio-notes/${encodeURIComponent(String(sessionId))}/stream`
}

export function audioNoteSessionHasFile(session: Pick<AudioNoteSession, 'file_path'>) {
  return typeof session.file_path === 'string' && session.file_path.length > 0
}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const request = indexedDB.open(AUDIO_NOTE_DRAFT_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open audio draft store'))
  })
}

export async function saveLocalAudioDraft(draft: LocalAudioNoteDraft) {
  const database = await openDraftDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite')
    transaction.objectStore('drafts').put({ ...draft, updatedAt: new Date().toISOString() })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Could not save audio draft'))
  })
  database.close()
}

export async function listLocalAudioDrafts(bookId?: number): Promise<LocalAudioNoteDraft[]> {
  const database = await openDraftDatabase()
  const drafts = await new Promise<LocalAudioNoteDraft[]>((resolve, reject) => {
    const request = database.transaction('drafts', 'readonly').objectStore('drafts').getAll()
    request.onsuccess = () => resolve(request.result as LocalAudioNoteDraft[])
    request.onerror = () => reject(request.error || new Error('Could not list audio drafts'))
  })
  database.close()
  return drafts.filter(draft => bookId === undefined || draft.bookId === bookId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getLocalAudioDraft(id: string): Promise<LocalAudioNoteDraft | null> {
  const database = await openDraftDatabase()
  const draft = await new Promise<LocalAudioNoteDraft | null>((resolve, reject) => {
    const request = database.transaction('drafts', 'readonly').objectStore('drafts').get(id)
    request.onsuccess = () => resolve((request.result as LocalAudioNoteDraft | undefined) || null)
    request.onerror = () => reject(request.error || new Error('Could not load audio draft'))
  })
  database.close()
  return draft
}

export async function deleteLocalAudioDraft(id: string) {
  const database = await openDraftDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite')
    transaction.objectStore('drafts').delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Could not delete audio draft'))
  })
  database.close()
}
