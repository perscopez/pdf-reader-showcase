import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { categoryNameKey, normalizeCategoryColor, normalizeCategoryName, parseCategoryId } from '@/lib/annotationCategories'
import { refreshBookCategoryMirror, replaceCategoryBooks } from '@/lib/bookCategories'

type Row = { id: number; user_id: number; name: string; color: string; position: number }
const list = (userId: number) => db.prepare(`
  SELECT c.id, c.name, c.color, c.position, c.created_at, c.updated_at, COUNT(a.id) bookCount
  FROM book_categories c
  LEFT JOIN book_category_assignments a ON a.user_id = c.user_id AND a.category_id = c.id
  WHERE c.user_id = ?
  GROUP BY c.id
  ORDER BY c.position, c.name, c.id
`).all(userId)
const owned = (userId: number, id: number) => db.prepare('SELECT * FROM book_categories WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined
function duplicate(userId: number, name: string, except?: number) {
  return (db.prepare('SELECT id, name FROM book_categories WHERE user_id = ?').all(userId) as Pick<Row, 'id' | 'name'>[])
    .some(row => row.id !== except && categoryNameKey(row.name) === categoryNameKey(name))
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const existing = list(user.id) as Row[]
  const names = db.prepare(`SELECT DISTINCT category name FROM books WHERE user_id = ? AND TRIM(category) <> ''`).all(user.id) as { name: string }[]
  if (names.some(item => !existing.some(row => categoryNameKey(row.name) === categoryNameKey(item.name)))) {
    const insert = db.prepare('INSERT INTO book_categories (user_id, name, color, position) VALUES (?, ?, ?, ?)')
    db.transaction(() => {
      let position = existing.length
      for (const item of names) if (!existing.some(row => categoryNameKey(row.name) === categoryNameKey(item.name))) insert.run(user.id, normalizeCategoryName(item.name), normalizeCategoryColor(null), position++)
    })()
  }
  return NextResponse.json(list(user.id))
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const body = await req.json() as Record<string, unknown>
  if (body.action === 'set-books') {
    const categoryId = parseCategoryId(body.category_id)
    if (!categoryId) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    try {
      db.transaction(() => replaceCategoryBooks(user.id, categoryId, body.book_ids))()
      return NextResponse.json(list(user.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      return NextResponse.json({ error: message === 'INVALID_BOOK' ? 'Invalid book' : 'Invalid category' }, { status: 400 })
    }
  }
  if (body.action === 'merge') {
    const sourceId = parseCategoryId(body.source_id), targetId = parseCategoryId(body.target_id)
    const source = sourceId ? owned(user.id, sourceId) : undefined, target = targetId ? owned(user.id, targetId) : undefined
    if (!source || !target || source.id === target.id) return NextResponse.json({ error: 'Invalid merge' }, { status: 400 })
    db.transaction(() => {
      const affected = (db.prepare('SELECT book_id FROM book_category_assignments WHERE user_id = ? AND category_id IN (?, ?)').all(user.id, source.id, target.id) as { book_id: number }[]).map(row => row.book_id)
      db.prepare(`
        INSERT OR IGNORE INTO book_category_assignments (user_id, category_id, book_id)
        SELECT user_id, ?, book_id FROM book_category_assignments
        WHERE user_id = ? AND category_id = ?
      `).run(target.id, user.id, source.id)
      db.prepare('DELETE FROM book_category_assignments WHERE user_id = ? AND category_id = ?').run(user.id, source.id)
      db.prepare('DELETE FROM book_categories WHERE id = ? AND user_id = ?').run(source.id, user.id)
      for (const bookId of new Set(affected)) refreshBookCategoryMirror(user.id, bookId)
    })()
    return NextResponse.json(list(user.id))
  }
  const name = normalizeCategoryName(body.name)
  if (!name || duplicate(user.id, name)) return NextResponse.json({ error: 'Invalid or duplicate category' }, { status: 409 })
  const count = (db.prepare('SELECT COUNT(*) count FROM book_categories WHERE user_id = ?').get(user.id) as { count: number }).count
  if (count >= 50) return NextResponse.json({ error: 'Category limit reached' }, { status: 400 })
  const result = db.prepare('INSERT INTO book_categories (user_id, name, color, position) VALUES (?, ?, ?, ?)').run(user.id, name, normalizeCategoryColor(body.color), count)
  return NextResponse.json(owned(user.id, Number(result.lastInsertRowid)), { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const body = await req.json() as Record<string, unknown>, id = parseCategoryId(body.id)
  const current = id ? owned(user.id, id) : undefined, name = normalizeCategoryName(body.name)
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!name || duplicate(user.id, name, current.id)) return NextResponse.json({ error: 'Invalid or duplicate category' }, { status: 409 })
  db.transaction(() => {
    db.prepare(`UPDATE book_categories SET name = ?, color = ?, position = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`)
      .run(name, normalizeCategoryColor(body.color), Math.max(0, Number(body.position) || 0), current.id, user.id)
    if (current.name !== name) {
      const assigned = db.prepare('SELECT book_id FROM book_category_assignments WHERE user_id = ? AND category_id = ?').all(user.id, current.id) as { book_id: number }[]
      for (const row of assigned) refreshBookCategoryMirror(user.id, row.book_id)
    }
  })()
  return NextResponse.json(owned(user.id, current.id))
}

export async function DELETE(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const id = parseCategoryId(req.nextUrl.searchParams.get('id')), current = id ? owned(user.id, id) : undefined
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  db.transaction(() => {
    const affected = (db.prepare('SELECT book_id FROM book_category_assignments WHERE user_id = ? AND category_id = ?').all(user.id, current.id) as { book_id: number }[]).map(row => row.book_id)
    db.prepare('DELETE FROM book_category_assignments WHERE user_id = ? AND category_id = ?').run(user.id, current.id)
    db.prepare('DELETE FROM book_categories WHERE id = ? AND user_id = ?').run(current.id, user.id)
    for (const bookId of affected) refreshBookCategoryMirror(user.id, bookId)
  })()
  return NextResponse.json({ success: true })
}
