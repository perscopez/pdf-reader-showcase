import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import db from '@/lib/db'
import { indexBookPages, TEXT_EXTRACTION_VERSION } from '@/lib/indexer'

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { bookId } = await req.json().catch(() => ({}))

    if (bookId && typeof bookId === 'number') {
      const book = db.prepare('SELECT id, filename FROM books WHERE id = ? AND user_id = ?').get(bookId, user.id) as { id: number; filename: string } | undefined
      if (!book) {
        return NextResponse.json({ error: 'Book not found' }, { status: 404 })
      }
      await indexBookPages(book.id, book.filename)
      return NextResponse.json({ success: true, reindexedCount: 1, message: `Re-indexed ${book.filename}` })
    }

    // Bulk reindex all books for current user
    const books = db.prepare(`
      SELECT id, filename
      FROM books
      WHERE user_id = ?
        AND lower(filename) LIKE '%.pdf'
    `).all(user.id) as { id: number; filename: string }[]

    let count = 0
    for (const book of books) {
      await indexBookPages(book.id, book.filename).catch(err => {
        console.error(`[reindex API] Failed for book ${book.id}:`, err)
      })
      count += 1
    }

    return NextResponse.json({
      success: true,
      reindexedCount: count,
      version: TEXT_EXTRACTION_VERSION,
      message: `Library re-indexing completed for ${count} books.`,
    })
  } catch (error) {
    console.error('[admin/reindex POST]', error)
    return NextResponse.json({ error: 'Re-indexing failed' }, { status: 500 })
  }
}
