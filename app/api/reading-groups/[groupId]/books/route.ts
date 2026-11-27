import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { getGroupAccess, groupOwnerId, parsePositiveId } from '@/lib/readingGroups'

export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(db.prepare(`
    SELECT b.id, b.title, b.author, b.filename, b.total_pages, b.is_encrypted, a.created_at AS shared_at
    FROM reading_group_books a JOIN books b ON b.id = a.book_id
    WHERE a.group_id = ? ORDER BY a.created_at DESC, b.title
  `).all(access.groupId))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access || access.role !== 'owner') return NextResponse.json({ error: 'Owner authorization required' }, { status: 403 })
  const body = await req.json() as Record<string, unknown>
  const bookId = parsePositiveId(body.book_id), ownerId = groupOwnerId(access.groupId)
  const book = bookId && ownerId ? db.prepare('SELECT id, is_encrypted FROM books WHERE id = ? AND user_id = ?').get(bookId, ownerId) as { id: number; is_encrypted: number } | undefined : undefined
  if (!book) return NextResponse.json({ error: 'Only an owner book can be shared' }, { status: 404 })
  if (book.is_encrypted) return NextResponse.json({ error: 'Encrypted books cannot be shared' }, { status: 409 })
  try {
    db.prepare('INSERT INTO reading_group_books (group_id, book_id, added_by_user_id) VALUES (?, ?, ?)').run(access.groupId, book.id, user.id)
    db.prepare("UPDATE reading_groups SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(access.groupId)
    return NextResponse.json({ id: book.id }, { status: 201 })
  } catch (error) {
    if (String(error).includes('UNIQUE')) return NextResponse.json({ error: 'Book is already shared' }, { status: 409 })
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access || access.role !== 'owner') return NextResponse.json({ error: 'Owner authorization required' }, { status: 403 })
  const bookId = parsePositiveId(req.nextUrl.searchParams.get('book_id'))
  if (!bookId) return NextResponse.json({ error: 'Invalid book' }, { status: 400 })
  db.prepare('DELETE FROM reading_group_books WHERE group_id = ? AND book_id = ?').run(access.groupId, bookId)
  return NextResponse.json({ success: true })
}
