import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the indexedDb module
vi.mock('@/lib/indexedDb', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store: Record<string, any[]> = {
    books: [],
    annotations: [],
    bookmarks: [],
    word_library: [],
    reading_sessions: [],
    sync_meta: []
  }

  return {
    initDb: vi.fn().mockResolvedValue({}),
    getAllFromStore: vi.fn((name) => Promise.resolve(store[name] || [])),
    getFromStore: vi.fn((name, id) => Promise.resolve(store[name]?.find(r => r.local_id === id) || null)),
    getByServerId: vi.fn((name, serverId) => Promise.resolve(store[name]?.find(r => r.server_id === serverId) || null)),
    getDirtyRecords: vi.fn((name) => Promise.resolve(store[name]?.filter(r => r.local_status !== 'synced') || [])),
    putToStore: vi.fn((name, record) => {
      const list = store[name] || []
      if (!record.local_id) {
        record.local_id = list.length + 1
        list.push(record)
      } else {
        const idx = list.findIndex(r => r.local_id === record.local_id)
        if (idx >= 0) list[idx] = record
        else list.push(record)
      }
      return Promise.resolve(record.local_id)
    }),
    deleteFromStore: vi.fn((name, id) => {
      const list = store[name] || []
      const idx = list.findIndex(r => r.local_id === id)
      if (idx >= 0) list.splice(idx, 1)
      return Promise.resolve()
    }),
    getSyncMeta: vi.fn().mockResolvedValue(null),
    saveSyncMeta: vi.fn().mockResolvedValue(undefined)
  }
})

import * as db from '@/lib/indexedDb'

describe('IndexedDB Client Offline-First Mock Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset our mock store via direct assignment to DB mock internal arrays if needed,
    // or just let the mocked functions handle clean states.
  })

  it('verifies that initDb can be mock resolved', async () => {
    const res = await db.initDb()
    expect(res).toBeDefined()
  })

  it('correctly retrieves mock records by server ID', async () => {
    // Insert mock record
    const id = await db.putToStore('books', {
      server_id: 101,
      title: 'Mock Book',
      local_status: 'synced',
      updated_at: '2026-06-21T00:00:00Z'
    })

    expect(id).toBe(1)

    const record = await db.getByServerId('books', 101)
    expect(record).not.toBeNull()
    expect(record?.title).toBe('Mock Book')
    expect(record?.server_id).toBe(101)
  })

  it('correctly separates dirty records from synced ones', async () => {
    await db.putToStore('books', {
      local_id: 2,
      server_id: 102,
      title: 'Synced Book',
      local_status: 'synced',
      updated_at: '2026-06-21T00:00:00Z'
    })

    await db.putToStore('books', {
      local_id: 3,
      server_id: 103,
      title: 'Dirty Book',
      local_status: 'updated',
      updated_at: '2026-06-21T01:00:00Z'
    })

    const dirty = await db.getDirtyRecords('books')
    expect(dirty.length).toBe(1)
    expect(dirty[0].title).toBe('Dirty Book')
  })
})
