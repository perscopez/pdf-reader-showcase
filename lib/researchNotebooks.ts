import type BetterSqlite3 from 'better-sqlite3'
import { buildAnnotationDeepLink } from '@/lib/annotations'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'

export const MAX_NOTEBOOK_TITLE_LENGTH = 160
export const MAX_NOTEBOOK_HEADING_LENGTH = 240
export const MAX_NOTEBOOK_COMMENTARY_LENGTH = 12_000

type NotebookDatabase = Pick<BetterSqlite3.Database, 'prepare' | 'transaction'>

export type ResearchNotebookErrorCode =
  | 'not_found'
  | 'invalid_source'
  | 'encrypted_source'
  | 'duplicate_item'
  | 'invalid_order'

export class ResearchNotebookError extends Error {
  constructor(public readonly code: ResearchNotebookErrorCode, message: string) {
    super(message)
    this.name = 'ResearchNotebookError'
  }
}

export interface ResearchNotebookSource {
  annotation_id: number
  book_id: number
  book_title: string
  page: number
  type: string
  text: string
  href: string
}

export interface ResearchNotebookItem {
  id: number
  notebook_id: number
  annotation_id: number
  source_index: number
  position: number
  heading: string
  commentary: string
  created_at: string
  updated_at: string
  source: ResearchNotebookSource | null
  missing_source: boolean
  annotation_content?: Record<string, unknown>
}

export interface ResearchNotebook {
  id: number
  user_id: number
  title: string
  created_at: string
  updated_at: string
  items: ResearchNotebookItem[]
}

export interface ResearchNotebookSummary {
  id: number
  user_id: number
  title: string
  created_at: string
  updated_at: string
  item_count: number
  missing_source_count: number
}

export interface ResearchNotebookItemInput {
  annotationId: number
  sourceIndex: number
  position?: number
  heading: string
  commentary: string
}

export function normalizeNotebookTitle(value: unknown) {
  return cleanText(value == null ? '' : String(value)).replace(/\s+/g, ' ').trim().slice(0, MAX_NOTEBOOK_TITLE_LENGTH)
}

export function normalizeNotebookHeading(value: unknown) {
  return cleanText(value == null ? '' : String(value)).replace(/\s+/g, ' ').trim().slice(0, MAX_NOTEBOOK_HEADING_LENGTH)
}

export function normalizeNotebookCommentary(value: unknown) {
  return cleanText(value == null ? '' : String(value)).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, MAX_NOTEBOOK_COMMENTARY_LENGTH)
}

export function normalizeNotebookItemInput(input: unknown): ResearchNotebookItemInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const annotationId = Number(raw.annotation_id ?? raw.annotationId)
  const sourceIndex = Number(raw.source_index ?? raw.sourceIndex ?? 0)
  const position = raw.position === undefined ? undefined : Number(raw.position)
  if (!Number.isInteger(annotationId) || annotationId <= 0) return null
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex > 50) return null
  if (position !== undefined && (!Number.isInteger(position) || position < 0 || position > 10_000)) return null
  return {
    annotationId,
    sourceIndex,
    ...(position === undefined ? {} : { position }),
    heading: normalizeNotebookHeading(raw.heading),
    commentary: normalizeNotebookCommentary(raw.commentary),
  }
}

export function normalizeNotebookOrder(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 10_000) return null
  const ids = value.map(Number)
  if (ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) return null
  return ids
}

function parseAnnotationContent(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sourceForAnnotation(row: Record<string, unknown>, sourceIndex: number): ResearchNotebookSource | null {
  const bookId = Number(row.book_id)
  const annotationId = Number(row.annotation_id)
  const page = Number(row.page)
  if (!Number.isInteger(bookId) || bookId <= 0 || !Number.isInteger(annotationId) || annotationId <= 0) return null
  const content = parseAnnotationContent(row.annotation_content)
  const sources = Array.isArray(content.sources) ? content.sources as Array<Record<string, unknown>> : []
  const selected = sources.length > 0 ? sources[sourceIndex] : sourceIndex === 0 ? content : null
  if (!selected || typeof selected !== 'object') return null
  const selectedPage = Number(selected.page ?? page)
  if (!Number.isInteger(selectedPage) || selectedPage <= 0) return null
  const text = cleanText(String(selected.text ?? selected.quote ?? content.note ?? content.text ?? '')).trim()
  return {
    annotation_id: annotationId,
    book_id: bookId,
    book_title: cleanText(String(row.book_title || `Kitap #${bookId}`)).trim(),
    page: selectedPage,
    type: cleanText(String(row.annotation_type || 'note')).trim() || 'note',
    text,
    href: buildAnnotationDeepLink(bookId, selectedPage, annotationId, sourceIndex),
  }
}

function mapItem(row: Record<string, unknown>): ResearchNotebookItem {
  const annotationAvailable = row.annotation_id !== null && row.book_id !== null && !Number(row.book_is_encrypted || 0)
  const source = annotationAvailable ? sourceForAnnotation(row, Number(row.source_index || 0)) : null
  const annotationContent = annotationAvailable ? parseAnnotationContent(row.annotation_content) : undefined
  return {
    id: Number(row.id),
    notebook_id: Number(row.notebook_id),
    annotation_id: Number(row.annotation_id),
    source_index: Number(row.source_index || 0),
    position: Number(row.position || 0),
    heading: cleanText(String(row.heading || '')),
    commentary: cleanText(String(row.commentary || '')),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
    source,
    missing_source: !source,
    ...(annotationContent ? { annotation_content: annotationContent } : {}),
  }
}

function mapNotebook(row: Record<string, unknown>, items: ResearchNotebookItem[]): ResearchNotebook {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    title: cleanText(String(row.title || '')),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
    items,
  }
}

