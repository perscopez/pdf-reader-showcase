import { readFile, stat } from 'fs/promises'
import { execFile } from 'child_process'
import path from 'path'
import { pathToFileURL } from 'url'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import db from './db'
import { buildReflowPageFromText, type ReflowPage } from './reflow'
import { cleanText, repairTurkishWordSpacing } from './text'
import { buildDocumentRevisionFingerprint, buildNativePageTextModel, PAGE_TEXT_MODEL_VERSION } from './pdfTextModel'

export const TEXT_EXTRACTION_VERSION = PAGE_TEXT_MODEL_VERSION

/** Maximum pages we will full-text-index. Larger books are saved but not searchable. */
const MAX_INDEXABLE_PAGES = 2000

/** Hard wall on how long any single extraction step may run (ms). */
const INDEXER_TIMEOUT_MS = 60_000

const execFileAsync = promisify(execFile)
const INDEX_LEASE_MS = 5 * 60 * 1000
const INDEX_WORKER_ID = `${process.pid}-${randomUUID()}`

export async function getDocumentRevisionFingerprint(filename: string) {
  const safeFilename = path.basename(filename)
  const filePath = path.join(process.cwd(), 'public', 'uploads', safeFilename)
  const info = await stat(filePath)
  return buildDocumentRevisionFingerprint({ filename: safeFilename, size: info.size, mtimeMs: info.mtimeMs })
}

function splitPdfPages(output: string): string[] {
  const pages = output.replace(/\r/g, '').split('\f')
  if (pages[pages.length - 1]?.trim() === '') pages.pop()
  return pages
}

/** Returns a promise that rejects after `ms` milliseconds. */
function rejectAfter(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`[Indexer] ${label} timed out after ${ms}ms`)), ms)
  )
}

/**
 * Fast page-count lookup using pdfinfo (poppler). Returns null if pdfinfo is
 * unavailable or the file is not a valid PDF — the caller must decide what to do.
 */
async function getPageCount(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('pdfinfo', [filePath], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    const match = /Pages:\s+(\d+)/i.exec(stdout)
    return match ? parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

async function extractWithPoppler(filePath: string): Promise<ReflowPage[]> {
  const options = {
    encoding: 'utf8' as const,
    maxBuffer: 128 * 1024 * 1024,
    timeout: INDEXER_TIMEOUT_MS,
  }
  const [rawResult, layoutResult] = await Promise.all([
    execFileAsync('pdftotext', ['-enc', 'UTF-8', '-raw', filePath, '-'], options),
    execFileAsync('pdftotext', ['-enc', 'UTF-8', '-layout', filePath, '-'], options),
  ])
  const rawPages = splitPdfPages(rawResult.stdout)
  const layoutPages = splitPdfPages(layoutResult.stdout)
  return rawPages.map((rawPage, index) => buildReflowPageFromText(rawPage, layoutPages[index] || ''))
}

async function extractWithPdfJs(filePath: string, documentFingerprint: string): Promise<ReflowPage[]> {
  const doExtract = async (): Promise<ReflowPage[]> => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
    ).href
    const data = new Uint8Array(await readFile(filePath))
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise
    const pages: ReflowPage[] = []
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo)
      const content = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })
      const model = buildNativePageTextModel(
        content.items.filter(item => 'str' in item),
        { width: viewport.width, height: viewport.height },
        {
          documentFingerprint,
          engine: 'pdfjs',
          engineVersion: typeof pdfjs.version === 'string' ? pdfjs.version : undefined,
          rotation: 0,
        },
      )
      pages.push({ version: 1, blocks: model.blocks, text: model.text })
    }
    return pages
  }

  return Promise.race([doExtract(), rejectAfter(INDEXER_TIMEOUT_MS, 'PDF.js extraction')])
}

