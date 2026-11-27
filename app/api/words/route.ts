import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'
import { getCurrentUser, userOwnsBook } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse, getOwnedBookProtection } from '@/lib/encryptedBookPolicy'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const rows = db.prepare(
      `SELECT w.*, b.title as book_title
       FROM word_library w
       LEFT JOIN books b ON w.source_book_id = b.id AND b.user_id = w.user_id
       WHERE w.user_id = ? AND COALESCE(b.is_encrypted, 0) = 0
       ORDER BY w.created_at DESC`
    ).all(user.id)
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[words GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { word, definition, context, source_book_id, source_page } = await req.json()
    if (source_book_id && getOwnedBookProtection(user.id, source_book_id) === 'encrypted') {
      return encryptedBookLocalOnlyResponse()
    }
    const sourceBookId = source_book_id && userOwnsBook(user.id, source_book_id) ? source_book_id : null
    const result = db.prepare(
      'INSERT INTO word_library (user_id, word, definition, context, source_book_id, source_page) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.id, cleanText(word), cleanText(definition ?? ''), cleanText(context ?? ''), sourceBookId, sourceBookId ? source_page ?? null : null)
    const row = db.prepare(
      'SELECT w.*, b.title as book_title FROM word_library w LEFT JOIN books b ON w.source_book_id = b.id AND b.user_id = w.user_id WHERE w.id = ? AND w.user_id = ?'
    ).get(result.lastInsertRowid, user.id)
    return NextResponse.json(row)
  } catch (err) {
    console.error('[words POST]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { id, definition, word, context } = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const row = db.prepare(`
      SELECT w.id, COALESCE(b.is_encrypted, 0) AS book_is_encrypted
      FROM word_library w
      LEFT JOIN books b ON b.id = w.source_book_id AND b.user_id = w.user_id
      WHERE w.id = ? AND w.user_id = ?
    `).get(id, user.id) as { id: number; book_is_encrypted: number } | undefined
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (row.book_is_encrypted) return encryptedBookLocalOnlyResponse()

    const assignments: string[] = []
    const vals: unknown[] = []
    if (definition !== undefined) {
      assignments.push('definition = ?')
      vals.push(cleanText(definition))
    }
    if (word !== undefined) {
      assignments.push('word = ?')
      vals.push(cleanText(word))
    }
    if (context !== undefined) {
      assignments.push('context = ?')
      vals.push(cleanText(context))
    }
    if (assignments.length) {
      db.prepare(`UPDATE word_library SET ${assignments.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`).run(...vals, id, user.id)
    }

    const updated = db.prepare(
      'SELECT w.*, b.title as book_title FROM word_library w LEFT JOIN books b ON w.source_book_id = b.id AND b.user_id = w.user_id WHERE w.id = ? AND w.user_id = ?'
    ).get(id, user.id)
    return NextResponse.json(updated)
  } catch (err) {
    console.error('[words PATCH]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    // Support single id or comma-separated ids
    const idParam = req.nextUrl.searchParams.get('id')
    const idsParam = req.nextUrl.searchParams.get('ids')

    if (idsParam) {
      const ids = idsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
      if (ids.length === 0) return NextResponse.json({ error: 'No valid ids' }, { status: 400 })
      const placeholders = ids.map(() => '?').join(',')
      const existing = db.prepare(`SELECT id FROM word_library WHERE user_id = ? AND id IN (${placeholders})`).all(user.id, ...ids) as { id: number }[]
      db.prepare(`DELETE FROM word_library WHERE user_id = ? AND id IN (${placeholders})`).run(user.id, ...ids)
      const insertDelete = db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
      for (const row of existing) {
        insertDelete.run(user.id, 'word', row.id)
      }
      return NextResponse.json({ success: true, deleted: existing.length })
    }

    if (idParam) {
      const deleted = db.prepare('SELECT id FROM word_library WHERE id = ? AND user_id = ?').get(idParam, user.id)
      db.prepare('DELETE FROM word_library WHERE id = ? AND user_id = ?').run(idParam, user.id)
      if (deleted) {
        db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(user.id, 'word', idParam)
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'id or ids required' }, { status: 400 })
  } catch (err) {
    console.error('[words DELETE]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
