import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse } from '@/lib/encryptedBookPolicy'
import { audioNotePath } from '@/lib/audioNoteStorage'

function parseSessionId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function parseRange(range: string | null, size: number) {
  if (!range) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) return 'invalid' as const
  let start = match[1] ? Number(match[1]) : NaN
  let end = match[2] ? Number(match[2]) : NaN
  if (!match[1] && match[2]) {
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid' as const
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    if (!Number.isFinite(start)) return 'invalid' as const
    if (!Number.isFinite(end)) end = size - 1
  }
  if (start < 0 || end >= size || start > end) return 'invalid' as const
  return { start, end }
}

async function getAudioFile(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  const sessionId = parseSessionId(req.nextUrl.pathname.split('/').at(-2) || '')
  if (!sessionId) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const row = db.prepare(`
    SELECT audio_note_sessions.file_path, audio_note_sessions.mime_type, COALESCE(books.is_encrypted, 0) AS book_is_encrypted
    FROM audio_note_sessions
    JOIN books ON books.id = audio_note_sessions.book_id AND books.user_id = audio_note_sessions.user_id
    WHERE audio_note_sessions.id = ? AND audio_note_sessions.user_id = ?
  `).get(sessionId, user.id) as { file_path: string | null; mime_type: string; book_is_encrypted: number } | undefined
  if (!row) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (row.book_is_encrypted) return { response: encryptedBookLocalOnlyResponse() }
  if (!row.file_path) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const filePath = audioNotePath(row.file_path)
  if (!filePath) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { filePath, mimeType: row.mime_type || 'audio/webm' }
}

async function stream(req: NextRequest) {
  const result = await getAudioFile(req)
  if ('response' in result) return result.response
  try {
    const info = await stat(result.filePath)
    const range = parseRange(req.headers.get('range'), info.size)
    const baseHeaders = {
      'Content-Type': result.mimeType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    if (range === 'invalid') return new NextResponse(null, { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${info.size}` } })
    if (!range) {
      return new NextResponse(Readable.toWeb(createReadStream(result.filePath)) as ReadableStream, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(info.size) },
      })
    }
    return new NextResponse(Readable.toWeb(createReadStream(result.filePath, { start: range.start, end: range.end })) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function GET(req: NextRequest) {
  return stream(req)
}

export async function HEAD(req: NextRequest) {
  const result = await getAudioFile(req)
  if ('response' in result && result.response) return new NextResponse(null, { status: result.response.status })
  try {
    const info = await stat(result.filePath)
    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(info.size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
