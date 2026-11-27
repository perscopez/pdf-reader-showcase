import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrateResearchNotebooksSchema } from '@/lib/dbMigrations'
import {
  createResearchNotebookRepository,
  ResearchNotebookError,
  normalizeNotebookItemInput,
  normalizeNotebookOrder,
  serializeNotebookForExport,
} from '@/lib/researchNotebooks'

function fixture() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE books (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL, is_encrypted INTEGER DEFAULT 0);
    CREATE TABLE annotations (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, book_id INTEGER NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL, page INTEGER NOT NULL);
  `)
  database.prepare('INSERT INTO users (id, username, password_hash) VALUES (1, \'one\', \'hash\'), (2, \'two\', \'hash\')').run()
  database.prepare('INSERT INTO books (id, user_id, title, is_encrypted) VALUES (10, 1, \'Plain book\', 0), (20, 2, \'Other book\', 0), (30, 1, \'Encrypted book\', 1)').run()
  database.prepare('INSERT INTO annotations (id, user_id, book_id, type, content, page) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)').run(
    100, 1, 10, 'highlight', JSON.stringify({ text: 'First source' }), 3,
    101, 1, 10, 'note', JSON.stringify({ sources: [{ page: 4, text: 'Second source' }, { page: 8, text: 'Another source' }] }), 4,
    102, 1, 30, 'highlight', JSON.stringify({ text: 'Secret source' }), 5,
  )
  migrateResearchNotebooksSchema(database)
  return { database, repository: createResearchNotebookRepository(database) }
}

describe('research notebooks', () => {
  it('bounds item input and rejects duplicate order IDs', () => {
    expect(normalizeNotebookItemInput({ annotation_id: 4, source_index: 2, heading: ' H ', commentary: ' C ' })).toEqual({
      annotationId: 4,
      sourceIndex: 2,
      heading: 'H',
      commentary: 'C',
    })
    expect(normalizeNotebookItemInput({ annotation_id: 0 })).toBeNull()
    expect(normalizeNotebookOrder([1, 2, 1])).toBeNull()
    expect(normalizeNotebookOrder([3, 1])).toEqual([3, 1])
  })

  it('enforces source ownership and encrypted-book rejection', () => {
    const { repository } = fixture()
    const notebook = repository.create(1, 'Research')
    const input = normalizeNotebookItemInput({ annotation_id: 100 })!
    expect(repository.addItem(1, notebook.id, input)?.items).toHaveLength(1)

    expect(() => repository.addItem(2, notebook.id, input)).toThrowError(ResearchNotebookError)
    try {
      repository.addItem(1, notebook.id, normalizeNotebookItemInput({ annotation_id: 102 })!)
      throw new Error('expected encrypted source rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: 'encrypted_source' })
    }
    try {
      repository.addItem(1, notebook.id, normalizeNotebookItemInput({ annotation_id: 101, source_index: 9 })!)
      throw new Error('expected invalid source rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_source' })
    }
  })

  it('keeps a missing source item editable and reorders/export deterministically', () => {
    const { database, repository } = fixture()
    const notebook = repository.create(1, '  Field Notes  ')
    repository.addItem(1, notebook.id, normalizeNotebookItemInput({ annotation_id: 100, heading: 'One' })!)
    repository.addItem(1, notebook.id, normalizeNotebookItemInput({ annotation_id: 101, source_index: 1, heading: 'Two', commentary: 'Keep this prose' })!)
    const beforeDelete = repository.get(1, notebook.id)!
    const firstItemId = beforeDelete.items[0].id
    const secondItemId = beforeDelete.items[1].id

    database.prepare('DELETE FROM annotations WHERE id = ?').run(100)
    const missing = repository.get(1, notebook.id)!
    expect(missing.items[0].missing_source).toBe(true)
    expect(missing.items[0].commentary).toBe('')

    const reordered = repository.reorder(1, notebook.id, [secondItemId, firstItemId])!
    expect(reordered.items.map(item => item.id)).toEqual([secondItemId, firstItemId])
    const markdown = serializeNotebookForExport(reordered, 'markdown')
    expect(markdown).toContain('# Field Notes')
    expect(markdown).toContain('Keep this prose')
    expect(markdown).toContain('[Kaynağı aç](/reader/10?page=8&annotation=101&source=1)')
    expect(markdown).toContain('[Kaynak bulunamadı] Annotation #100')
    const json = serializeNotebookForExport(reordered, 'json')
    expect(JSON.parse(json).notebook.items).toHaveLength(2)
  })
})
