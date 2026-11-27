import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { cleanTextDeep } from '@/lib/text'
import { getGroupAccess, groupBook, parseJsonContent, parsePositiveId, visibleGroupAnnotation, type GroupVisibility } from '@/lib/readingGroups'

function output(row: Record<string, unknown>) {
  return { ...row, content: parseJsonContent(row.content) }
}

function visibility(value: unknown): GroupVisibility | null {
  return value === 'private' || value === 'group' ? value : null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const rows = db.prepare(`
    SELECT a.*, u.username AS author_username
    FROM reading_group_annotations a JOIN users u ON u.id = a.author_user_id
    WHERE a.group_id = ? AND (a.visibility = 'group' OR a.author_user_id = ?)
    ORDER BY a.page, a.id
  `).all(access.groupId, user.id) as Record<string, unknown>[]
  return NextResponse.json(rows.map(output))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json() as Record<string, unknown>
  const bookId = parsePositiveId(body.book_id), page = Number(body.page), type = typeof body.type === 'string' ? body.type.trim().slice(0, 30) : ''
  const book = bookId && groupBook(access.groupId, bookId)
  const sharedVisibility = visibility(body.visibility) || 'group'
  if (!book || !Number.isInteger(page) || page < 1 || page > 100000 || !type || !body.content || typeof body.content !== 'object') {
    return NextResponse.json({ error: 'Invalid shared annotation' }, { status: 400 })
  }
  const content = cleanTextDeep(body.content)
  const result = db.prepare(`
    INSERT INTO reading_group_annotations (group_id, book_id, author_user_id, type, content, page, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(access.groupId, book.id, user.id, type, JSON.stringify(content), page, sharedVisibility)
  const row = visibleGroupAnnotation(user.id, access.groupId, result.lastInsertRowid)
  return NextResponse.json(row ? output(row) : { error: 'Database error' }, { status: row ? 201 : 500 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json() as Record<string, unknown>, id = parsePositiveId(body.id)
  const current = id ? db.prepare('SELECT * FROM reading_group_annotations WHERE id = ? AND group_id = ?').get(id, access.groupId) as Record<string, unknown> | undefined : undefined
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (current.author_user_id !== user.id && access.role !== 'owner') return NextResponse.json({ error: 'Author or owner authorization required' }, { status: 403 })
  const nextVisibility = body.visibility === undefined ? current.visibility as GroupVisibility : visibility(body.visibility)
  if (!nextVisibility) return NextResponse.json({ error: 'Invalid visibility' }, { status: 400 })
  const nextContent = body.content && typeof body.content === 'object' ? JSON.stringify(cleanTextDeep(body.content)) : current.content
  db.prepare("UPDATE reading_group_annotations SET content = ?, visibility = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND group_id = ?").run(nextContent, nextVisibility, id, access.groupId)
  const updated = visibleGroupAnnotation(user.id, access.groupId, id)
  return NextResponse.json(updated ? output(updated) : { error: 'Private annotation' }, { status: updated ? 200 : 404 })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId), id = parsePositiveId(req.nextUrl.searchParams.get('id'))
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const current = id ? db.prepare('SELECT author_user_id FROM reading_group_annotations WHERE id = ? AND group_id = ?').get(id, access.groupId) as { author_user_id: number } | undefined : undefined
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (current.author_user_id !== user.id && access.role !== 'owner') return NextResponse.json({ error: 'Author or owner authorization required' }, { status: 403 })
  db.prepare('DELETE FROM reading_group_annotations WHERE id = ? AND group_id = ?').run(id, access.groupId)
  return NextResponse.json({ success: true })
}
