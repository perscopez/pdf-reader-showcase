export type SyncEntity = 'book' | 'annotation' | 'bookmark' | 'word' | 'session'

export interface SyncChange {
  local_id?: number
  server_id?: number
  entity: SyncEntity
  action: 'upsert' | 'delete'
  data: Record<string, unknown>
  updated_at: string
}

export interface SyncPushRequest {
  device_id: string
  changes: SyncChange[]
}

export interface SyncPushResult {
  server_id: number
  entity: SyncEntity
  local_id?: number
}

export interface SyncPushResponse {
  results: SyncPushResult[]
}

export interface SyncPullResponse {
  changes: SyncChange[]
  deleted: { entity: SyncEntity; id: number }[]
  server_time: string
}

export interface SyncDevice {
  id: number
  device_id: string
  device_name: string
  last_seen_at: string
  created_at: string
}

export function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

const DEVICE_STORAGE_KEY = 'pdf_sync_device_id'

export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(DEVICE_STORAGE_KEY)
  if (!id) {
    id = generateDeviceId()
    localStorage.setItem(DEVICE_STORAGE_KEY, id)
  }
  return id
}

export function getDeviceName(): string {
  if (typeof window === 'undefined') return 'Server'
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'Web Browser'
}

export const SYNC_TABLES: Record<SyncEntity, string> = {
  book: 'books',
  annotation: 'annotations',
  bookmark: 'bookmarks',
  word: 'word_library',
  session: 'reading_sessions',
}

export const SYNC_ID_COLUMNS: Record<SyncEntity, string> = {
  book: 'id',
  annotation: 'id',
  bookmark: 'id',
  word: 'id',
  session: 'id',
}

const SYNC_ENTITY_SET = new Set<SyncEntity>(Object.keys(SYNC_TABLES) as SyncEntity[])

export function isSyncEntity(value: unknown): value is SyncEntity {
  return typeof value === 'string' && SYNC_ENTITY_SET.has(value as SyncEntity)
}

export function entityFromTable(table: string): SyncEntity | null {
  for (const [entity, tbl] of Object.entries(SYNC_TABLES)) {
    if (tbl === table) return entity as SyncEntity
  }
  return null
}
