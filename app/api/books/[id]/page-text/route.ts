import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse, getOwnedBookProtection } from '@/lib/encryptedBookPolicy'
import { fallbackReflowPage, type ReflowPage } from '@/lib/reflow'
import { enqueueBookIndexing, getDocumentRevisionFingerprint, TEXT_EXTRACTION_VERSION } from '@/lib/indexer'
import { checkRateLimit } from '@/lib/rateLimit'
import {
  isValidPageTextModel,
  PAGE_TEXT_MODEL_VERSION,
  pageTextModelMatchesDocument,
  type PageTextModel,
} from '@/lib/pdfTextModel'

async function getBookExtractionState(bookId: number) {
  const book = db.prepare(`
    SELECT filename, COALESCE(text_extraction_version, 0) AS version, file_revision
    FROM books WHERE id = ?
  `).get(bookId) as { filename: string; version: number; file_revision: string | null } | undefined
  if (!book) return null
  try {
    return { ...book, currentRevision: await getDocumentRevisionFingerprint(book.filename) }
  } catch {
    return { ...book, currentRevision: '' }
  }
}

function parseLayout(layoutJson: string | null, content: string): ReflowPage {
  if (layoutJson) {
    try {
      const parsed = JSON.parse(layoutJson) as ReflowPage
      if (parsed.version === 1 && Array.isArray(parsed.blocks)) return parsed
    } catch { /* fall back to legacy text */ }
  }
  return fallbackReflowPage(content)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { id } = await params
  const bookId = Number(id)
  if (!bookId) return NextResponse.json({ error: 'Invalid book ID' }, { status: 400 })
  const protection = getOwnedBookProtection(user.id, bookId)
  if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

  const pageParam = req.nextUrl.searchParams.get('page')

  try {
    const extraction = await getBookExtractionState(bookId)
    if (!extraction) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const extractionIsCurrent = Boolean(
      extraction.currentRevision
      && extraction.file_revision === extraction.currentRevision
      && extraction.version >= TEXT_EXTRACTION_VERSION
    )

    if (pageParam !== null) {
      const pageNumber = Number(pageParam)
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100_000) {
        return NextResponse.json({ error: 'Invalid page' }, { status: 400 })
      }
      const cached = db.prepare(`
        SELECT model_json
        FROM page_text_models
        WHERE user_id = ? AND book_id = ? AND page_number = ? AND extraction_version = ?
        LIMIT 1
      `).get(user.id, bookId, pageNumber, PAGE_TEXT_MODEL_VERSION) as { model_json: string } | undefined
      if (cached?.model_json) {
        try {
          const model = JSON.parse(cached.model_json)
          if (
            isValidPageTextModel(model)
            && extraction.currentRevision
            && pageTextModelMatchesDocument(model, extraction.currentRevision)
          ) {
            return NextResponse.json({
              page: pageNumber,
              text: model.text,
              blocks: model.blocks,
              words: model.words,
              source: model.source,
              quality: model.quality,
              model,
            })
          }
        } catch {
          // Ignore an invalid cache row and fall back to indexed native text.
        }
      }
      const row = db.prepare(`
        SELECT page_number, content, layout_json, extraction_version, file_revision
        FROM book_pages WHERE book_id = ? AND page_number = ? LIMIT 1
      `).get(bookId, pageNumber) as {
        page_number: number
        content: string
        layout_json: string | null
        extraction_version: number
        file_revision: string | null
      } | undefined
      const validRow = row
        && row.extraction_version >= TEXT_EXTRACTION_VERSION
        && row.file_revision === extraction.currentRevision
      if (!validRow) {
        const indexingQueued = extractionIsCurrent ? false : enqueueBookIndexing(bookId)
        return NextResponse.json({ page: pageNumber, text: '', blocks: [], indexingQueued })
      }
      const layout = parseLayout(row.layout_json, row.content)
      return NextResponse.json({ page: row.page_number, text: layout.text, blocks: layout.blocks })
    }

    const limitParam = req.nextUrl.searchParams.get('limit')
    const cursorParam = req.nextUrl.searchParams.get('cursor')
    const limit = limitParam === null ? 50 : Number(limitParam)
    const cursor = cursorParam === null ? 0 : Number(cursorParam)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return NextResponse.json({ error: 'Invalid limit' }, { status: 400 })
    }
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 100_000) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
    }

    const indexingQueued = extractionIsCurrent ? false : enqueueBookIndexing(bookId)
    const rows = extraction.currentRevision ? db.prepare(`
      SELECT page_number, content
      FROM book_pages
      WHERE book_id = ? AND page_number > ?
        AND extraction_version >= ? AND file_revision = ?
      ORDER BY page_number
      LIMIT ?
    `).all(bookId, cursor, TEXT_EXTRACTION_VERSION, extraction.currentRevision, limit + 1) as { page_number: number; content: string }[] : []
    const hasMore = rows.length > limit
    const pages = rows.slice(0, limit)
    const nextCursor = hasMore ? pages[pages.length - 1]?.page_number ?? null : null

    return NextResponse.json({
      pages,
      pagination: { limit, nextCursor, hasMore },
      indexingQueued,
    })
  } catch (err) {
    console.error('[page-text GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = checkRateLimit(req, 'page-text-model-write', 120, 60 * 60 * 1000)
  if (limited) return limited

  const { id } = await params
  const bookId = Number(id)
  if (!Number.isInteger(bookId) || bookId < 1) {
    return NextResponse.json({ error: 'Invalid book ID' }, { status: 400 })
  }
  const protection = getOwnedBookProtection(user.id, bookId)
  if (protection === 'missing') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

  const declaredLength = Number(req.headers.get('content-length') || 0)
  if (declaredLength > 2_000_000) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  }

  try {
    const body = await req.json() as { page?: unknown; model?: unknown }
    const page = Number(body.page)
    if (!Number.isInteger(page) || page < 1 || page > 100_000) {
      return NextResponse.json({ error: 'Invalid page' }, { status: 400 })
    }
    if (!isValidPageTextModel(body.model)) {
      return NextResponse.json({ error: 'Invalid page text model' }, { status: 400 })
    }
    const submittedModel: PageTextModel = body.model
    const extraction = await getBookExtractionState(bookId)
    if (!extraction?.currentRevision) {
      return NextResponse.json({ error: 'Book file unavailable' }, { status: 409 })
    }
    const model: PageTextModel = {
      ...submittedModel,
      provenance: {
        ...submittedModel.provenance,
        documentFingerprint: extraction.currentRevision,
      },
    }
    if (!model.text.trim() || JSON.stringify(model).length > 2_000_000) {
      return NextResponse.json({ error: 'Invalid page text model' }, { status: 400 })
    }

    const current = db.prepare(`
      SELECT source, quality, extraction_version, model_json
      FROM page_text_models
      WHERE user_id = ? AND book_id = ? AND page_number = ?
    `).get(user.id, bookId, page) as {
      source: string
      quality: number
      extraction_version: number
      model_json: string
    } | undefined
    let currentMatchesDocument = false
    if (current?.model_json) {
      try {
        const currentModel = JSON.parse(current.model_json)
        currentMatchesDocument = isValidPageTextModel(currentModel)
          && pageTextModelMatchesDocument(currentModel, extraction.currentRevision)
      } catch { /* stale or malformed model */ }
    }
    const keepCurrent = Boolean(
      current
      && currentMatchesDocument
      && current.extraction_version >= model.version
      && current.source === 'ocr'
      && (
        (model.source !== 'ocr' && current.quality >= model.quality)
        || (model.source === 'ocr' && current.quality > model.quality)
      )
    )
    if (keepCurrent) {
      return NextResponse.json({ success: true, keptExisting: true })
    }

    const reflow: ReflowPage = {
      version: 1,
      text: model.text,
      blocks: model.blocks,
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO page_text_models (
          user_id, book_id, page_number, model_json, source, quality,
          extraction_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(book_id, page_number) DO UPDATE SET
          user_id = excluded.user_id,
          model_json = excluded.model_json,
          source = excluded.source,
          quality = excluded.quality,
          extraction_version = excluded.extraction_version,
          updated_at = datetime('now')
      `).run(
        user.id,
        bookId,
        page,
        JSON.stringify(model),
        model.source,
        model.quality,
        model.version,
      )
      db.prepare(`
        INSERT INTO book_pages (book_id, page_number, content, layout_json, extraction_version, file_revision)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(book_id, page_number) DO UPDATE SET
          content = excluded.content,
          layout_json = excluded.layout_json,
          extraction_version = excluded.extraction_version,
          file_revision = excluded.file_revision
      `).run(bookId, page, model.text, JSON.stringify(reflow), model.version, extraction.currentRevision)
    })()

    return NextResponse.json({ success: true, keptExisting: false })
  } catch (error) {
    console.error('[page-text POST]', error)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
