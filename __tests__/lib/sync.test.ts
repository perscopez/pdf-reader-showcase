import { describe, it, expect } from 'vitest'
import {
  generateDeviceId,
  SYNC_TABLES,
  SYNC_ID_COLUMNS,
  entityFromTable,
  isSyncEntity,
} from '@/lib/sync'

describe('generateDeviceId', () => {
  it('generates a UUID-like string', () => {
    const id = generateDeviceId()
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThanOrEqual(32)
  })

  it('generates unique IDs on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateDeviceId()))
    expect(ids.size).toBe(100)
  })

  it('only contains hex characters and dashes', () => {
    const id = generateDeviceId()
    expect(id).toMatch(/^[0-9a-f-]+$/)
  })
})

describe('SYNC_TABLES', () => {
  it('maps all entities to valid table names', () => {
    const expected: Record<string, string> = {
      book: 'books',
      annotation: 'annotations',
      bookmark: 'bookmarks',
      word: 'word_library',
      session: 'reading_sessions',
    }
    expect(SYNC_TABLES).toEqual(expected)
  })
})

describe('SYNC_ID_COLUMNS', () => {
  it('maps all entities to "id"', () => {
    for (const entity of Object.keys(SYNC_ID_COLUMNS)) {
      expect(SYNC_ID_COLUMNS[entity]).toBe('id')
    }
  })
})

describe('entityFromTable', () => {
  it('returns entity for known table names', () => {
    expect(entityFromTable('books')).toBe('book')
    expect(entityFromTable('annotations')).toBe('annotation')
    expect(entityFromTable('bookmarks')).toBe('bookmark')
    expect(entityFromTable('word_library')).toBe('word')
    expect(entityFromTable('reading_sessions')).toBe('session')
  })

  it('returns null for unknown tables', () => {
    expect(entityFromTable('users')).toBeNull()
    expect(entityFromTable('')).toBeNull()
    expect(entityFromTable('nonexistent')).toBeNull()
  })

  it('covers all entries in SYNC_TABLES', () => {
    for (const [entity, table] of Object.entries(SYNC_TABLES)) {
      expect(entityFromTable(table)).toBe(entity)
    }
  })
})

describe('isSyncEntity', () => {
  it('accepts stored tombstone entity names', () => {
    for (const entity of Object.keys(SYNC_TABLES)) expect(isSyncEntity(entity)).toBe(true)
  })

  it('rejects table names and unknown input', () => {
    expect(isSyncEntity('annotations')).toBe(false)
    expect(isSyncEntity('users')).toBe(false)
    expect(isSyncEntity(null)).toBe(false)
  })
})
