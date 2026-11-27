import { existsSync } from 'node:fs'
import { mkdir, rename, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import db from './db'
import { annotationAssetDirectory } from './annotationAssets'
import { removeManagedImage } from './media'

export interface BookTrashSnapshot {
  version: 1
  book: Record<string, unknown>
  annotations: Record<string, unknown>[]
  bookmarks: Record<string, unknown>[]
  words: Record<string, unknown>[]
  readingSessions: Record<string, unknown>[]
  categoryAssignments: Record<string, unknown>[]
  bookCategories: Record<string, unknown>[]
  annotationCategories: Record<string, unknown>[]
}

function tableColumns(table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name)
}

function insertSnapshotRow(
  table: string,
  row: Record<string, unknown>,
  overrides: Record<string, unknown>,
  omitted = new Set(['id']),
) {
  const source = { ...row, ...overrides }
  const columns = tableColumns(table).filter(column => !omitted.has(column) && source[column] !== undefined)
  const values = columns.map(column => source[column])
  return db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...values)
}

export function createBookTrashSnapshot(userId: number, bookId: number) {
  return db.transaction(() => {
    const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(bookId, userId) as Record<string, unknown> | undefined
    if (!book) return null
    const snapshot: BookTrashSnapshot = {
      version: 1,
      book,
      annotations: db.prepare('SELECT * FROM annotations WHERE book_id = ? AND user_id = ?').all(bookId, userId) as Record<string, unknown>[],
      bookmarks: db.prepare('SELECT * FROM bookmarks WHERE book_id = ? AND user_id = ?').all(bookId, userId) as Record<string, unknown>[],
      words: db.prepare('SELECT * FROM word_library WHERE source_book_id = ? AND user_id = ?').all(bookId, userId) as Record<string, unknown>[],
      readingSessions: db.prepare('SELECT * FROM reading_sessions WHERE book_id = ? AND user_id = ?').all(bookId, userId) as Record<string, unknown>[],
      categoryAssignments: db.prepare('SELECT * FROM book_category_assignments WHERE book_id = ? AND user_id = ?').all(bookId, userId) as Record<string, unknown>[],
      bookCategories: db.prepare('SELECT * FROM book_categories WHERE user_id = ?').all(userId) as Record<string, unknown>[],
      annotationCategories: db.prepare('SELECT * FROM annotation_categories WHERE user_id = ?').all(userId) as Record<string, unknown>[],
    }
    const trash = db.prepare(`
      INSERT INTO trash_items (user_id, item_type, item_id, data_json)
      VALUES (?, 'book', ?, ?)
    `).run(userId, bookId, JSON.stringify(snapshot))

    db.prepare('DELETE FROM annotations WHERE book_id = ? AND user_id = ?').run(bookId, userId)
    db.prepare('DELETE FROM bookmarks WHERE book_id = ? AND user_id = ?').run(bookId, userId)
    db.prepare('DELETE FROM word_library WHERE source_book_id = ? AND user_id = ?').run(bookId, userId)
    db.prepare('DELETE FROM reading_sessions WHERE book_id = ? AND user_id = ?').run(bookId, userId)
    db.prepare('DELETE FROM book_category_assignments WHERE book_id = ? AND user_id = ?').run(bookId, userId)
    db.prepare('DELETE FROM book_pages WHERE book_id = ?').run(bookId)
    db.prepare('DELETE FROM page_text_models WHERE book_id = ? AND user_id = ?').run(bookId, userId)
    db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(bookId, userId)
    db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at)
      VALUES (?, 'book', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(userId, bookId)
    return { trashId: Number(trash.lastInsertRowid), snapshot }
  })()
}

function parseSnapshot(value: string): BookTrashSnapshot | null {
  try {
    const parsed = JSON.parse(value) as BookTrashSnapshot
    return parsed?.version === 1 && parsed.book && Array.isArray(parsed.annotations) ? parsed : null
  } catch {
    return null
  }
}

