import db from '@/lib/db'

export interface BookCategorySummary {
  id: number
  name: string
  color: string
  position: number
}

export function normalizeBookCategoryIds(value: unknown, limit = 50): number[] {
  let values: unknown[] = []
  if (Array.isArray(value)) values = value
  else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) values = parsed
    } catch {
      values = []
    }
  }
  return [...new Set(values.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, limit)
}

export function categoriesForBook(userId: number, bookId: number): BookCategorySummary[] {
  return db.prepare(`
    SELECT c.id, c.name, c.color, c.position
    FROM book_category_assignments a
    JOIN book_categories c ON c.id = a.category_id AND c.user_id = a.user_id
    WHERE a.user_id = ? AND a.book_id = ?
    ORDER BY c.position, c.name, c.id
  `).all(userId, bookId) as BookCategorySummary[]
}

export function ensureBookCategoryByName(userId: number, value: unknown): number | null {
  const name = typeof value === 'string' ? value.trim().slice(0, 60) : ''
  if (!name) return null
  const existing = db.prepare('SELECT id FROM book_categories WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, name) as { id: number } | undefined
  if (existing) return existing.id
  const count = (db.prepare('SELECT COUNT(*) count FROM book_categories WHERE user_id = ?').get(userId) as { count: number }).count
  if (count >= 50) throw new Error('CATEGORY_LIMIT')
  return Number(db.prepare('INSERT INTO book_categories (user_id, name, color, position) VALUES (?, ?, ?, ?)').run(userId, name, '#e50914', count).lastInsertRowid)
}

export function decorateBookCategories<T extends Record<string, unknown>>(userId: number, rows: T[]): Array<T & { categories: BookCategorySummary[]; category_ids: number[] }> {
  if (!rows.length) return []
  const ids = rows.map(row => Number(row.id)).filter(id => Number.isInteger(id) && id > 0)
  const placeholders = ids.map(() => '?').join(', ')
  const assignments = placeholders ? db.prepare(`
    SELECT a.book_id, c.id, c.name, c.color, c.position
    FROM book_category_assignments a
    JOIN book_categories c ON c.id = a.category_id AND c.user_id = a.user_id
    WHERE a.user_id = ? AND a.book_id IN (${placeholders})
    ORDER BY c.position, c.name, c.id
  `).all(userId, ...ids) as Array<BookCategorySummary & { book_id: number }> : []
  const byBook = new Map<number, BookCategorySummary[]>()
  for (const assignment of assignments) {
    const current = byBook.get(assignment.book_id) || []
    current.push({ id: assignment.id, name: assignment.name, color: assignment.color, position: assignment.position })
    byBook.set(assignment.book_id, current)
  }
  return rows.map(row => {
    const categories = byBook.get(Number(row.id)) || []
    return { ...row, categories, category_ids: categories.map(category => category.id) }
  })
}

export function refreshBookCategoryMirror(userId: number, bookId: number) {
  const categories = categoriesForBook(userId, bookId)
  db.prepare(`
    UPDATE books
    SET category = ?, category_ids = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND user_id = ?
  `).run(categories[0]?.name || '', JSON.stringify(categories.map(category => category.id)), bookId, userId)
  return categories
}

export function setBookCategoryAssignments(userId: number, bookId: number, value: unknown) {
  const categoryIds = normalizeBookCategoryIds(value)
  const book = db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').get(bookId, userId)
  if (!book) throw new Error('BOOK_NOT_FOUND')
  if (categoryIds.length) {
    const placeholders = categoryIds.map(() => '?').join(', ')
    const count = (db.prepare(`SELECT COUNT(*) count FROM book_categories WHERE user_id = ? AND id IN (${placeholders})`).get(userId, ...categoryIds) as { count: number }).count
    if (count !== categoryIds.length) throw new Error('INVALID_CATEGORY')
  }
  db.prepare('DELETE FROM book_category_assignments WHERE user_id = ? AND book_id = ?').run(userId, bookId)
  const insert = db.prepare('INSERT INTO book_category_assignments (user_id, category_id, book_id) VALUES (?, ?, ?)')
  for (const categoryId of categoryIds) insert.run(userId, categoryId, bookId)
  return refreshBookCategoryMirror(userId, bookId)
}

export function replaceCategoryBooks(userId: number, categoryId: number, value: unknown) {
  const category = db.prepare('SELECT id FROM book_categories WHERE id = ? AND user_id = ?').get(categoryId, userId)
  if (!category) throw new Error('CATEGORY_NOT_FOUND')
  const bookIds = normalizeBookCategoryIds(value, 500)
  if (bookIds.length) {
    const placeholders = bookIds.map(() => '?').join(', ')
    const count = (db.prepare(`SELECT COUNT(*) count FROM books WHERE user_id = ? AND id IN (${placeholders})`).get(userId, ...bookIds) as { count: number }).count
    if (count !== bookIds.length) throw new Error('INVALID_BOOK')
  }
  const previous = (db.prepare('SELECT book_id FROM book_category_assignments WHERE user_id = ? AND category_id = ?').all(userId, categoryId) as { book_id: number }[]).map(row => row.book_id)
  db.prepare('DELETE FROM book_category_assignments WHERE user_id = ? AND category_id = ?').run(userId, categoryId)
  const insert = db.prepare('INSERT INTO book_category_assignments (user_id, category_id, book_id) VALUES (?, ?, ?)')
  for (const bookId of bookIds) insert.run(userId, categoryId, bookId)
  for (const bookId of new Set([...previous, ...bookIds])) refreshBookCategoryMirror(userId, bookId)
  return bookIds
}
