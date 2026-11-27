import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse } from '@/lib/encryptedBookPolicy'
import { normalizeAudioPage, normalizeAudioTimestamp } from '@/lib/audioNotes'

function parseSessionId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function ownedSession(userId: number, sessionId: number) {
  return db.prepare(`
    SELECT audio_note_sessions.id, audio_note_sessions.book_id, COALESCE(books.is_encrypted, 0) AS book_is_encrypted
    FROM audio_note_sessions
    JOIN books ON books.id = audio_note_sessions.book_id AND books.user_id = audio_note_sessions.user_id
    WHERE audio_note_sessions.id = ? AND audio_note_sessions.user_id = ?
  `).get(sessionId, userId) as { id: number; book_id: number; book_is_encrypted: number } | undefined
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const sessionId = parseSessionId((await params).sessionId)
  if (!sessionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = ownedSession(user.id, sessionId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.book_is_encrypted) return encryptedBookLocalOnlyResponse()
  return NextResponse.json(db.prepare(`
    SELECT id, session_id, annotation_id, page, timestamp_ms, created_at
    FROM audio_note_markers WHERE session_id = ? ORDER BY timestamp_ms, id
  `).all(sessionId))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const sessionId = parseSessionId((await params).sessionId)
  if (!sessionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = ownedSession(user.id, sessionId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.book_is_encrypted) return encryptedBookLocalOnlyResponse()

  try {
    const body = await req.json() as { annotation_id?: unknown; timestamp_ms?: unknown; page?: unknown }
    const annotationId = body.annotation_id === null || body.annotation_id === undefined ? null : Number(body.annotation_id)
    if (annotationId !== null && (!Number.isInteger(annotationId) || annotationId <= 0)) {
      return NextResponse.json({ error: 'Invalid annotation' }, { status: 400 })
    }
    if (annotationId !== null) {
      const annotation = db.prepare(`
        SELECT annotations.id
        FROM annotations
        JOIN books ON books.id = annotations.book_id AND books.user_id = annotations.user_id
        WHERE annotations.id = ? AND annotations.user_id = ? AND annotations.book_id = ? AND COALESCE(books.is_encrypted, 0) = 0
      `).get(annotationId, user.id, session.book_id)
      if (!annotation) return NextResponse.json({ error: 'Invalid annotation' }, { status: 400 })
    }
    const result = db.prepare(`
      INSERT INTO audio_note_markers (session_id, annotation_id, page, timestamp_ms)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, annotationId, normalizeAudioPage(body.page), normalizeAudioTimestamp(body.timestamp_ms))
    const marker = db.prepare('SELECT id, session_id, annotation_id, page, timestamp_ms, created_at FROM audio_note_markers WHERE id = ?').get(result.lastInsertRowid)
    return NextResponse.json(marker, { status: 201 })
  } catch (error) {
    console.error('[audio-notes/:id/markers POST]', error)
    return NextResponse.json({ error: 'Could not save audio marker' }, { status: 500 })
  }
}
