import { NextRequest, NextResponse } from 'next/server'
import { stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

const PUBLIC_IMAGE_FOLDERS = new Set(['avatars', 'thumbnails'])
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i

// Only two shapes are served here:
//   /uploads/<book file>                    -> owner-checked book file
//   /uploads/(avatars|thumbnails)/<image>   -> managed image
// Everything else (audio notes, text sidecars, nested paths) is rejected; audio notes
// are streamed through the owner-checked /api/audio-notes/[sessionId]/stream route.
function resolveUploadPath(segments: string[]) {
  if (!segments.length || segments.length > 2) return null
  if (segments.some(seg => !seg || seg === '.' || seg === '..' || seg !== path.basename(seg) || seg.includes('\0'))) return null
  if (segments.length === 2 && (!PUBLIC_IMAGE_FOLDERS.has(segments[0]) || !IMAGE_FILE.test(segments[1]))) return null
  const root = path.resolve(process.cwd(), 'public', 'uploads')
  const resolved = path.resolve(root, ...segments)
  if (!resolved.startsWith(`${root}${path.sep}`)) return null
  return resolved
}

function parseRange(range: string | null, size: number) {
  if (!range) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) return 'invalid' as const

  let start = match[1] ? Number(match[1]) : NaN
  let end = match[2] ? Number(match[2]) : NaN

  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2])
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid' as const
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    if (!Number.isFinite(start)) return 'invalid' as const
    if (!Number.isFinite(end)) end = size - 1
  }

  if (start < 0 || end >= size || start > end) return 'invalid' as const
  return { start, end }
}

function contentType(filename: string) {
  const ext = filename.toLowerCase()
  if (ext.endsWith('.epub')) return 'application/epub+zip'
  if (ext.endsWith('.png')) return 'image/png'
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg'
  if (ext.endsWith('.webp')) return 'image/webp'
  if (ext.endsWith('.gif')) return 'image/gif'
  return 'application/pdf'
}

function buildHeaders(segments: string[], size: number, start = 0, end = size - 1) {
  const filename = segments[segments.length - 1]
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'")
  const encodedName = encodeURIComponent(filename)
  const isImage = segments.length > 1 && (segments[0] === 'avatars' || segments[0] === 'thumbnails')
  return {
    'Content-Type': contentType(filename),
    'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': isImage ? 'public, max-age=31536000, immutable' : 'private, no-store',
  }
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const user = getCurrentUser(req)
  if (!user) return new NextResponse(null, { status: 401 })

  try {
    const { path: segments } = await params
    const filePath = resolveUploadPath(segments)
    if (!filePath) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // For book files directly in /uploads/, check authorization
    if (segments.length === 1) {
      const filename = segments[0]
      const allowed = db.prepare('SELECT id FROM books WHERE filename = ? AND user_id = ?').get(filename, user.id)
      if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const info = await stat(filePath)
    return new NextResponse(null, { status: 200, headers: buildHeaders(segments, info.size) })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { path: segments } = await params
    const filePath = resolveUploadPath(segments)
    if (!filePath) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // For book files directly in /uploads/, check authorization
    if (segments.length === 1) {
      const filename = segments[0]
      const allowed = db.prepare('SELECT id FROM books WHERE filename = ? AND user_id = ?').get(filename, user.id)
      if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const info = await stat(filePath)
    const range = parseRange(req.headers.get('range'), info.size)

    if (range === 'invalid') {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}` },
      })
    }

    if (!range) {
      const stream = createReadStream(filePath)
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: buildHeaders(segments, info.size),
      })
    }

    const stream = createReadStream(filePath, { start: range.start, end: range.end })
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...buildHeaders(segments, info.size, range.start, range.end),
        'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
