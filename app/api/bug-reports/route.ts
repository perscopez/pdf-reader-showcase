import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { cleanText } from '@/lib/text'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const reports = db.prepare(`
      SELECT
        bug_reports.id,
        bug_reports.message,
        bug_reports.page_url,
        bug_reports.created_at,
        bug_reports.resolved,
        bug_reports.resolved_at,
        COALESCE(users.username, 'Deleted user') AS username
      FROM bug_reports
      LEFT JOIN users ON users.id = bug_reports.user_id
      ORDER BY bug_reports.created_at DESC, bug_reports.id DESC
      LIMIT 200
    `).all()

    return NextResponse.json(reports, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[bug-reports GET]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = await req.json()
    const id = Number(body.id)
    if (!Number.isSafeInteger(id) || id <= 0 || typeof body.resolved !== 'boolean') {
      return NextResponse.json({ error: 'Invalid report update' }, { status: 400 })
    }

    const result = body.resolved
      ? db.prepare(`
          UPDATE bug_reports
          SET resolved = 1, resolved_at = datetime('now'), resolved_by_user_id = ?
          WHERE id = ?
        `).run(user.id, id)
      : db.prepare(`
          UPDATE bug_reports
          SET resolved = 0, resolved_at = NULL, resolved_by_user_id = NULL
          WHERE id = ?
        `).run(id)

    if (!result.changes) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    return NextResponse.json({ id, resolved: body.resolved })
  } catch (error) {
    console.error('[bug-reports PATCH]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const body = await req.json()
    const message = cleanText(body.message || '').trim().slice(0, 2000)
    const pageUrl = cleanText(body.pageUrl || '').trim().slice(0, 500)
    if (message.length < 5) {
      return NextResponse.json({ error: 'Report is too short' }, { status: 400 })
    }

    const result = db.prepare(
      'INSERT INTO bug_reports (user_id, message, page_url) VALUES (?, ?, ?)'
    ).run(user.id, message, pageUrl)

    return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
  } catch (error) {
    console.error('[bug-reports POST]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
