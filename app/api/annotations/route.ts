import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'node:fs/promises'
import db from '@/lib/db'
import { cleanTextDeep } from '@/lib/text'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse, getOwnedBookProtection } from '@/lib/encryptedBookPolicy'
import { validateAnnotationPatchInput } from '@/lib/annotations'
import { annotationPreviewPaths } from '@/lib/annotationAssets'

function parse(row: Record<string, unknown>) {
  return { ...row, content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content }
}

function ownsAnnotationCategory(userId: number, categoryId: unknown) {
  if (categoryId === null || categoryId === undefined) return true
  const id = Number(categoryId)
  return Number.isInteger(id) && id > 0 && Boolean(
    db.prepare('SELECT id FROM annotation_categories WHERE id = ? AND user_id = ?').get(id, userId)
  )
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const bookId = req.nextUrl.searchParams.get('book_id')
  const all = req.nextUrl.searchParams.get('all') === '1'
  if (!bookId && !all) return NextResponse.json({ error: 'book_id required' }, { status: 400 })
  if (bookId) {
    const protection = getOwnedBookProtection(user.id, bookId)
    if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()
  }

  try {
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 500)
    const limit = Number.isInteger(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 500
    const rows = bookId
      ? db.prepare('SELECT * FROM annotations WHERE book_id = ? AND user_id = ? ORDER BY page, id LIMIT ?').all(bookId, user.id, limit) as Record<string, unknown>[]
      : db.prepare(`
          SELECT annotations.*, books.title AS book_title, books.author AS book_author
          FROM annotations
          JOIN books ON books.id = annotations.book_id AND books.user_id = annotations.user_id
          WHERE annotations.user_id = ? AND COALESCE(books.is_encrypted, 0) = 0
          ORDER BY annotations.updated_at DESC, annotations.created_at DESC, annotations.id DESC
          LIMIT ?
        `).all(user.id, limit) as Record<string, unknown>[]
    return NextResponse.json(rows.map(parse))
  } catch (err) {
    console.error('[annotations GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { book_id, type, content, page } = await req.json()
    const protection = getOwnedBookProtection(user.id, book_id)
    if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

    const cleanContent = cleanTextDeep(content)
    if (!ownsAnnotationCategory(user.id, cleanContent?.categoryId)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }
    let lastInsertId: number | bigint

    if (type === 'drawing') {
      db.transaction(() => {
        const replaced = db.prepare(
          'SELECT id FROM annotations WHERE user_id = ? AND book_id = ? AND type = \'drawing\' AND page = ?'
        ).all(user.id, book_id, page) as { id: number }[]
        db.prepare(
          'DELETE FROM annotations WHERE user_id = ? AND book_id = ? AND type = \'drawing\' AND page = ?'
        ).run(user.id, book_id, page)
        const result = db.prepare(
          'INSERT INTO annotations (user_id, book_id, type, content, page) VALUES (?, ?, ?, ?, ?)'
        ).run(user.id, book_id, type, JSON.stringify(cleanContent), page)
        const tombstone = db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
        for (const row of replaced) tombstone.run(user.id, 'annotation', row.id)
        lastInsertId = result.lastInsertRowid
      })()
    } else {
      const result = db.prepare(
        'INSERT INTO annotations (user_id, book_id, type, content, page) VALUES (?, ?, ?, ?, ?)'
      ).run(user.id, book_id, type, JSON.stringify(cleanContent), page)
      lastInsertId = result.lastInsertRowid
    }

    const row = db.prepare('SELECT * FROM annotations WHERE id = ? AND user_id = ?').get(lastInsertId!, user.id) as Record<string, unknown>
    return NextResponse.json(parse(row))
  } catch (err) {
    console.error('[annotations POST]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const patch = validateAnnotationPatchInput(await req.json())
    if (!patch) return NextResponse.json({ error: 'Invalid annotation update' }, { status: 400 })

    const current = db.prepare(
      `SELECT annotations.*, COALESCE(books.is_encrypted, 0) AS book_is_encrypted
       FROM annotations
       JOIN books ON books.id = annotations.book_id AND books.user_id = annotations.user_id
       WHERE annotations.id = ? AND annotations.user_id = ?`
    ).get(patch.id, user.id) as (Record<string, unknown> & { book_is_encrypted: number }) | undefined
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (current.book_is_encrypted) return encryptedBookLocalOnlyResponse()
    if (current.type === 'drawing') return NextResponse.json({ error: 'Drawing updates use the drawing save flow' }, { status: 400 })

    const currentContent = typeof current.content === 'string'
      ? JSON.parse(current.content) as Record<string, unknown>
      : current.content as Record<string, unknown>
    const cleanContent = cleanTextDeep({ ...currentContent, ...patch.content })
    if (!ownsAnnotationCategory(user.id, cleanContent.categoryId)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }
    db.prepare(
      `UPDATE annotations
       SET content = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`
    ).run(JSON.stringify(cleanContent), patch.id, user.id)

    const updated = db.prepare(
      'SELECT * FROM annotations WHERE id = ? AND user_id = ?'
    ).get(patch.id, user.id) as Record<string, unknown>
    return NextResponse.json(parse(updated))
  } catch (err) {
    console.error('[annotations PATCH]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  try {
    const deleted = db.transaction(() => {
      const row = db.prepare(
        'SELECT id, book_id, content FROM annotations WHERE id = ? AND user_id = ?'
      ).get(id, user.id) as { id: number; book_id: number; content: string } | undefined
      if (!row) return undefined
      db.prepare('DELETE FROM annotations WHERE id = ? AND user_id = ?').run(id, user.id)
      db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(user.id, 'annotation', id)
      return row
    })()

    if (deleted) {
      let content: unknown
      try {
        content = JSON.parse(deleted.content)
      } catch {
        content = null
      }
      await Promise.all(annotationPreviewPaths(content, user.id, deleted.book_id).map(assetPath =>
        unlink(assetPath).catch(() => {})
      ))
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[annotations DELETE]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
