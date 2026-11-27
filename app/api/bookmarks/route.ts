import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse, getOwnedBookProtection } from '@/lib/encryptedBookPolicy'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const bookId = req.nextUrl.searchParams.get('book_id')
  if (!bookId) return NextResponse.json({ error: 'book_id required' }, { status: 400 })
  const protection = getOwnedBookProtection(user.id, bookId)
  if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

  try {
    const rows = db.prepare('SELECT * FROM bookmarks WHERE book_id = ? AND user_id = ? ORDER BY page').all(bookId, user.id)
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[bookmarks GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { book_id, page, label } = await req.json()
    const protection = getOwnedBookProtection(user.id, book_id)
    if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

    const existing = db.prepare('SELECT id FROM bookmarks WHERE book_id = ? AND page = ? AND user_id = ?').get(book_id, page, user.id) as { id: number } | undefined
    if (existing) {
      db.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id)
      db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(user.id, 'bookmark', existing.id)
    }
    const result = db.prepare(
      'INSERT INTO bookmarks (user_id, book_id, page, label) VALUES (?, ?, ?, ?)'
    ).run(user.id, book_id, page, label ?? null)
    const row = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, user.id)
    return NextResponse.json(row)
  } catch (err) {
    console.error('[bookmarks POST]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  try {
    const deleted = db.prepare('SELECT id FROM bookmarks WHERE id = ? AND user_id = ?').get(id, user.id)
    db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(id, user.id)
    if (deleted) {
      db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(user.id, 'bookmark', id)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[bookmarks DELETE]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