export async function indexBookPages(bookId: number, filename: string) {
  if (!filename.toLowerCase().endsWith('.pdf')) return

  console.log(`[Indexer v${TEXT_EXTRACTION_VERSION}] Starting indexing for Book ID ${bookId}: ${filename}...`)

  try {
    const filePath = path.join(process.cwd(), 'public', 'uploads', filename)
    const fileRevision = await getDocumentRevisionFingerprint(filename)

    const pageCount = await getPageCount(filePath)
    if (pageCount !== null && pageCount > MAX_INDEXABLE_PAGES) {
      console.warn(
        `[Indexer] Book ID ${bookId} has ${pageCount} pages (limit ${MAX_INDEXABLE_PAGES}). ` +
        `Skipping full-text indexing — book will still open normally.`
      )
      db.prepare('UPDATE books SET text_extraction_version = ?, file_revision = ? WHERE id = ?')
        .run(TEXT_EXTRACTION_VERSION, fileRevision, bookId)
      return
    }

    let pages: ReflowPage[]
    try {
      pages = await extractWithPdfJs(filePath, fileRevision)
      console.log(`[Indexer] Geometry-aware PDF.js extraction selected for Book ID ${bookId}.`)
    } catch (pdfJsError) {
      console.warn(`[Indexer] PDF.js unavailable or timed out for Book ID ${bookId}; using Poppler fallback.`, pdfJsError)
      pages = await extractWithPoppler(filePath)
    }

    if (pages.length > MAX_INDEXABLE_PAGES) {
      console.warn(
        `[Indexer] Book ID ${bookId} yielded ${pages.length} pages after extraction ` +
        `(limit ${MAX_INDEXABLE_PAGES}). Skipping indexing.`
      )
      db.prepare('UPDATE books SET text_extraction_version = ?, file_revision = ? WHERE id = ?')
        .run(TEXT_EXTRACTION_VERSION, fileRevision, bookId)
      return
    }

    console.log(`[Indexer] Loaded PDF. Total pages: ${pages.length}`)

    const insertStmt = db.prepare(`
      INSERT INTO book_pages (book_id, page_number, content, layout_json, extraction_version, file_revision)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id, page_number) DO UPDATE SET
        content = excluded.content,
        layout_json = excluded.layout_json,
        extraction_version = excluded.extraction_version,
        file_revision = excluded.file_revision
    `)
    const extractedPages: Array<{ pageNo: number; text: string; layoutJson: string }> = []

    pages.forEach((reflowPage, index) => {
      const rawText = reflowPage.text.replace(/\s+/g, ' ').trim()
      const repairedText = repairTurkishWordSpacing(cleanText(rawText))
      if (repairedText) {
        extractedPages.push({ pageNo: index + 1, text: repairedText, layoutJson: JSON.stringify(reflowPage) })
      }
    })

    db.transaction(() => {
      db.prepare('DELETE FROM book_pages WHERE book_id = ?').run(bookId)
      for (const extracted of extractedPages) {
        insertStmt.run(bookId, extracted.pageNo, extracted.text, extracted.layoutJson, TEXT_EXTRACTION_VERSION, fileRevision)
      }
      db.prepare('UPDATE books SET text_extraction_version = ?, file_revision = ? WHERE id = ?')
        .run(TEXT_EXTRACTION_VERSION, fileRevision, bookId)
    })()

    console.log(`[Indexer v${TEXT_EXTRACTION_VERSION}] Finished indexing Book ID ${bookId}.`)
  } catch (err) {
    console.error(`[Indexer] Failed to index book ID ${bookId}:`, err)
    throw err
  }
}

