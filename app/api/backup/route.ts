import { NextRequest, NextResponse } from 'next/server'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { ZipArchive } from 'archiver'
import JSZip from 'jszip'
import db from '@/lib/db'
import { parseStoredZip, type ZipEntry } from '@/lib/zip'
import { cleanText, cleanTextDeep } from '@/lib/text'
import { getCurrentUser } from '@/lib/auth'
import { annotationPreviewPaths } from '@/lib/annotationAssets'
import { audioNotePath } from '@/lib/audioNoteStorage'

export const runtime = 'nodejs'

interface BackupShape {
  version: 1 | 2
  exported_at: string
  books: Record<string, unknown>[]
  annotations: Record<string, unknown>[]
  bookmarks: Record<string, unknown>[]
  word_library: Record<string, unknown>[]
  reading_sessions: Record<string, unknown>[]
  annotation_categories?: Record<string, unknown>[]
  book_categories?: Record<string, unknown>[]
  book_category_assignments?: Record<string, unknown>[]
  research_notebooks?: Record<string, unknown>[]
  research_notebook_items?: Record<string, unknown>[]
  audio_note_sessions?: Record<string, unknown>[]
  audio_note_markers?: Record<string, unknown>[]
}

function safeFilename(value: unknown) {
  return path.basename(String(value || '')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
}

function parseContent(value: unknown) {
  if (typeof value !== 'string') return value ?? {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function stringifyContent(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(cleanTextDeep(value ?? {}))
}

function remapAnnotationCategory(value: unknown, categoryMap: Map<number, number>) {
  const parsed = parseContent(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed
  const record = parsed as Record<string, unknown>
  const oldCategoryId = Number(record.categoryId)
  if (oldCategoryId) record.categoryId = categoryMap.get(oldCategoryId) ?? null
  return record
}

function remapAnnotationBookAssets(value: unknown, oldBookId: number, newBookId: number) {
  const parsed = parseContent(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || oldBookId === newBookId) return parsed
  const remapArea = (area: { previewUrl?: unknown } | undefined) => {
    if (typeof area?.previewUrl !== 'string') return
    area.previewUrl = area.previewUrl.replace(new RegExp(`([?&]book_id=)${oldBookId}(?=&|$)`), `$1${newBookId}`)
  }
  const record = parsed as { area?: { previewUrl?: unknown }; sources?: Array<{ area?: { previewUrl?: unknown } }> }
  remapArea(record.area)
  record.sources?.forEach(source => remapArea(source.area))
  return record
}

function publicUploadPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/uploads/')) return null
  const relative = value.replace(/^\/uploads\//, '')
  const normalized = relative.split('/').map(safeFilename).filter(Boolean).join('/')
  if (!normalized || normalized !== relative.replace(/\\/g, '/')) return null
  return {
    archiveName: `uploads/${normalized}`,
    filePath: path.join(process.cwd(), 'public', 'uploads', ...normalized.split('/')),
  }
}

async function parseBackupZip(buffer: Buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer)
    return Promise.all(Object.values(zip.files)
      .filter(entry => !entry.dir)
      .map(async entry => ({ name: entry.name, data: await entry.async('nodebuffer') } satisfies ZipEntry)))
  } catch {
    return parseStoredZip(buffer)
  }
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const books = db.prepare('SELECT * FROM books WHERE user_id = ? ORDER BY id').all(user.id) as Record<string, unknown>[]
    const annotations: Record<string, unknown>[] = (db.prepare('SELECT * FROM annotations WHERE user_id = ? ORDER BY id').all(user.id) as Record<string, unknown>[])
      .map(row => ({ ...row, content: parseContent(row.content) }))
    const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY id').all(user.id) as Record<string, unknown>[]
    const wordLibrary = db.prepare('SELECT * FROM word_library WHERE user_id = ? ORDER BY id').all(user.id) as Record<string, unknown>[]
    const readingSessions = db.prepare('SELECT * FROM reading_sessions WHERE user_id = ? ORDER BY id').all(user.id) as Record<string, unknown>[]
    const annotationCategories = db.prepare('SELECT * FROM annotation_categories WHERE user_id = ? ORDER BY position, id').all(user.id) as Record<string, unknown>[]
    const bookCategories = db.prepare('SELECT * FROM book_categories WHERE user_id = ? ORDER BY position, id').all(user.id) as Record<string, unknown>[]
    const bookCategoryAssignments = db.prepare('SELECT * FROM book_category_assignments WHERE user_id = ? ORDER BY id').all(user.id) as Record<string, unknown>[]
    const researchNotebooks = db.prepare('SELECT * FROM research_notebooks WHERE user_id = ? ORDER BY id').all(user.id) as Record<string, unknown>[]
    const researchNotebookItems = db.prepare(`
      SELECT i.* FROM research_notebook_items i
      JOIN research_notebooks n ON n.id = i.notebook_id AND n.user_id = ?
      ORDER BY i.notebook_id, i.position, i.id
    `).all(user.id) as Record<string, unknown>[]
    const audioNoteSessions = db.prepare(`
      SELECT s.* FROM audio_note_sessions s
      JOIN books b ON b.id = s.book_id AND b.user_id = s.user_id
      WHERE s.user_id = ? ORDER BY s.id
    `).all(user.id) as Record<string, unknown>[]
    const audioNoteMarkers = db.prepare(`
      SELECT m.* FROM audio_note_markers m
      JOIN audio_note_sessions s ON s.id = m.session_id AND s.user_id = ?
      ORDER BY m.session_id, m.timestamp_ms, m.id
    `).all(user.id) as Record<string, unknown>[]

    const backup: BackupShape = {
      version: 2,
      exported_at: new Date().toISOString(),
      books,
      annotations,
      bookmarks,
      word_library: wordLibrary,
      reading_sessions: readingSessions,
      annotation_categories: annotationCategories,
      book_categories: bookCategories,
      book_category_assignments: bookCategoryAssignments,
      research_notebooks: researchNotebooks,
      research_notebook_items: researchNotebookItems,
      audio_note_sessions: audioNoteSessions,
      audio_note_markers: audioNoteMarkers,
    }

    const archive = new ZipArchive({ zlib: { level: 6 } })
    archive.on('warning', err => console.warn('[backup archive]', err))
    archive.on('error', err => archive.destroy(err))
    archive.append(JSON.stringify(backup, null, 2), { name: 'library-backup.json' })

    const archivedFiles = new Set<string>()
    for (const book of books) {
      const filename = safeFilename(book.filename)
      const lowerName = filename.toLowerCase()
      if (!lowerName.endsWith('.pdf') && !lowerName.endsWith('.epub')) continue
      const filePath = path.join(process.cwd(), 'public', 'uploads', filename)
      const archiveName = `uploads/${filename}`
      if (existsSync(filePath) && !archivedFiles.has(archiveName)) {
        archivedFiles.add(archiveName)
        archive.append(createReadStream(filePath), { name: archiveName })
      }
      const thumbnail = publicUploadPath(book.thumbnail)
      if (thumbnail && existsSync(thumbnail.filePath) && !archivedFiles.has(thumbnail.archiveName)) {
        archivedFiles.add(thumbnail.archiveName)
        archive.append(createReadStream(thumbnail.filePath), { name: thumbnail.archiveName })
      }
    }
    for (const annotation of annotations) {
      const oldBookId = Number(annotation.book_id)
      for (const assetPath of annotationPreviewPaths(annotation.content, user.id, oldBookId)) {
        const archiveName = `annotation-assets/${oldBookId}/${path.basename(assetPath)}`
        if (existsSync(assetPath) && !archivedFiles.has(archiveName)) {
          archivedFiles.add(archiveName)
          archive.append(createReadStream(assetPath), { name: archiveName })
        }
      }
    }
    for (const session of audioNoteSessions) {
      if (typeof session.file_path !== 'string') continue
      const filePath = audioNotePath(session.file_path)
      if (!filePath || !existsSync(filePath)) continue
      const relative = path.relative(path.join(process.cwd(), 'public', 'uploads'), filePath).replace(/\\/g, '/')
      if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) continue
      const archiveName = `uploads/${relative}`
      if (!archivedFiles.has(archiveName)) {
        archivedFiles.add(archiveName)
        archive.append(createReadStream(filePath), { name: archiveName })
      }
    }

    void archive.finalize()
    const stamp = new Date().toISOString().slice(0, 10)

    return new NextResponse(Readable.toWeb(archive) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="kisisel-kutuphane-backup-${stamp}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[backup GET]', err)
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 })
    }

    const entries = await parseBackupZip(Buffer.from(await file.arrayBuffer()))
    const manifestEntry = entries.find(entry => entry.name === 'library-backup.json')
    if (!manifestEntry) {
      return NextResponse.json({ error: 'library-backup.json missing' }, { status: 400 })
    }

    const backup = JSON.parse(manifestEntry.data.toString('utf8')) as BackupShape
    if (backup.version !== 1 && backup.version !== 2) {
      return NextResponse.json({ error: 'Unsupported backup version' }, { status: 400 })
    }
    if (!Array.isArray(backup.books) || !Array.isArray(backup.annotations) || !Array.isArray(backup.bookmarks)) {
      return NextResponse.json({ error: 'Backup manifest is invalid' }, { status: 400 })
    }
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await mkdir(uploadsDir, { recursive: true })

    const entryNames = new Set(entries.map(entry => entry.name))
    for (const item of backup.books) {
      const filename = safeFilename(item.filename)
      if (!filename || !/\.(pdf|epub)$/i.test(filename)) {
        return NextResponse.json({ error: 'Backup contains an invalid book filename' }, { status: 422 })
      }
      if (!entryNames.has(`uploads/${filename}`) && !existsSync(path.join(uploadsDir, filename))) {
        return NextResponse.json({ error: `Backup is missing book file: ${filename}` }, { status: 422 })
      }
    }

    for (const entry of entries) {
      if (!entry.name.startsWith('uploads/')) continue
      const relative = entry.name.replace(/^uploads\//, '').replace(/\\/g, '/')
      const parts = relative.split('/').map(safeFilename).filter(Boolean)
      if (!parts.length || parts.join('/') !== relative) continue
      const isBook = parts.length === 1 && (parts[0].toLowerCase().endsWith('.pdf') || parts[0].toLowerCase().endsWith('.epub'))
      const isThumbnail = parts.length === 2 && parts[0] === 'thumbnails' && /\.(png|jpe?g|webp|gif)$/i.test(parts[1])
      const isAudio = parts.length === 3 && parts[0] === 'audio-notes' && /^\d+$/.test(parts[1]) && /^\d+\.(webm|ogg|m4a|mp3|wav)$/i.test(parts[2])
      if (!isBook && !isThumbnail && !isAudio) continue
      const target = path.join(uploadsDir, ...parts)
      await mkdir(path.dirname(target), { recursive: true })
      if (!existsSync(target)) await writeFile(target, entry.data, { flag: 'wx' })
    }

    const restoredBookIdMap = new Map<number, number>()
    const audioSessionIdMap = new Map<number, number>()
    const importDb = db.transaction(() => {
      const insertBook = db.prepare(`
        INSERT INTO books (
          user_id, title, author, filename, filepath, last_page, total_pages, favorite,
          category, category_ids, tags, status, last_opened_at, created_at, total_reading_time, thumbnail,
          wrapped_fek, is_encrypted, encrypted_metadata, rating, description, isbn, language,
          edition_group_id, furthest_page, rtl, margin_crop, import_source, import_source_id
        )
        VALUES (
          @user_id, @title, @author, @filename, @filepath, @last_page, @total_pages, @favorite,
          @category, @category_ids, @tags, @status, @last_opened_at, @created_at, @total_reading_time, @thumbnail,
          @wrapped_fek, @is_encrypted, @encrypted_metadata, @rating, @description, @isbn, @language,
          @edition_group_id, @furthest_page, @rtl, @margin_crop, @import_source, @import_source_id
        )
      `)
      const updateBook = db.prepare(`
        UPDATE books
        SET title = @title, author = @author, filepath = @filepath, last_page = @last_page,
          total_pages = @total_pages, favorite = @favorite, category = @category, category_ids = @category_ids,
          tags = @tags, status = @status, last_opened_at = @last_opened_at,
          total_reading_time = @total_reading_time, thumbnail = @thumbnail,
          wrapped_fek = @wrapped_fek, is_encrypted = @is_encrypted, encrypted_metadata = @encrypted_metadata,
          rating = @rating, description = @description, isbn = @isbn, language = @language,
          edition_group_id = @edition_group_id, furthest_page = @furthest_page, rtl = @rtl,
          margin_crop = @margin_crop, import_source = @import_source, import_source_id = @import_source_id,
          text_extraction_version = 0, file_revision = NULL
        WHERE id = @id AND user_id = @user_id
      `)
      const insertAnnotation = db.prepare(`
        INSERT INTO annotations (user_id, book_id, type, content, page, is_encrypted, encrypted_data, style, drawing_data, color_meaning, created_at, updated_at)
        VALUES (@user_id, @book_id, @type, @content, @page, @is_encrypted, @encrypted_data, @style, @drawing_data, @color_meaning, @created_at, @updated_at)
      `)
      const insertBookmark = db.prepare(`
        INSERT INTO bookmarks (user_id, book_id, page, label, is_encrypted, encrypted_data, created_at, updated_at)
        VALUES (@user_id, @book_id, @page, @label, @is_encrypted, @encrypted_data, @created_at, @updated_at)
      `)
      const insertWord = db.prepare(`
        INSERT INTO word_library (
          user_id, word, definition, context, source_book_id, source_page,
          mastery, review_count, last_reviewed_at, created_at
          , is_encrypted, encrypted_data, updated_at
        )
        VALUES (
          @user_id, @word, @definition, @context, @source_book_id, @source_page,
          @mastery, @review_count, @last_reviewed_at, @created_at
          , @is_encrypted, @encrypted_data, @updated_at
        )
      `)
      const insertSession = db.prepare(`
        INSERT INTO reading_sessions (
          user_id, book_id, start_page, end_page, pages_read, duration_seconds, started_at, ended_at, is_encrypted, encrypted_data, updated_at
        )
        VALUES (
          @user_id, @book_id, @start_page, @end_page, @pages_read, @duration_seconds, @started_at, @ended_at, @is_encrypted, @encrypted_data, @updated_at
        )
      `)
      const checkAnnotation = db.prepare(`
        SELECT id FROM annotations
        WHERE user_id = @user_id AND book_id = @book_id AND type = @type AND content = @content AND page = @page
      `)
      const checkBookmark = db.prepare(`
        SELECT id FROM bookmarks
        WHERE user_id = @user_id AND book_id = @book_id AND page = @page AND label = @label
      `)
      const checkWord = db.prepare(`
        SELECT id FROM word_library
        WHERE user_id = @user_id AND word = @word
      `)
      const checkSession = db.prepare(`
        SELECT id FROM reading_sessions
        WHERE user_id = @user_id AND book_id = @book_id AND started_at = @started_at
      `)

      const findBookByFilename = db.prepare('SELECT id FROM books WHERE user_id = ? AND filename = ?')
      const bookIdMap = restoredBookIdMap
      const annotationCategoryMap = new Map<number, number>()
      const bookCategoryMap = new Map<number, number>()
      const annotationIdMap = new Map<number, number>()
      const notebookIdMap = new Map<number, number>()

      const restoreCategories = (
        table: 'annotation_categories' | 'book_categories',
        items: Record<string, unknown>[],
        idMap: Map<number, number>,
      ) => {
        const find = db.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND name = ? COLLATE NOCASE`)
        const insert = db.prepare(`INSERT INTO ${table} (user_id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        const update = db.prepare(`UPDATE ${table} SET color = ?, position = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        for (const item of items) {
          const name = cleanText(item.name || '').trim().slice(0, 60)
          if (!name) continue
          const color = typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#e50914'
          const position = Math.max(0, Number(item.position || 0))
          const existing = find.get(user.id, name) as { id: number } | undefined
          let id: number
          if (existing) {
            id = existing.id
            update.run(color, position, new Date().toISOString(), id, user.id)
          } else {
            id = Number(insert.run(user.id, name, color, position, item.created_at || new Date().toISOString(), item.updated_at || new Date().toISOString()).lastInsertRowid)
          }
          if (Number(item.id)) idMap.set(Number(item.id), id)
        }
      }

      restoreCategories('annotation_categories', backup.annotation_categories || [], annotationCategoryMap)
      restoreCategories('book_categories', backup.book_categories || [], bookCategoryMap)

      for (const item of backup.books || []) {
        const filename = safeFilename(item.filename)
        const oldId = Number(item.id)
        const existing = findBookByFilename.get(user.id, filename) as { id: number } | undefined
        const payload = {
          user_id: user.id,
          title: cleanText(item.title || 'Untitled'),
          author: cleanText(item.author || ''),
          filename,
          filepath: `/api/pdf/${filename}`,
          last_page: Number(item.last_page || 1),
          total_pages: Number(item.total_pages || 0),
          favorite: Number(item.favorite || 0),
          category: cleanText(item.category || ''),
          category_ids: '[]',
          tags: typeof item.tags === 'string' ? item.tags : JSON.stringify(item.tags || []),
          status: cleanText(item.status || 'reading'),
          last_opened_at: item.last_opened_at || null,
          created_at: item.created_at || new Date().toISOString(),
          total_reading_time: Number(item.total_reading_time || 0),
          thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : null,
          wrapped_fek: typeof item.wrapped_fek === 'string' ? item.wrapped_fek : null,
          is_encrypted: Number(item.is_encrypted || 0) ? 1 : 0,
          encrypted_metadata: typeof item.encrypted_metadata === 'string' ? item.encrypted_metadata : null,
          rating: Math.max(0, Math.min(5, Number(item.rating || 0))),
          description: cleanText(item.description || ''),
          isbn: cleanText(item.isbn || ''),
          language: cleanText(item.language || ''),
          edition_group_id: cleanText(item.edition_group_id || ''),
          furthest_page: Math.max(1, Number(item.furthest_page || item.last_page || 1)),
          rtl: Number(item.rtl || 0) ? 1 : 0,
          margin_crop: typeof item.margin_crop === 'string' ? item.margin_crop : JSON.stringify(item.margin_crop || {}),
          import_source: cleanText(item.import_source || ''),
          import_source_id: cleanText(item.import_source_id || ''),
        }

        if (existing) {
          updateBook.run({ ...payload, id: existing.id })
          if (oldId) bookIdMap.set(oldId, existing.id)
        } else {
          const result = insertBook.run(payload)
          if (oldId) bookIdMap.set(oldId, Number(result.lastInsertRowid))
        }
      }

      const assignmentsByBook = new Map<number, number[]>()
      for (const assignment of backup.book_category_assignments || []) {
        const bookId = bookIdMap.get(Number(assignment.book_id))
        const categoryId = bookCategoryMap.get(Number(assignment.category_id))
        if (!bookId || !categoryId) continue
        db.prepare('INSERT OR IGNORE INTO book_category_assignments (user_id, category_id, book_id) VALUES (?, ?, ?)')
          .run(user.id, categoryId, bookId)
        assignmentsByBook.set(bookId, [...(assignmentsByBook.get(bookId) || []), categoryId])
      }
      for (const [bookId, categoryIds] of assignmentsByBook) {
        const first = db.prepare('SELECT name FROM book_categories WHERE id = ? AND user_id = ?').get(categoryIds[0], user.id) as { name: string } | undefined
        db.prepare('UPDATE books SET category_ids = ?, category = ? WHERE id = ? AND user_id = ?')
          .run(JSON.stringify([...new Set(categoryIds)]), first?.name || '', bookId, user.id)
      }

      for (const item of backup.annotations || []) {
        const bookId = bookIdMap.get(Number(item.book_id))
        if (!bookId) continue
        const type = cleanText(item.type || 'note')
        const categorized = remapAnnotationCategory(item.content, annotationCategoryMap)
        const content = stringifyContent(remapAnnotationBookAssets(categorized, Number(item.book_id), bookId))
        const page = Number(item.page || 1)
        const payload = {
          user_id: user.id,
          book_id: bookId,
          type,
          content,
          page,
          created_at: item.created_at || new Date().toISOString(),
          updated_at: item.updated_at || item.created_at || new Date().toISOString(),
          is_encrypted: Number(item.is_encrypted || 0) ? 1 : 0,
          encrypted_data: typeof item.encrypted_data === 'string' ? item.encrypted_data : null,
          style: cleanText(item.style || 'highlight'),
          drawing_data: typeof item.drawing_data === 'string' ? item.drawing_data : '',
          color_meaning: cleanText(item.color_meaning || ''),
        }
        const existing = checkAnnotation.get(payload) as { id: number } | undefined
        const restoredId = existing ? existing.id : Number(insertAnnotation.run(payload).lastInsertRowid)
        if (Number(item.id)) annotationIdMap.set(Number(item.id), restoredId)
      }

      for (const item of backup.bookmarks || []) {
        const bookId = bookIdMap.get(Number(item.book_id))
        if (!bookId) continue
        const page = Number(item.page || 1)
        const label = cleanText(item.label || '')
        const payload = {
          user_id: user.id,
          book_id: bookId,
          page,
          label,
          created_at: item.created_at || new Date().toISOString(),
          updated_at: item.updated_at || item.created_at || new Date().toISOString(),
          is_encrypted: Number(item.is_encrypted || 0) ? 1 : 0,
          encrypted_data: typeof item.encrypted_data === 'string' ? item.encrypted_data : null,
        }
        if (!checkBookmark.get(payload)) {
          insertBookmark.run(payload)
        }
      }

      for (const item of backup.word_library || []) {
        const sourceBookId = item.source_book_id ? bookIdMap.get(Number(item.source_book_id)) || null : null
        const word = cleanText(item.word || '')
        const payload = {
          user_id: user.id,
          word,
          definition: cleanText(item.definition || ''),
          context: cleanText(item.context || ''),
          source_book_id: sourceBookId,
          source_page: sourceBookId && item.source_page ? Number(item.source_page) : null,
          mastery: Number(item.mastery || 0),
          review_count: Number(item.review_count || 0),
          last_reviewed_at: item.last_reviewed_at || null,
          created_at: item.created_at || new Date().toISOString(),
          updated_at: item.updated_at || item.created_at || new Date().toISOString(),
          is_encrypted: Number(item.is_encrypted || 0) ? 1 : 0,
          encrypted_data: typeof item.encrypted_data === 'string' ? item.encrypted_data : null,
        }
        const existingWord = checkWord.get({ user_id: user.id, word }) as { id: number } | undefined
        if (!existingWord) {
          insertWord.run(payload)
        } else {
          db.prepare(`
            UPDATE word_library
            SET definition = CASE WHEN definition = '' THEN @definition ELSE definition END,
                context = CASE WHEN context = '' THEN @context ELSE context END,
                mastery = MAX(mastery, @mastery),
                review_count = MAX(review_count, @review_count),
                is_encrypted = MAX(is_encrypted, @is_encrypted),
                encrypted_data = CASE WHEN encrypted_data IS NULL THEN @encrypted_data ELSE encrypted_data END,
                updated_at = @updated_at
            WHERE id = @id AND user_id = @user_id
          `).run({ ...payload, id: existingWord.id })
        }
      }

      for (const item of backup.reading_sessions || []) {
        const bookId = bookIdMap.get(Number(item.book_id))
        if (!bookId) continue
        const started_at = item.started_at || new Date().toISOString()
        const payload = {
          user_id: user.id,
          book_id: bookId,
          start_page: Number(item.start_page || 1),
          end_page: Number(item.end_page || 1),
          pages_read: Number(item.pages_read || 1),
          duration_seconds: Number(item.duration_seconds || 0),
          started_at,
          ended_at: item.ended_at || new Date().toISOString(),
          updated_at: item.updated_at || item.ended_at || new Date().toISOString(),
          is_encrypted: Number(item.is_encrypted || 0) ? 1 : 0,
          encrypted_data: typeof item.encrypted_data === 'string' ? item.encrypted_data : null,
        }
        if (!checkSession.get({ user_id: user.id, book_id: bookId, started_at })) {
          insertSession.run(payload)
        }
      }

      const findNotebook = db.prepare('SELECT id FROM research_notebooks WHERE user_id = ? AND title = ? COLLATE NOCASE')
      const insertNotebook = db.prepare('INSERT INTO research_notebooks (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      const updateNotebook = db.prepare('UPDATE research_notebooks SET updated_at = ? WHERE id = ? AND user_id = ?')
      for (const item of backup.research_notebooks || []) {
        const title = cleanText(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 160)
        if (!title) continue
        const existing = findNotebook.get(user.id, title) as { id: number } | undefined
        const restoredId = existing
          ? (updateNotebook.run(item.updated_at || new Date().toISOString(), existing.id, user.id), existing.id)
          : Number(insertNotebook.run(user.id, title, item.created_at || new Date().toISOString(), item.updated_at || new Date().toISOString()).lastInsertRowid)
        if (Number(item.id)) notebookIdMap.set(Number(item.id), restoredId)
      }
      const insertNotebookItem = db.prepare(`
        INSERT OR IGNORE INTO research_notebook_items (notebook_id, annotation_id, source_index, position, heading, commentary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of backup.research_notebook_items || []) {
        const notebookId = notebookIdMap.get(Number(item.notebook_id))
        if (!notebookId) continue
        const annotationId = annotationIdMap.get(Number(item.annotation_id)) || Number(item.annotation_id)
        if (!annotationId) continue
        insertNotebookItem.run(
          notebookId,
          annotationId,
          Math.max(0, Math.min(50, Number(item.source_index || 0))),
          Math.max(0, Number(item.position || 0)),
          cleanText(item.heading || '').slice(0, 240),
          cleanText(item.commentary || '').slice(0, 12_000),
          item.created_at || new Date().toISOString(),
          item.updated_at || new Date().toISOString(),
        )
      }

      const insertAudioSession = db.prepare(`
        INSERT INTO audio_note_sessions (user_id, book_id, title, duration_ms, file_path, mime_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of backup.audio_note_sessions || []) {
        const bookId = bookIdMap.get(Number(item.book_id))
        if (!bookId || Number(item.is_encrypted || 0)) continue
        const oldId = Number(item.id)
        if (!oldId) continue
        const result = insertAudioSession.run(
          user.id,
          bookId,
          cleanText(item.title || 'Sesli çalışma kaydı').slice(0, 120),
          Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(item.duration_ms || 0))),
          typeof item.file_path === 'string' && /^audio-notes\/\d+\/\d+\.(webm|ogg|m4a|mp3|wav)$/i.test(item.file_path) ? item.file_path : null,
          typeof item.mime_type === 'string' ? item.mime_type.slice(0, 80) : 'audio/webm',
          ['draft', 'recording', 'paused', 'completed', 'failed'].includes(String(item.status)) ? item.status : 'draft',
          item.created_at || new Date().toISOString(),
          item.updated_at || item.created_at || new Date().toISOString(),
        )
        audioSessionIdMap.set(oldId, Number(result.lastInsertRowid))
      }
      const insertAudioMarker = db.prepare(`
        INSERT INTO audio_note_markers (session_id, annotation_id, page, timestamp_ms, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const item of backup.audio_note_markers || []) {
        const sessionId = audioSessionIdMap.get(Number(item.session_id))
        if (!sessionId) continue
        const annotationId = item.annotation_id ? annotationIdMap.get(Number(item.annotation_id)) || null : null
        insertAudioMarker.run(
          sessionId,
          annotationId,
          Math.max(1, Math.min(100000, Number(item.page || 1))),
          Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(item.timestamp_ms || 0))),
          item.created_at || new Date().toISOString(),
        )
      }
    })

    importDb()
    for (const entry of entries) {
      const match = /^annotation-assets\/(\d+)\/([A-Za-z0-9.-]+)$/.exec(entry.name)
      if (!match || path.basename(match[2]) !== match[2]) continue
      const restoredBookId = restoredBookIdMap.get(Number(match[1]))
      if (!restoredBookId) continue
      const target = path.join(process.cwd(), 'data', 'annotation-assets', String(user.id), String(restoredBookId), match[2])
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, entry.data)
    }
    for (const entry of entries) {
      const match = /^uploads\/audio-notes\/\d+\/(\d+)\.(webm|ogg|m4a|mp3|wav)$/i.exec(entry.name)
      if (!match || path.basename(entry.name) !== match[0].split('/').at(-1)) continue
      const restoredSessionId = audioSessionIdMap.get(Number(match[1]))
      if (!restoredSessionId) continue
      const extension = match[2].toLowerCase()
      const target = path.join(process.cwd(), 'public', 'uploads', 'audio-notes', String(user.id), `${restoredSessionId}.${extension}`)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, entry.data)
      db.prepare('UPDATE audio_note_sessions SET file_path = ?, status = CASE WHEN status = \'draft\' THEN \'completed\' ELSE status END WHERE id = ? AND user_id = ?')
        .run(`audio-notes/${user.id}/${restoredSessionId}.${extension}`, restoredSessionId, user.id)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[backup POST]', err)
    return NextResponse.json({ error: 'Restore failed' }, { status: 500 })
  }
}
