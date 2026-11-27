import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { normalizeGroupText } from '@/lib/readingGroups'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const rows = db.prepare(`
    SELECT g.id, g.name, g.description, g.owner_user_id, g.created_at, g.updated_at,
      (SELECT COUNT(*) FROM reading_group_members m WHERE m.group_id = g.id) AS member_count,
      (SELECT COUNT(*) FROM reading_group_books b WHERE b.group_id = g.id) AS book_count
    FROM reading_groups g
    JOIN reading_group_members mine ON mine.group_id = g.id AND mine.user_id = ?
    ORDER BY g.updated_at DESC, g.id DESC
  `).all(user.id)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const name = normalizeGroupText(body.name, 80)
  const description = normalizeGroupText(body.description, 500)
  if (name.length < 2) return NextResponse.json({ error: 'Group name is required' }, { status: 400 })
  try {
    const id = db.transaction(() => {
      const result = db.prepare('INSERT INTO reading_groups (owner_user_id, name, description) VALUES (?, ?, ?)').run(user.id, name, description)
      const groupId = Number(result.lastInsertRowid)
      db.prepare("INSERT INTO reading_group_members (group_id, user_id, role) VALUES (?, ?, 'owner')").run(groupId, user.id)
      return groupId
    })()
    return NextResponse.json({ id, name, description, owner_user_id: user.id, member_count: 1, book_count: 0 }, { status: 201 })
  } catch (error) {
    if (String(error).includes('UNIQUE')) return NextResponse.json({ error: 'A group with this name already exists' }, { status: 409 })
    console.error('[reading-groups POST]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
