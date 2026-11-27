import { describe, expect, it, vi } from 'vitest'
import {
  migrateBookPagesUniqueness,
  migrateAudioNotesSchema,
  migrateReadingGroupsSchema,
  migrateResearchNotebooksSchema,
  runVersionedMigration,
  type MigrationDatabase,
} from '@/lib/dbMigrations'

function migrationDatabase() {
  const applied = new Set<string>()
  const executedSql: string[] = []
  let immediateCalls = 0

  const database: MigrationDatabase = {
    exec: vi.fn((sql: string) => {
      executedSql.push(sql)
    }),
    prepare: vi.fn((sql: string) => ({
      get: (id: unknown) => sql.includes('SELECT id FROM schema_migrations') && applied.has(String(id))
        ? { id }
        : undefined,
      run: (id: unknown) => {
        if (sql.includes('INSERT INTO schema_migrations')) applied.add(String(id))
        return { changes: 1 }
      },
    })),
    transaction: vi.fn((callback: (...args: never[]) => unknown) => {
      const transaction = (() => callback()) as (() => unknown) & { immediate?: () => unknown }
      transaction.immediate = () => {
        immediateCalls += 1
        return callback()
      }
      return transaction
    }) as MigrationDatabase['transaction'],
  }

  return {
    applied,
    database,
    executedSql,
    immediateCalls: () => immediateCalls,
  }
}

describe('versioned database migrations', () => {
  it('runs an idempotent migration exactly once', () => {
    const fixture = migrationDatabase()
    const migrate = vi.fn()

    expect(runVersionedMigration(fixture.database, 'fixture-v1', migrate)).toBe(true)
    expect(runVersionedMigration(fixture.database, 'fixture-v1', migrate)).toBe(false)
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(fixture.applied).toEqual(new Set(['fixture-v1']))
    expect(fixture.immediateCalls()).toBe(2)
  })

  it('does not mark a failed migration and retries safely', () => {
    const fixture = migrationDatabase()
    const migrate = vi.fn()
      .mockImplementationOnce(() => { throw new Error('locked') })
      .mockImplementationOnce(() => undefined)

    expect(() => runVersionedMigration(fixture.database, 'retry-v1', migrate)).toThrow('locked')
    expect(fixture.applied.has('retry-v1')).toBe(false)
    expect(runVersionedMigration(fixture.database, 'retry-v1', migrate)).toBe(true)
    expect(fixture.applied.has('retry-v1')).toBe(true)
  })

  it('serializes concurrent startup attempts through an immediate transaction', async () => {
    const fixture = migrationDatabase()
    const migrate = vi.fn()

    const results = await Promise.all([
      Promise.resolve().then(() => runVersionedMigration(fixture.database, 'concurrent-v1', migrate)),
      Promise.resolve().then(() => runVersionedMigration(fixture.database, 'concurrent-v1', migrate)),
      Promise.resolve().then(() => runVersionedMigration(fixture.database, 'concurrent-v1', migrate)),
    ])

    expect(results).toEqual([true, false, false])
    expect(migrate).toHaveBeenCalledTimes(1)
    expect(fixture.immediateCalls()).toBe(3)
  })

  it('deduplicates book pages and creates the unique index only once', () => {
    const fixture = migrationDatabase()

    expect(migrateBookPagesUniqueness(fixture.database)).toBe(true)
    expect(migrateBookPagesUniqueness(fixture.database)).toBe(false)

    const destructiveRuns = fixture.executedSql.filter(sql => sql.includes('DELETE FROM book_pages'))
    expect(destructiveRuns).toHaveLength(1)
    expect(destructiveRuns[0]).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_book_pages_book_page')
  })

  it('creates isolated reading-group tables and indexes idempotently', () => {
    const fixture = migrationDatabase()

    expect(migrateReadingGroupsSchema(fixture.database)).toBe(true)
    expect(migrateReadingGroupsSchema(fixture.database)).toBe(false)

    const schema = fixture.executedSql.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS reading_groups'))
    expect(schema).toContain('reading_group_members')
    expect(schema).toContain("CHECK(role IN ('owner', 'member'))")
    expect(schema).toContain("CHECK(visibility IN ('group', 'private'))")
    expect(schema).toContain('reading_group_annotation_replies')
    expect(fixture.executedSql.filter(sql => sql.includes('CREATE TABLE IF NOT EXISTS reading_groups'))).toHaveLength(1)
  })

  it('creates research notebook tables and preserves missing-source references', () => {
    const fixture = migrationDatabase()

    expect(migrateResearchNotebooksSchema(fixture.database)).toBe(true)
    expect(migrateResearchNotebooksSchema(fixture.database)).toBe(false)

    const schema = fixture.executedSql.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS research_notebooks'))
    expect(schema).toContain('research_notebook_items')
    expect(schema).toContain('UNIQUE(notebook_id, annotation_id, source_index)')
    expect(schema).not.toContain('FOREIGN KEY(annotation_id)')
  })

  it('creates audio sessions and marker tables idempotently', () => {
    const fixture = migrationDatabase()

    expect(migrateAudioNotesSchema(fixture.database)).toBe(true)
    expect(migrateAudioNotesSchema(fixture.database)).toBe(false)

    const schema = fixture.executedSql.find(sql => sql.includes('CREATE TABLE IF NOT EXISTS audio_note_sessions'))
    expect(schema).toContain('audio_note_markers')
    expect(schema).toContain("CHECK(status IN ('draft', 'recording', 'paused', 'completed', 'failed'))")
    expect(schema).toContain('FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE')
    expect(fixture.executedSql.filter(sql => sql.includes('CREATE TABLE IF NOT EXISTS audio_note_sessions'))).toHaveLength(1)
  })
})
