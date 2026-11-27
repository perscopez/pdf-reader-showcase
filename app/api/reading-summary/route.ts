import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { computeStreak } from '@/lib/readingGoals'

interface ReadingSummaryBook {
  bookId: number
  title: string
  author: string
  seconds: number
  pages: number
  sessions: number
}

function periodSummary(userId: number, whereSql: string) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(duration_seconds), 0) AS seconds,
      COALESCE(SUM(pages_read), 0) AS pages,
      COUNT(*) AS sessions
    FROM reading_sessions
    WHERE user_id = ?
      AND ${whereSql}
  `).get(userId) as { seconds: number; pages: number; sessions: number }

  const books = db.prepare(`
    SELECT
      b.id AS bookId,
      b.title,
      b.author,
      COALESCE(SUM(rs.duration_seconds), 0) AS seconds,
      COALESCE(SUM(rs.pages_read), 0) AS pages,
      COUNT(*) AS sessions
    FROM reading_sessions rs
    JOIN books b ON b.id = rs.book_id AND b.user_id = rs.user_id
    WHERE rs.user_id = ?
      AND ${whereSql.replaceAll('started_at', 'rs.started_at')}
    GROUP BY b.id
    ORDER BY seconds DESC, MAX(datetime(rs.started_at)) DESC
    LIMIT 6
  `).all(userId) as ReadingSummaryBook[]

  return { ...totals, books }
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const readingDays = (db.prepare(`
      SELECT DISTINCT date(started_at) AS day
      FROM reading_sessions
      WHERE user_id = ?
        AND duration_seconds > 0
      ORDER BY day DESC
      LIMIT 400
    `).all(user.id) as { day: string }[]).map(row => row.day)

    return NextResponse.json({
      today: periodSummary(user.id, "date(started_at) = date('now')"),
      week: periodSummary(user.id, "datetime(started_at) >= datetime('now', '-7 days')"),
      streak: computeStreak(readingDays),
      readingDays,
    })
  } catch (err) {
    console.error('[reading-summary GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