export function enqueueBookIndexing(bookId: number) {
  const book = db.prepare(`
    SELECT id, user_id, filename, COALESCE(is_encrypted, 0) AS is_encrypted
    FROM books WHERE id = ?
  `).get(bookId) as { id: number; user_id: number; filename: string; is_encrypted: number } | undefined
  if (!book || book.is_encrypted || !book.filename.toLowerCase().endsWith('.pdf')) return false

  db.prepare(`
    INSERT INTO background_ocr_queue (
      user_id, book_id, status, current_page, total_pages, error, job_type,
      attempts, lease_owner, lease_expires_at, updated_at
    ) VALUES (?, ?, 'pending', 0, 0, '', 'text_extraction', 0, NULL, NULL, datetime('now'))
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      status = CASE
        WHEN background_ocr_queue.status = 'running'
          AND unixepoch(background_ocr_queue.lease_expires_at) > unixepoch('now')
        THEN background_ocr_queue.status ELSE 'pending' END,
      error = CASE
        WHEN background_ocr_queue.status = 'running'
          AND unixepoch(background_ocr_queue.lease_expires_at) > unixepoch('now')
        THEN background_ocr_queue.error ELSE '' END,
      lease_owner = CASE
        WHEN background_ocr_queue.status = 'running'
          AND unixepoch(background_ocr_queue.lease_expires_at) > unixepoch('now')
        THEN background_ocr_queue.lease_owner ELSE NULL END,
      lease_expires_at = CASE
        WHEN background_ocr_queue.status = 'running'
          AND unixepoch(background_ocr_queue.lease_expires_at) > unixepoch('now')
        THEN background_ocr_queue.lease_expires_at ELSE NULL END,
      updated_at = datetime('now')
  `).run(book.user_id, book.id)
  kickIndexingQueue()
  return true
}

type ClaimedIndexJob = { id: number; book_id: number; filename: string }

function claimIndexJob(): ClaimedIndexJob | null {
  const claim = db.transaction(() => {
    const job = db.prepare(`
      SELECT q.id, q.book_id, b.filename
      FROM background_ocr_queue q
      JOIN books b ON b.id = q.book_id AND b.user_id = q.user_id
      WHERE q.job_type = 'text_extraction'
        AND COALESCE(b.is_encrypted, 0) = 0
        AND (q.status = 'pending' OR (q.status = 'running' AND unixepoch(q.lease_expires_at) <= unixepoch('now')))
      ORDER BY q.updated_at, q.id
      LIMIT 1
    `).get() as ClaimedIndexJob | undefined
    if (!job) return null
    const leaseExpiresAt = new Date(Date.now() + INDEX_LEASE_MS).toISOString()
    const result = db.prepare(`
      UPDATE background_ocr_queue
      SET status = 'running', attempts = attempts + 1, lease_owner = ?,
          lease_expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
        AND (status = 'pending' OR (status = 'running' AND unixepoch(lease_expires_at) <= unixepoch('now')))
    `).run(INDEX_WORKER_ID, leaseExpiresAt, job.id)
    return result.changes ? job : null
  })
  return claim.immediate()
}

let drainPromise: Promise<void> | null = null

export function drainIndexingQueue() {
  if (drainPromise) return drainPromise
  drainPromise = (async () => {
    while (true) {
      const job = claimIndexJob()
      if (!job) return
      try {
        await indexBookPages(job.book_id, job.filename)
        db.prepare(`
          UPDATE background_ocr_queue
          SET status = 'completed', error = '', lease_owner = NULL,
              lease_expires_at = NULL, updated_at = datetime('now')
          WHERE id = ? AND lease_owner = ?
        `).run(job.id, INDEX_WORKER_ID)
      } catch (error) {
        db.prepare(`
          UPDATE background_ocr_queue
          SET status = 'failed', error = ?, lease_owner = NULL,
              lease_expires_at = NULL, updated_at = datetime('now')
          WHERE id = ? AND lease_owner = ?
        `).run(error instanceof Error ? error.message.slice(0, 1000) : 'Indexing failed', job.id, INDEX_WORKER_ID)
      }
    }
  })().finally(() => { drainPromise = null })
  return drainPromise
}

function kickIndexingQueue() {
  queueMicrotask(() => { void drainIndexingQueue() })
}

export async function startIndexingExistingBooks() {
  const books = db.prepare(`
    SELECT b.id
    FROM books b
    WHERE lower(b.filename) LIKE '%.pdf'
      AND COALESCE(b.is_encrypted, 0) = 0
      AND COALESCE(b.text_extraction_version, 0) < ?
  `).all(TEXT_EXTRACTION_VERSION) as { id: number }[]
  for (const book of books) enqueueBookIndexing(book.id)
  return drainIndexingQueue()
}
