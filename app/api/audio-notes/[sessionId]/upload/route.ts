import { NextRequest, NextResponse } from 'next/server'
import { rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse } from '@/lib/encryptedBookPolicy'
import { AUDIO_NOTE_MAX_BYTES, isAllowedAudioMime, normalizeAudioDuration, normalizeAudioMime } from '@/lib/audioNotes'
import { audioNotePath, audioNoteRelativePath, ensureAudioNoteDirectory } from '@/lib/audioNoteStorage'

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const sessionId = parseSessionId((await params).sessionId)
  if (!sessionId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = ownedSession(user.id, sessionId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.book_is_encrypted) return encryptedBookLocalOnlyResponse()

  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Audio file required' }, { status: 400 })
    if (file.size > AUDIO_NOTE_MAX_BYTES) return NextResponse.json({ error: 'Audio file is too large' }, { status: 413 })
    if (!isAllowedAudioMime(file.type)) return NextResponse.json({ error: 'Unsupported audio format' }, { status: 415 })

    const mimeType = normalizeAudioMime(file.type)
    const relativePath = audioNoteRelativePath(user.id, sessionId, mimeType)
    const destination = audioNotePath(relativePath)
    if (!destination) return NextResponse.json({ error: 'Invalid audio path' }, { status: 400 })
    await ensureAudioNoteDirectory(user.id)
    const temporary = path.join(path.dirname(destination), `.${sessionId}-${Date.now()}.upload`)
    await writeFile(temporary, Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 })
    await rename(temporary, destination)

    const durationMs = normalizeAudioDuration(formData.get('duration_ms'))
    if (typeof session.file_path === 'string') {
      const previous = audioNotePath(session.file_path)
      if (previous && previous !== destination) await unlink(previous).catch(() => {})
    }
    db.prepare(`
      UPDATE audio_note_sessions
      SET file_path = ?, mime_type = ?, duration_ms = ?, status = 'completed', updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(relativePath, mimeType, durationMs, sessionId, user.id)
    const updated = db.prepare('SELECT * FROM audio_note_sessions WHERE id = ? AND user_id = ?').get(sessionId, user.id)
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[audio-notes/:id/upload POST]', error)
    return NextResponse.json({ error: 'Could not save audio file' }, { status: 500 })
  }
}