function remapAnnotationPreviewUrls(content: unknown, oldBookId: number, newBookId: number) {
  if (typeof content !== 'string' || oldBookId === newBookId) return content
  try {
    const parsed = JSON.parse(content)
    const updateArea = (area: { previewUrl?: unknown } | undefined) => {
      if (typeof area?.previewUrl !== 'string') return
      area.previewUrl = area.previewUrl.replace(
        new RegExp(`([?&]book_id=)${oldBookId}(?=&|$)`),
        `$1${newBookId}`,
      )
    }
    updateArea(parsed.area)
    if (Array.isArray(parsed.sources)) parsed.sources.forEach((source: { area?: { previewUrl?: unknown } }) => updateArea(source.area))
    return JSON.stringify(parsed)
  } catch {
    return content
  }
}

function restoreSnapshotCategories(
  userId: number,
  table: 'book_categories' | 'annotation_categories',
  rows: Record<string, unknown>[],
) {
  const result = new Map<number, number>()
  const find = db.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND name = ? COLLATE NOCASE`)
  const insert = db.prepare(`INSERT INTO ${table} (user_id, name, color, position) VALUES (?, ?, ?, ?)`)
  for (const row of rows || []) {
    const name = String(row.name || '').trim().slice(0, 60)
    if (!name) continue
    const existing = find.get(userId, name) as { id: number } | undefined
    const id = existing?.id || Number(insert.run(userId, name, row.color || '#e50914', Number(row.position || 0)).lastInsertRowid)
    if (Number(row.id)) result.set(Number(row.id), id)
  }
  return result
}

function remapAnnotationCategoryId(content: unknown, categoryMap: Map<number, number>) {
  if (typeof content !== 'string') return content
  try {
    const parsed = JSON.parse(content)
    const oldId = Number(parsed.categoryId)
    if (oldId) parsed.categoryId = categoryMap.get(oldId) ?? null
    return JSON.stringify(parsed)
  } catch {
    return content
  }
}

export async function restoreBookTrashItem(userId: number, trashId: number) {
  const item = db.prepare(`SELECT * FROM trash_items WHERE id = ? AND user_id = ? AND item_type = 'book'`)
    .get(trashId, userId) as { id: number; data_json: string } | undefined
  if (!item) return { status: 'missing' as const }
  const snapshot = parseSnapshot(item.data_json)
  if (!snapshot) return { status: 'invalid' as const }
  const filename = path.basename(String(snapshot.book.filename || ''))
  if (!filename || !existsSync(path.join(process.cwd(), 'public', 'uploads', filename))) {
    return { status: 'file_missing' as const }
  }
  const duplicate = db.prepare('SELECT id FROM books WHERE user_id = ? AND filename = ?').get(userId, filename)
  if (duplicate) return { status: 'conflict' as const }

  const oldBookId = Number(snapshot.book.id)
  const newBookId = db.transaction(() => {
    const restoredAt = new Date().toISOString()
    const bookCategoryMap = restoreSnapshotCategories(userId, 'book_categories', snapshot.bookCategories || [])
    const annotationCategoryMap = restoreSnapshotCategories(userId, 'annotation_categories', snapshot.annotationCategories || [])
    const inserted = insertSnapshotRow('books', snapshot.book, {
      user_id: userId,
      filename,
      filepath: `/api/pdf/${filename}`,
      updated_at: new Date().toISOString(),
      text_extraction_version: 0,
      file_revision: null,
    })
    const bookId = Number(inserted.lastInsertRowid)
    for (const row of snapshot.annotations) insertSnapshotRow('annotations', row, {
      user_id: userId,
      book_id: bookId,
      updated_at: restoredAt,
      ...(row.content !== undefined ? {
        content: remapAnnotationCategoryId(
          remapAnnotationPreviewUrls(row.content, oldBookId, bookId),
          annotationCategoryMap,
        ),
      } : {}),
    })
    for (const row of snapshot.bookmarks) insertSnapshotRow('bookmarks', row, { user_id: userId, book_id: bookId, updated_at: restoredAt })
    for (const row of snapshot.words) insertSnapshotRow('word_library', row, { user_id: userId, source_book_id: bookId, updated_at: restoredAt })
    for (const row of snapshot.readingSessions) insertSnapshotRow('reading_sessions', row, { user_id: userId, book_id: bookId, updated_at: restoredAt })
    const restoredCategoryIds: number[] = []
    for (const row of snapshot.categoryAssignments) {
      const categoryId = bookCategoryMap.get(Number(row.category_id))
      if (db.prepare('SELECT id FROM book_categories WHERE id = ? AND user_id = ?').get(categoryId, userId)) {
        db.prepare('INSERT OR IGNORE INTO book_category_assignments (user_id, category_id, book_id) VALUES (?, ?, ?)')
          .run(userId, categoryId, bookId)
        if (categoryId) restoredCategoryIds.push(categoryId)
      }
    }
    if (restoredCategoryIds.length) {
      const first = db.prepare('SELECT name FROM book_categories WHERE id = ? AND user_id = ?').get(restoredCategoryIds[0], userId) as { name: string } | undefined
      db.prepare('UPDATE books SET category_ids = ?, category = ? WHERE id = ? AND user_id = ?')
        .run(JSON.stringify([...new Set(restoredCategoryIds)]), first?.name || '', bookId, userId)
    }
    db.prepare('DELETE FROM trash_items WHERE id = ? AND user_id = ?').run(trashId, userId)
    return bookId
  })()
  if (oldBookId && oldBookId !== newBookId) {
    const oldAssets = annotationAssetDirectory(userId, oldBookId)
    const newAssets = annotationAssetDirectory(userId, newBookId)
    if (existsSync(oldAssets)) {
      await mkdir(path.dirname(newAssets), { recursive: true })
      await rename(oldAssets, newAssets).catch(() => {})
    }
  }
  return { status: 'restored' as const, bookId: newBookId }
}

function trashStillReferences(value: string, field: 'filename' | 'thumbnail', expected: string) {
  const snapshot = parseSnapshot(value)
  return snapshot && String(snapshot.book[field] || '') === expected
}

export async function permanentlyDeleteTrashItem(userId: number, trashId: number) {
  const item = db.prepare(`SELECT * FROM trash_items WHERE id = ? AND user_id = ? AND item_type = 'book'`)
    .get(trashId, userId) as { item_id: number; data_json: string } | undefined
  if (!item) return false
  const snapshot = parseSnapshot(item.data_json)
  db.prepare('DELETE FROM trash_items WHERE id = ? AND user_id = ?').run(trashId, userId)
  if (!snapshot) return true

  const filename = path.basename(String(snapshot.book.filename || ''))
  const thumbnail = typeof snapshot.book.thumbnail === 'string' ? snapshot.book.thumbnail : ''
  const remainingTrash = db.prepare("SELECT data_json FROM trash_items WHERE item_type = 'book'").all() as { data_json: string }[]
  if (filename
    && !db.prepare('SELECT id FROM books WHERE filename = ? LIMIT 1').get(filename)
    && !remainingTrash.some(row => trashStillReferences(row.data_json, 'filename', filename))) {
    await unlink(path.join(process.cwd(), 'public', 'uploads', filename)).catch(() => {})
  }
  if (thumbnail
    && !db.prepare('SELECT id FROM books WHERE thumbnail = ? LIMIT 1').get(thumbnail)
    && !remainingTrash.some(row => trashStillReferences(row.data_json, 'thumbnail', thumbnail))) {
    await removeManagedImage(thumbnail, 'thumbnails').catch(() => {})
  }
  await rm(annotationAssetDirectory(userId, item.item_id), { recursive: true, force: true }).catch(() => {})
  return true
}

export async function purgeExpiredTrash(userId: number, days = 30) {
  const expired = db.prepare(`
    SELECT id FROM trash_items
    WHERE user_id = ? AND deleted_at < datetime('now', ?)
    ORDER BY id LIMIT 100
  `).all(userId, `-${days} days`) as { id: number }[]
  for (const item of expired) await permanentlyDeleteTrashItem(userId, item.id)
  return expired.length
}
