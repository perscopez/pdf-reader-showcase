import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse, getOwnedBookProtection } from '@/lib/encryptedBookPolicy'
import { normalizeAudioTitle } from '@/lib/audioNotes'

function parseBookId(value: string | null | undefined) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function parseSession(row: Record<string, unknown>) {
  return {
    ...row,
    id: Number(row.id),
    book_id: Number(row.book_id),
    duration_ms: Number(row.duration_ms) || 0,
    file_path: typeof row.file_path === 'string' ? row.file_path : null,
    markers: [],
  }
}

function markersForSession(sessionId: number) {
  return db.prepare(`
    SELECT id, session_id, annotation_id, page, timestamp_ms, created_at
    FROM audio_note_markers
    WHERE session_id = ?
    ORDER BY timestamp_ms, id
  `).all(sessionId)
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const requestedBookId = req.nextUrl.searchParams.get('book_id')
  if (requestedBookId) {
    const bookId = parseBookId(requestedBookId)
    if (!bookId) return NextResponse.json({ error: 'Invalid book' }, { status: 400 })
    const protection = getOwnedBookProtection(user.id, bookId)
    if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()
  }

  try {
    const rows = requestedBookId
      ? db.prepare(`
          SELECT * FROM audio_note_sessions
          WHERE user_id = ? AND book_id = ?
          ORDER BY updated_at DESC, id DESC
        `).all(user.id, Number(requestedBookId)) as Record<string, unknown>[]
      : db.prepare(`
          SELECT audio_note_sessions.*
          FROM audio_note_sessions
          JOIN books ON books.id = audio_note_sessions.book_id AND books.user_id = audio_note_sessions.user_id
          WHERE audio_note_sessions.user_id = ? AND COALESCE(books.is_encrypted, 0) = 0
          ORDER BY audio_note_sessions.updated_at DESC, audio_note_sessions.id DESC
        `).all(user.id) as Record<string, unknown>[]
    return NextResponse.json(rows.map(row => ({ ...parseSession(row), markers: markersForSession(Number(row.id)) })))
  } catch (error) {
    console.error('[audio-notes GET]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const body = await req.json() as { book_id?: unknown; title?: unknown }
    const bookId = parseBookId(String(body.book_id ?? ''))
    if (!bookId) return NextResponse.json({ error: 'Invalid book' }, { status: 400 })
    const protection = getOwnedBookProtection(user.id, bookId)
    if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

    const title = normalizeAudioTitle(body.title) || 'Sesli çalışma kaydı'
    const result = db.prepare(`
      INSERT INTO audio_note_sessions (user_id, book_id, title, status)
      VALUES (?, ?, ?, 'draft')
    `).run(user.id, bookId, title)
    const row = db.prepare('SELECT * FROM audio_note_sessions WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, user.id) as Record<string, unknown>
    return NextResponse.json({ ...parseSession(row), markers: [] }, { status: 201 })
  } catch (error) {
    console.error('[audio-notes POST]', error)
    return NextResponse.json({ error: 'Could not create audio session' }, { status: 500 })
  }
}
