import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { startIndexingExistingBooks } from '@/lib/indexer'
import { decorateBookCategories } from '@/lib/bookCategories'

interface BookListRow {
  total_reading_time?: number
  session_reading_time?: number
  [key: string]: unknown
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  // Trigger background indexing for any unindexed PDF books
  startIndexingExistingBooks().catch(err => {
    console.error('[Books API] Background startup indexing failed:', err)
  })

  try {
    const books = db.prepare(`
      SELECT
        b.*,
        COUNT(DISTINCT a.id) AS annotation_count,
        COUNT(DISTINCT bm.id) AS bookmark_count,
        COUNT(DISTINCT w.id) AS word_count,
        COALESCE(rt.session_reading_time, 0) AS session_reading_time
      FROM books b
      LEFT JOIN annotations a ON a.book_id = b.id AND a.user_id = b.user_id
      LEFT JOIN bookmarks bm ON bm.book_id = b.id AND bm.user_id = b.user_id
      LEFT JOIN word_library w ON w.source_book_id = b.id AND w.user_id = b.user_id
      LEFT JOIN (
        SELECT book_id, user_id, SUM(duration_seconds) AS session_reading_time
        FROM reading_sessions
        GROUP BY book_id, user_id
      ) rt ON rt.book_id = b.id AND rt.user_id = b.user_id
      WHERE b.user_id = ?
      GROUP BY b.id
      ORDER BY COALESCE(b.last_opened_at, b.created_at) DESC
    `).all(user.id) as BookListRow[]
    return NextResponse.json(decorateBookCategories(user.id, books.map(book => ({
      ...book,
      total_reading_time: Math.max(Number(book.total_reading_time || 0), Number(book.session_reading_time || 0)),
    }))))
  } catch (err) {
    console.error('[books GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
