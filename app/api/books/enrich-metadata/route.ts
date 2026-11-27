import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import db from '@/lib/db'
import { extractMetadataFromText, formatBookString } from '@/lib/metadataExtractor'
import { fetchOnlineBookMetadata } from '@/lib/bookSources'
import { getCurrentUser } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'

interface BookRow {
  id: number
  filename: string
  filepath: string | null
  title: string
  author: string
  isbn: string | null
  language: string | null
  thumbnail: string | null
}

export interface EnrichedBookDetail {
  id: number
  oldTitle: string
  newTitle: string
  oldAuthor: string
  newAuthor: string
  isbn: string | null
  language: string
  changes: string[]
}

export interface UntouchedBookDetail {
  id: number
  title: string
  author: string
  filename: string
  reason: string
}

/**
 * Checks if a title looks like junk from a filename rather than a clean,
 * human-entered title. A clean title should be simple words without
 * timestamps, hashes, underscores, file extensions, etc.
 */
function titleNeedsFix(title: string): boolean {
  if (!title) return true
  if (/^\d{10,}/.test(title)) return true       // starts with timestamp
  if (/[_]/.test(title)) return true              // underscores
  if (/\.(pdf|epub)$/i.test(title)) return true   // file extension
  if (/--/.test(title)) return true               // double dash metadata
  if (/\b[0-9a-f]{16,}\b/i.test(title)) return true // hex hash
  if (/PDFDrive|z-lib|Anna.?s?.?Archive|dokumen/i.test(title)) return true
  if (/^\d+[-\s]/.test(title)) return true        // leading number
  return false
}

function authorNeedsFix(author: string): boolean {
  if (!author) return true
  if (author === 'Bilinmeyen Yazar') return true
  if (/^\d/.test(author)) return true
  if (/[_]/.test(author)) return true
  return false
}

