export interface CachedBookRecord {
  local_id?: number
  server_id?: number | null
  local_status: 'synced' | 'created' | 'updated' | 'deleted'
  updated_at: string
  title?: unknown
  author?: unknown
  [key: string]: unknown
}

export interface ServerBookRecord {
  id: number
  updated_at?: string
  [key: string]: unknown
}

export interface BookCacheReconciliation {
  deleteLocalIds: number[]
  upserts: CachedBookRecord[]
}

function recordTime(record: CachedBookRecord) {
  const parsed = Date.parse(record.updated_at)
  return Number.isNaN(parsed) ? 0 : parsed
}

function preferCanonical(a: CachedBookRecord, b: CachedBookRecord) {
  const aDirty = a.local_status !== 'synced'
  const bDirty = b.local_status !== 'synced'
  if (aDirty !== bDirty) return aDirty ? -1 : 1
  return recordTime(b) - recordTime(a) || Number(a.local_id || 0) - Number(b.local_id || 0)
}

function normalizedText(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ')
    : ''
}

function bookFingerprint(record: CachedBookRecord) {
  const title = normalizedText(record.title)
  const author = normalizedText(record.author)
  return title ? `${title}\u0000${author}` : ''
}

export function visibleBookRecords<T extends CachedBookRecord>(records: T[]): T[] {
  const visible = records.filter(record => record.local_status !== 'deleted')
  const canonicalSynced = new Map<string, T>()
  const dirty: T[] = []

  for (const record of visible) {
    if (record.local_status !== 'synced') {
      dirty.push(record)
      continue
    }
    const fingerprint = bookFingerprint(record)
    const key = fingerprint || (record.server_id ? `server:${record.server_id}` : `local:${record.local_id}`)
    const current = canonicalSynced.get(key)
    if (!current || preferCanonical(record, current) < 0) canonicalSynced.set(key, record)
  }

  return [...dirty, ...canonicalSynced.values()]
}

export function planBookCacheReconciliation(
  localBooks: CachedBookRecord[],
  serverBooks: ServerBookRecord[],
): BookCacheReconciliation {
  const deleteLocalIds = new Set<number>()
  const groups = new Map<number, CachedBookRecord[]>()

  for (const local of localBooks) {
    const serverId = Number(local.server_id)
    if (Number.isSafeInteger(serverId) && serverId > 0) {
      const group = groups.get(serverId) || []
      group.push(local)
      groups.set(serverId, group)
    } else if (local.local_status === 'synced' && local.local_id) {
      deleteLocalIds.add(local.local_id)
    }
  }

  const canonicalByServerId = new Map<number, CachedBookRecord>()
  for (const [serverId, group] of groups) {
    const sorted = [...group].sort(preferCanonical)
    canonicalByServerId.set(serverId, sorted[0])
    for (const duplicate of sorted.slice(1)) {
      if (duplicate.local_id) deleteLocalIds.add(duplicate.local_id)
    }
  }

  const serverIds = new Set(serverBooks.map(book => book.id))
  for (const [serverId, local] of canonicalByServerId) {
    if (!serverIds.has(serverId) && local.local_status === 'synced' && local.local_id) {
      deleteLocalIds.add(local.local_id)
      canonicalByServerId.delete(serverId)
    }
  }

  const upserts: CachedBookRecord[] = []
  for (const server of serverBooks) {
    const local = canonicalByServerId.get(server.id)
    if (!local) {
      upserts.push({
        ...server,
        server_id: server.id,
        local_status: 'synced',
        updated_at: server.updated_at || new Date(0).toISOString(),
      })
    } else if (local.local_status === 'synced') {
      upserts.push({
        ...local,
        ...server,
        local_id: local.local_id,
        server_id: server.id,
        local_status: 'synced',
        updated_at: server.updated_at || local.updated_at,
      })
    }
  }

  return { deleteLocalIds: [...deleteLocalIds], upserts }
}
