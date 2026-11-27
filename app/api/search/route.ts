import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { cleanText } from '@/lib/text'
import { indexBookPages } from '@/lib/indexer'

const userIndexingPromises = new Map<number, Promise<void>>()

async function ensureUserPdfPagesIndexed(userId: number) {
  const running = userIndexingPromises.get(userId)
  if (running) {
    await running
    return
  }

  const indexingPromise = (async () => {
    const books = db.prepare(`
      SELECT b.id, b.filename
      FROM books b
      LEFT JOIN book_pages bp ON bp.book_id = b.id
      WHERE b.user_id = ?
        AND lower(b.filename) LIKE '%.pdf'
      GROUP BY b.id
      HAVING COUNT(bp.id) = 0
    `).all(userId) as { id: number; filename: string }[]

    for (const book of books) {
      await indexBookPages(book.id, book.filename)
    }
  })().finally(() => {
    userIndexingPromises.delete(userId)
  })

  userIndexingPromises.set(userId, indexingPromise)
  await indexingPromise
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const query = req.nextUrl.searchParams.get('q')
  const q = cleanText(query || '').trim()

  if (q.length < 2) {
    return NextResponse.json({ results: [], indexing: false })
  }

  try {
    // Indexing an entire library must never block the first search response.
    // Start it in the background; already-indexed pages can be searched immediately.
    const indexingPromise = ensureUserPdfPagesIndexed(user.id)
    const indexing = userIndexingPromises.has(user.id)
    void indexingPromise.catch(err => console.error('[search index]', err))

    const searchPattern = `%${q}%`

    // 1) Başlık eşleşmeleri: sadece bir satır (kitap adı + sayfa 1)
    const titleMatches = db.prepare(`
      SELECT
        -b.id AS id,
        b.id  AS bookId,
        b.title,
        1     AS page,
        b.title AS text
      FROM books b
      WHERE b.user_id = ? AND b.title LIKE ?
      ORDER BY b.title COLLATE NOCASE
      LIMIT 20
    `).all(user.id, searchPattern) as { id: number; bookId: number; title: string; page: number; text: string }[]

    const titleMatchedBookIds = new Set(titleMatches.map(r => r.bookId))

    // 2) İçerik eşleşmeleri: başlık eşleşen kitapları atla, kitap başına max 5 sayfa
    const contentMatches = db.prepare(`
      SELECT
        bp.id,
        bp.book_id AS bookId,
        b.title,
        bp.page_number AS page,
        bp.content AS text,
        ROW_NUMBER() OVER (PARTITION BY bp.book_id ORDER BY bp.page_number) AS rn
      FROM book_pages bp
      JOIN books b ON bp.book_id = b.id
      WHERE b.user_id = ?
        AND bp.content LIKE ?
      ORDER BY b.title COLLATE NOCASE, bp.page_number
    `).all(user.id, searchPattern) as { id: number; bookId: number; title: string; page: number; text: string; rn: number }[]

    const filteredContent = contentMatches
      .filter(r => !titleMatchedBookIds.has(r.bookId) && r.rn <= 5)
      .slice(0, 40)

    const results = [...titleMatches, ...filteredContent].slice(0, 40)

    return NextResponse.json({ results, indexing })
  } catch (err) {
    console.error('[search GET]', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
