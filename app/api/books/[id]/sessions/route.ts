import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser, userOwnsBook } from '@/lib/auth'

interface SessionRow {
  id: number
  book_id: number
  start_page: number
  end_page: number
  pages_read: number
  duration_seconds: number
  started_at: string
  ended_at: string
}

function normalizePage(value: unknown, fallback = 1) {
  return Math.max(1, Math.floor(Number(value) || fallback))
}

function normalizeDuration(value: unknown) {
  return Math.max(0, Math.floor(Number(value) || 0))
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(_req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { id } = await params
    if (!userOwnsBook(user.id, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const recent = db.prepare(`
      SELECT *
      FROM reading_sessions
      WHERE book_id = ? AND user_id = ?
      ORDER BY datetime(started_at) DESC, id DESC
      LIMIT 8
    `).all(id, user.id) as SessionRow[]

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(duration_seconds), 0) AS total_seconds,
        COALESCE(SUM(pages_read), 0) AS total_pages,
        COUNT(*) AS session_count
      FROM reading_sessions
      WHERE book_id = ? AND user_id = ?
    `).get(id, user.id) as { total_seconds: number; total_pages: number; session_count: number }

    const last7 = db.prepare(`
      SELECT
        COALESCE(SUM(duration_seconds), 0) AS seconds,
        COALESCE(SUM(pages_read), 0) AS pages,
        COUNT(DISTINCT date(started_at)) AS active_days
      FROM reading_sessions
      WHERE book_id = ? AND user_id = ? AND datetime(started_at) >= datetime('now', '-7 days')
    `).get(id, user.id) as { seconds: number; pages: number; active_days: number }

    const today = db.prepare(`
      SELECT
        COALESCE(SUM(duration_seconds), 0) AS seconds,
        COALESCE(SUM(pages_read), 0) AS pages
      FROM reading_sessions
      WHERE book_id = ? AND user_id = ? AND date(started_at) = date('now')
    `).get(id, user.id) as { seconds: number; pages: number }

    const avgSecondsPerPage = totals.total_pages > 0 ? totals.total_seconds / totals.total_pages : null

    return NextResponse.json({
      recent,
      totals,
      last7,
      today,
      avg_seconds_per_page: avgSecondsPerPage,
      daily_pages: last7.pages ? Math.round((last7.pages / 7) * 10) / 10 : 0,
    })
  } catch (err) {
    console.error('[reading sessions GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { id } = await params
    if (!userOwnsBook(user.id, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const startPage = normalizePage(body.start_page)
    const endPage = normalizePage(body.end_page, startPage)
    const duration = normalizeDuration(body.duration_seconds)
    const pagesRead = Math.max(1, Math.floor(Number(body.pages_read) || Math.abs(endPage - startPage) + 1))
    const startedAt = typeof body.started_at === 'string' ? body.started_at : new Date().toISOString()
    const endedAt = typeof body.ended_at === 'string' ? body.ended_at : new Date().toISOString()

    if (duration <= 5) {
      return NextResponse.json({ skipped: true })
    }

    const updateBook = db.prepare(`
      UPDATE books
      SET
        last_page = ?,
        last_opened_at = ?,
        total_reading_time = COALESCE(total_reading_time, 0) + ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
        AND user_id = ?
    `)

    const result = db.transaction(() => {
      const inserted = db.prepare(`
        INSERT INTO reading_sessions (user_id, book_id, start_page, end_page, pages_read, duration_seconds, started_at, ended_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(user.id, id, startPage, endPage, pagesRead, duration, startedAt, endedAt)
      updateBook.run(endPage, endedAt, duration, id, user.id)
      return inserted
    })()

    const row = db.prepare('SELECT * FROM reading_sessions WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, user.id)
    return NextResponse.json(row)
  } catch (err) {
    console.error('[reading sessions POST]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
