import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'node:fs/promises'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse } from '@/lib/encryptedBookPolicy'
import { normalizeAudioDuration, normalizeAudioStatus, normalizeAudioTitle } from '@/lib/audioNotes'
import { audioNotePath } from '@/lib/audioNoteStorage'

function parseSessionId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function ownedSession(userId: number, sessionId: number) {
  return db.prepare(`
    SELECT audio_note_sessions.*, COALESCE(books.is_encrypted, 0) AS book_is_encrypted
    FROM audio_note_sessions
    JOIN books ON books.id = audio_note_sessions.book_id AND books.user_id = audio_note_sessions.user_id
    WHERE audio_note_sessions.id = ? AND audio_note_sessions.user_id = ?
  `).get(sessionId, userId) as (Record<string, unknown> & { book_is_encrypted: number }) | undefined
}

function responseFor(row: Record<string, unknown>) {
  const markers = db.prepare(`
    SELECT id, session_id, annotation_id, page, timestamp_ms, created_at
    FROM audio_note_markers WHERE session_id = ? ORDER BY timestamp_ms, id
  `).all(Number(row.id))
  return { ...row, id: Number(row.id), duration_ms: Number(row.duration_ms) || 0, file_path: row.file_path || null, markers }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const sessionId = parseSessionId((await params).sessionId)
  if (!sessionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = ownedSession(user.id, sessionId)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.book_is_encrypted) return encryptedBookLocalOnlyResponse()
  return NextResponse.json(responseFor(row))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const sessionId = parseSessionId((await params).sessionId)
  if (!sessionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = ownedSession(user.id, sessionId)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.book_is_encrypted) return encryptedBookLocalOnlyResponse()

  try {
    const body = await req.json() as { title?: unknown; duration_ms?: unknown; status?: unknown }
    const updates: string[] = []
    const values: unknown[] = []
    if (body.title !== undefined) updates.push('title = ?'), values.push(normalizeAudioTitle(body.title) || String(row.title || 'Sesli çalışma kaydı'))
    if (body.duration_ms !== undefined) updates.push('duration_ms = ?'), values.push(normalizeAudioDuration(body.duration_ms))
    if (body.status !== undefined) {
      const status = normalizeAudioStatus(body.status)
      updates.push('status = ?')
      values.push(status)
    }
    if (updates.length) {
      db.prepare(`UPDATE audio_note_sessions SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(...values, sessionId, user.id)
    }
    const updated = ownedSession(user.id, sessionId)
    return NextResponse.json(responseFor(updated!))
  } catch (error) {
    console.error('[audio-notes/:id PATCH]', error)
    return NextResponse.json({ error: 'Could not update audio session' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const sessionId = parseSessionId((await params).sessionId)
  if (!sessionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = ownedSession(user.id, sessionId)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.book_is_encrypted) return encryptedBookLocalOnlyResponse()

  db.prepare('DELETE FROM audio_note_sessions WHERE id = ? AND user_id = ?').run(sessionId, user.id)
  const filePath = typeof row.file_path === 'string' ? audioNotePath(row.file_path) : null
  if (filePath) await unlink(filePath).catch(() => {})
  return NextResponse.json({ success: true })
}
