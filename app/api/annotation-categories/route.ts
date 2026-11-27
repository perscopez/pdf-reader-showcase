import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import {
  categoryNameKey,
  normalizeCategoryColor,
  normalizeCategoryName,
  parseCategoryId,
} from '@/lib/annotationCategories'

type Row = { id: number; user_id: number; name: string; color: string; position: number; created_at: string; updated_at: string }

function list(userId: number) {
  return db.prepare('SELECT id, name, color, position, created_at, updated_at FROM annotation_categories WHERE user_id = ? ORDER BY position, name, id').all(userId)
}

function duplicateName(userId: number, name: string, exceptId?: number) {
  const rows = db.prepare('SELECT id, name FROM annotation_categories WHERE user_id = ?').all(userId) as Pick<Row, 'id' | 'name'>[]
  return rows.some(row => row.id !== exceptId && categoryNameKey(row.name) === categoryNameKey(name))
}

function ownsCategory(userId: number, id: number) {
  return db.prepare('SELECT * FROM annotation_categories WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  return NextResponse.json(list(user.id))
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const body = await req.json() as Record<string, unknown>

  if (body.action === 'merge') {
    const sourceId = parseCategoryId(body.source_id)
    const targetId = parseCategoryId(body.target_id)
    if (!sourceId || !targetId || sourceId === targetId || !ownsCategory(user.id, sourceId) || !ownsCategory(user.id, targetId)) {
      return NextResponse.json({ error: 'Invalid category merge' }, { status: 400 })
    }
    db.transaction(() => {
      const rows = db.prepare('SELECT id, content FROM annotations WHERE user_id = ?').all(user.id) as { id: number; content: string }[]
      const update = db.prepare(`UPDATE annotations SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`)
      for (const row of rows) {
        const content = JSON.parse(row.content) as Record<string, unknown>
        if (Number(content.categoryId) === sourceId) update.run(JSON.stringify({ ...content, categoryId: targetId }), row.id, user.id)
      }
      db.prepare('DELETE FROM annotation_categories WHERE id = ? AND user_id = ?').run(sourceId, user.id)
      db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, 'annotation_category', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(user.id, sourceId)
    })()
    return NextResponse.json(list(user.id))
  }

  const name = normalizeCategoryName(body.name)
  if (!name) return NextResponse.json({ error: 'Category name required' }, { status: 400 })
  if ((db.prepare('SELECT COUNT(*) count FROM annotation_categories WHERE user_id = ?').get(user.id) as { count: number }).count >= 50) {
    return NextResponse.json({ error: 'Category limit reached' }, { status: 400 })
  }
  if (duplicateName(user.id, name)) return NextResponse.json({ error: 'Category already exists' }, { status: 409 })
  const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 position FROM annotation_categories WHERE user_id = ?').get(user.id) as { position: number }).position
  const result = db.prepare('INSERT INTO annotation_categories (user_id, name, color, position) VALUES (?, ?, ?, ?)').run(user.id, name, normalizeCategoryColor(body.color), position)
  return NextResponse.json(ownsCategory(user.id, Number(result.lastInsertRowid)), { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const body = await req.json() as Record<string, unknown>
  const id = parseCategoryId(body.id)
  if (!id || !ownsCategory(user.id, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const name = normalizeCategoryName(body.name)
  if (!name || duplicateName(user.id, name, id)) return NextResponse.json({ error: 'Invalid or duplicate category' }, { status: 409 })
  const position = Number.isInteger(Number(body.position)) ? Math.max(0, Number(body.position)) : 0
  db.prepare(`UPDATE annotation_categories SET name = ?, color = ?, position = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`)
    .run(name, normalizeCategoryColor(body.color), position, id, user.id)
  return NextResponse.json(ownsCategory(user.id, id))
}

export async function DELETE(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const id = parseCategoryId(req.nextUrl.searchParams.get('id'))
  const unassign = req.nextUrl.searchParams.get('unassign') === '1'
  if (!id || !ownsCategory(user.id, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const used = (db.prepare('SELECT content FROM annotations WHERE user_id = ?').all(user.id) as { content: string }[])
    .some(row => Number((JSON.parse(row.content) as Record<string, unknown>).categoryId) === id)
  if (used && !unassign) return NextResponse.json({ error: 'Category is in use' }, { status: 409 })
  db.transaction(() => {
    if (used) {
      const rows = db.prepare('SELECT id, content FROM annotations WHERE user_id = ?').all(user.id) as { id: number; content: string }[]
      const update = db.prepare(`UPDATE annotations SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`)
      for (const row of rows) {
        const content = JSON.parse(row.content) as Record<string, unknown>
        if (Number(content.categoryId) === id) update.run(JSON.stringify({ ...content, categoryId: null }), row.id, user.id)
      }
    }
    db.prepare('DELETE FROM annotation_categories WHERE id = ? AND user_id = ?').run(id, user.id)
    db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, 'annotation_category', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(user.id, id)
  })()
  return NextResponse.json({ success: true })
}
