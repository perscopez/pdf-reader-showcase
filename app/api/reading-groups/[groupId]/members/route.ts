import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { getGroupAccess, normalizeGroupText, parsePositiveId } from '@/lib/readingGroups'

export async function GET(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(db.prepare(`
    SELECT m.user_id, u.username, m.role, m.created_at
    FROM reading_group_members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.username
  `).all(access.groupId))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access || access.role !== 'owner') return NextResponse.json({ error: 'Owner authorization required' }, { status: 403 })
  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const username = normalizeGroupText(body.username, 80)
  const target = db.prepare("SELECT id FROM users WHERE username = ? AND deleted_at IS NULL").get(username) as { id: number } | undefined
  if (!target || target.id === user.id) return NextResponse.json({ error: 'User not found or already owner' }, { status: 404 })
  try {
    db.prepare("INSERT INTO reading_group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(access.groupId, target.id)
    db.prepare("UPDATE reading_groups SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(access.groupId)
    return NextResponse.json({ user_id: target.id, username, role: 'member' }, { status: 201 })
  } catch (error) {
    if (String(error).includes('UNIQUE')) return NextResponse.json({ error: 'User is already a member' }, { status: 409 })
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = getCurrentUser(req), { groupId } = await params
  const access = user && getGroupAccess(user.id, groupId)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (!access || access.role !== 'owner') return NextResponse.json({ error: 'Owner authorization required' }, { status: 403 })
  const memberId = parsePositiveId(req.nextUrl.searchParams.get('user_id'))
  if (!memberId || memberId === user.id) return NextResponse.json({ error: 'Invalid member' }, { status: 400 })
  db.prepare('DELETE FROM reading_group_members WHERE group_id = ? AND user_id = ? AND role = \'member\'').run(access.groupId, memberId)
  return NextResponse.json({ success: true })
}