async function handleEnrich(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const limited = checkRateLimit(req, 'enrich-metadata', 10, 60 * 1000)
  if (limited) return limited

  let body: { bookId?: number; forceOnline?: boolean } = {}
  try {
    if (req.method === 'POST') {
      body = await req.json()
    }
  } catch {
    // optional body
  }

  const { searchParams } = new URL(req.url)
  const singleBookId = body.bookId || (searchParams.get('bookId') ? Number(searchParams.get('bookId')) : undefined)

  try {
    let books: BookRow[] = []
    if (singleBookId) {
      books = db
        .prepare('SELECT id, filename, filepath, title, author, isbn, language, thumbnail FROM books WHERE id = ?')
        .all(singleBookId) as BookRow[]
    } else {
      try {
        books = db
          .prepare('SELECT id, filename, filepath, title, author, isbn, language, thumbnail FROM books WHERE deleted_at IS NULL')
          .all() as BookRow[]
      } catch {
        books = db
          .prepare('SELECT id, filename, filepath, title, author, isbn, language, thumbnail FROM books')
          .all() as BookRow[]
      }
    }

    const updatedBooks: EnrichedBookDetail[] = []
    const untouchedBooks: UntouchedBookDetail[] = []

    for (const book of books) {
      try {
        let textSample = ''

        try {
          const textPath = path.join(process.cwd(), 'public', 'uploads', `${book.filename}.txt`)
          textSample = await fs.readFile(textPath, 'utf8')
        } catch {
          // Text sample not pre-cached
        }

        if (!textSample) {
          textSample = `${book.title} ${book.filename}`
        }

        const extracted = extractMetadataFromText(textSample, book.filename)
        const changes: string[] = []

        // Start with current DB values
        let newTitle = book.title
        let newAuthor = book.author
        let newIsbn = book.isbn || extracted.isbn || null
        const newLang = book.language || extracted.language || 'tr'
        let newThumbnail = book.thumbnail

        // Determine if we need to fix the title/author based on quality
        const needsTitleFix = titleNeedsFix(book.title)
        const needsAuthorFix = authorNeedsFix(book.author)
        const needsThumbnailFix = !book.thumbnail || book.thumbnail.includes('-migrated.')

        // If the title or author looks clean (user set it manually), keep it
        // Only run enrichment if something needs fixing
        if (needsTitleFix || needsAuthorFix || needsThumbnailFix || newIsbn) {
          // Step 1: Try local filename parsing for a quick cleanup
          if (needsTitleFix && extracted.title) {
            newTitle = extracted.title
          }
          if (needsAuthorFix && extracted.author) {
            newAuthor = extracted.author
          }

          // Step 2: Online API lookup — this is the primary source of truth
          // Build a search query from the best available data
          const searchTitle = formatBookString(book.filename)
          const online = await fetchOnlineBookMetadata(
            searchTitle || newTitle,
            needsAuthorFix ? '' : newAuthor,
            newIsbn || undefined
          )

          if (online) {
            // Always prefer online title/author over filename-parsed junk
            if (online.title && online.title.length > 2) {
              if (needsTitleFix) {
                changes.push(`Başlık Düzeltildi: "${book.title}" ➔ "${online.title}"`)
                newTitle = online.title
              }
            }
            if (online.author && online.author.length > 1) {
              if (needsAuthorFix) {
                changes.push(`Yazar Bulundu: "${book.author || 'Bilinmeyen Yazar'}" ➔ "${online.author}"`)
                newAuthor = online.author
              }
            }
            if (online.coverUrl && needsThumbnailFix) {
              newThumbnail = online.coverUrl
              changes.push('Kapak görseli güncellendi.')
            }
            if (online.isbn && !newIsbn) {
              newIsbn = online.isbn
              changes.push(`ISBN Bulundu: ${newIsbn}`)
            }
          } else {
            // Online failed — use local cleanup if title still needs fixing
            if (needsTitleFix && newTitle !== book.title) {
              changes.push(`Başlık Temizlendi: "${book.title}" ➔ "${newTitle}"`)
            }
            if (needsAuthorFix && newAuthor && newAuthor !== book.author) {
              changes.push(`Yazar Güncellendi: "${book.author || 'Bilinmeyen Yazar'}" ➔ "${newAuthor}"`)
            }
          }
        }

        if (changes.length > 0) {
          try {
            db.prepare(
              'UPDATE books SET title = ?, author = ?, isbn = ?, language = ?, thumbnail = COALESCE(?, thumbnail) WHERE id = ?'
            ).run(newTitle, newAuthor, newIsbn, newLang, newThumbnail, book.id)
          } catch {
            db.prepare(
              'UPDATE books SET title = ?, author = ? WHERE id = ?'
            ).run(newTitle, newAuthor, book.id)
          }

          // Propagate cleanly across matching filepath entries
          if (book.filepath) {
            try {
              db.prepare(
                'UPDATE books SET title = ?, author = ?, thumbnail = COALESCE(?, thumbnail) WHERE filepath = ? AND id != ?'
              ).run(newTitle, newAuthor, newThumbnail, book.filepath, book.id)
            } catch {
              // ignore
            }
          }

          updatedBooks.push({
            id: book.id,
            oldTitle: book.title,
            newTitle,
            oldAuthor: book.author,
            newAuthor,
            isbn: newIsbn,
            language: newLang,
            changes,
          })
        } else {
          untouchedBooks.push({
            id: book.id,
            title: book.title,
            author: book.author,
            filename: book.filename,
            reason: 'Tüm metaveriler zaten güncel ve düzenli.',
          })
        }
      } catch (err) {
        console.warn(`[enrich-metadata] Book ${book.id} skipped:`, err)
      }
    }

    return NextResponse.json({
      success: true,
      totalScanned: books.length,
      updatedCount: updatedBooks.length,
      updatedBooks,
      untouchedBooks,
    })
  } catch (error) {
    console.error('Enrich metadata error:', error)
    return NextResponse.json({ success: true, totalScanned: 0, updatedCount: 0, updatedBooks: [], untouchedBooks: [] })
  }
}

export async function POST(req: NextRequest) {
  return handleEnrich(req)
}

export async function GET(req: NextRequest) {
  return handleEnrich(req)
}
