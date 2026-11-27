import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { cleanText } from '@/lib/text'
import { getGroupAccess, parsePositiveId, visibleGroupAnnotation } from '@/lib/readingGroups'

export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string; annotationId: string }> }) {
  const user = getCurrentUser(req), { groupId, annotationId } = await params
  const access = user && getGroupAccess(user.id, groupId), annotation = user && access && visibleGroupAnnotation(user.id, access.groupId, annotationId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access || !annotation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(db.prepare(`
    SELECT r.id, r.annotation_id, r.author_user_id, r.content, r.created_at, r.updated_at, u.username AS author_username
    FROM reading_group_annotation_replies r JOIN users u ON u.id = r.author_user_id
    WHERE r.annotation_id = ? ORDER BY r.id
  `).all(parsePositiveId(annotationId)))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string; annotationId: string }> }) {
  const user = getCurrentUser(req), { groupId, annotationId } = await params
  const access = user && getGroupAccess(user.id, groupId), annotation = user && access && visibleGroupAnnotation(user.id, access.groupId, annotationId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access || !annotation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json() as Record<string, unknown>, content = cleanText(body.content)
  if (!content || content.length > 2000) return NextResponse.json({ error: 'Reply must be 1-2000 characters' }, { status: 400 })
  const result = db.prepare('INSERT INTO reading_group_annotation_replies (annotation_id, author_user_id, content) VALUES (?, ?, ?)').run(parsePositiveId(annotationId), user.id, content)
  return NextResponse.json({ id: Number(result.lastInsertRowid), annotation_id: parsePositiveId(annotationId), author_user_id: user.id, content }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string; annotationId: string }> }) {
  const user = getCurrentUser(req), { groupId, annotationId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const replyId = parsePositiveId(req.nextUrl.searchParams.get('id')), row = replyId && db.prepare(`
    SELECT r.author_user_id FROM reading_group_annotation_replies r
    JOIN reading_group_annotations a ON a.id = r.annotation_id
    WHERE r.id = ? AND a.id = ? AND a.group_id = ?
  `).get(replyId, parsePositiveId(annotationId), access.groupId) as { author_user_id: number } | undefined
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.author_user_id !== user.id && access.role !== 'owner') return NextResponse.json({ error: 'Author or owner authorization required' }, { status: 403 })
  db.prepare('DELETE FROM reading_group_annotation_replies WHERE id = ?').run(replyId)
  return NextResponse.json({ success: true })
}