function notebookRow(database: NotebookDatabase, userId: number, notebookId: number) {
  return database.prepare('SELECT * FROM research_notebooks WHERE id = ? AND user_id = ?').get(notebookId, userId) as Record<string, unknown> | undefined
}

function itemRows(database: NotebookDatabase, notebookId: number) {
  return database.prepare(`
    SELECT i.*, a.book_id, a.page, a.type AS annotation_type, a.content AS annotation_content,
      b.title AS book_title, COALESCE(b.is_encrypted, 0) AS book_is_encrypted
    FROM research_notebook_items i
    LEFT JOIN annotations a ON a.id = i.annotation_id AND a.user_id = (
      SELECT n.user_id FROM research_notebooks n WHERE n.id = i.notebook_id
    )
    LEFT JOIN books b ON b.id = a.book_id AND b.user_id = (
      SELECT n.user_id FROM research_notebooks n WHERE n.id = i.notebook_id
    )
    WHERE i.notebook_id = ?
    ORDER BY i.position ASC, i.id ASC
  `).all(notebookId) as Record<string, unknown>[]
}

function getNotebook(database: NotebookDatabase, userId: number, notebookId: number) {
  const row = notebookRow(database, userId, notebookId)
  if (!row) return null
  return mapNotebook(row, itemRows(database, notebookId).map(mapItem))
}

export function createResearchNotebookRepository(database: NotebookDatabase = db) {
  return {
    list(userId: number): ResearchNotebookSummary[] {
      return database.prepare(`
        SELECT n.*, COUNT(i.id) AS item_count,
          SUM(CASE WHEN a.id IS NULL OR COALESCE(b.is_encrypted, 0) = 1 THEN 1 ELSE 0 END) AS missing_source_count
        FROM research_notebooks n
        LEFT JOIN research_notebook_items i ON i.notebook_id = n.id
        LEFT JOIN annotations a ON a.id = i.annotation_id AND a.user_id = n.user_id
        LEFT JOIN books b ON b.id = a.book_id AND b.user_id = n.user_id
        WHERE n.user_id = ?
        GROUP BY n.id
        ORDER BY n.updated_at DESC, n.id DESC
      `).all(userId).map(row => {
        const item = row as Record<string, unknown>
        return {
          id: Number(item.id),
          user_id: Number(item.user_id),
          title: cleanText(String(item.title || '')),
          created_at: String(item.created_at || ''),
          updated_at: String(item.updated_at || ''),
          item_count: Number(item.item_count || 0),
          missing_source_count: Number(item.missing_source_count || 0),
        }
      })
    },

    get(userId: number, notebookId: number) {
      return getNotebook(database, userId, notebookId)
    },

    create(userId: number, title: unknown) {
      const cleanTitle = normalizeNotebookTitle(title)
      if (!cleanTitle) throw new Error('Notebook title is required')
      const result = database.prepare('INSERT INTO research_notebooks (user_id, title) VALUES (?, ?)').run(userId, cleanTitle)
      return getNotebook(database, userId, Number(result.lastInsertRowid))!
    },

    update(userId: number, notebookId: number, title: unknown) {
      if (!notebookRow(database, userId, notebookId)) return null
      const cleanTitle = normalizeNotebookTitle(title)
      if (!cleanTitle) throw new Error('Notebook title is required')
      database.prepare(`UPDATE research_notebooks SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`).run(cleanTitle, notebookId, userId)
      return getNotebook(database, userId, notebookId)
    },

    delete(userId: number, notebookId: number) {
      const result = database.prepare('DELETE FROM research_notebooks WHERE id = ? AND user_id = ?').run(notebookId, userId)
      return result.changes > 0
    },

    addItem(userId: number, notebookId: number, input: ResearchNotebookItemInput) {
      if (!notebookRow(database, userId, notebookId)) throw new ResearchNotebookError('not_found', 'Notebook not found')
      const source = database.prepare(`
        SELECT a.id AS annotation_id, a.book_id, a.page, a.content AS annotation_content,
          b.title AS book_title, COALESCE(b.is_encrypted, 0) AS book_is_encrypted
        FROM annotations a
        JOIN books b ON b.id = a.book_id AND b.user_id = a.user_id
        WHERE a.id = ? AND a.user_id = ?
      `).get(input.annotationId, userId) as Record<string, unknown> | undefined
      if (!source) throw new ResearchNotebookError('invalid_source', 'Source annotation not found')
      if (Number(source.book_is_encrypted || 0)) throw new ResearchNotebookError('encrypted_source', 'Encrypted book sources stay local-only')
      if (!sourceForAnnotation(source, input.sourceIndex)) throw new ResearchNotebookError('invalid_source', 'Source index is not available')

      try {
        const insert = database.transaction(() => {
          const count = Number((database.prepare('SELECT COUNT(*) AS count FROM research_notebook_items WHERE notebook_id = ?').get(notebookId) as { count: number }).count)
          const position = Math.min(input.position ?? count, count)
          database.prepare('UPDATE research_notebook_items SET position = position + 1 WHERE notebook_id = ? AND position >= ?').run(notebookId, position)
          return database.prepare(`
            INSERT INTO research_notebook_items (notebook_id, annotation_id, source_index, position, heading, commentary)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(notebookId, input.annotationId, input.sourceIndex, position, input.heading, input.commentary)
        })()
        void insert
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new ResearchNotebookError('duplicate_item', 'Source is already in this notebook')
        throw error
      }
      database.prepare(`UPDATE research_notebooks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`).run(notebookId, userId)
      return getNotebook(database, userId, notebookId)
    },

    updateItem(userId: number, notebookId: number, itemId: number, input: Pick<ResearchNotebookItemInput, 'heading' | 'commentary'>) {
      if (!notebookRow(database, userId, notebookId)) return null
      const result = database.prepare(`
        UPDATE research_notebook_items
        SET heading = ?, commentary = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND notebook_id = ?
      `).run(input.heading, input.commentary, itemId, notebookId)
      if (!result.changes) return null
      database.prepare('UPDATE research_notebooks SET updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ? AND user_id = ?').run(notebookId, userId)
      return getNotebook(database, userId, notebookId)
    },

    deleteItem(userId: number, notebookId: number, itemId: number) {
      if (!notebookRow(database, userId, notebookId)) return false
      const result = database.prepare('DELETE FROM research_notebook_items WHERE id = ? AND notebook_id = ?').run(itemId, notebookId)
      if (result.changes) database.prepare('UPDATE research_notebooks SET updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ? AND user_id = ?').run(notebookId, userId)
      return result.changes > 0
    },

    reorder(userId: number, notebookId: number, itemIds: number[]) {
      if (!notebookRow(database, userId, notebookId)) return null
      const current = database.prepare('SELECT id FROM research_notebook_items WHERE notebook_id = ? ORDER BY position, id').all(notebookId).map(row => Number((row as { id: number }).id))
      if (current.length !== itemIds.length || current.some(id => !itemIds.includes(id))) throw new ResearchNotebookError('invalid_order', 'Order must include every notebook item exactly once')
      const reorder = database.transaction(() => {
        const update = database.prepare('UPDATE research_notebook_items SET position = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ? AND notebook_id = ?')
        itemIds.forEach((id, position) => update.run(position, id, notebookId))
        database.prepare('UPDATE research_notebooks SET updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ? AND user_id = ?').run(notebookId, userId)
      })
      reorder()
      return getNotebook(database, userId, notebookId)
    },
  }
}

export type ResearchNotebookExportFormat = 'markdown' | 'json'

function markdownText(value: string) {
  return value.replace(/\r?\n/g, '\n').trim()
}

export function serializeNotebookForExport(notebook: ResearchNotebook, format: ResearchNotebookExportFormat) {
  if (format === 'json') {
    return JSON.stringify({ version: 1, notebook }, null, 2)
  }

  const lines = [`# ${markdownText(notebook.title)}`, '', `<!-- Research notebook ${notebook.id} -->`, '']
  notebook.items.forEach((item, index) => {
    lines.push(`## ${markdownText(item.heading || `Kaynak ${index + 1}`)}`)
    if (item.source) {
      lines.push(`> ${markdownText(item.source.text || 'Alıntı metni yok.')}`)
      lines.push(`> — ${markdownText(item.source.book_title)}, s. ${item.source.page} ([Kaynağı aç](${item.source.href}))`)
    } else {
      lines.push(`> [Kaynak bulunamadı] Annotation #${item.annotation_id}`)
    }
    if (item.commentary) lines.push('', markdownText(item.commentary))
    lines.push('')
  })
  return lines.join('\n').trimEnd() + '\n'
}

export function notebookExportFilename(title: string, format: ResearchNotebookExportFormat) {
  const base = normalizeNotebookTitle(title).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'research-notebook'
  return `${base}.${format === 'json' ? 'json' : 'md'}`
}
