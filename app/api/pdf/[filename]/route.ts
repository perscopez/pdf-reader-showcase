import { NextRequest, NextResponse } from 'next/server'
import { stat } from 'fs/promises'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

function resolveUploadPath(filename: string) {
  const safeName = path.basename(filename)
  if (!safeName || safeName !== filename) return null
  return path.join(process.cwd(), 'public', 'uploads', safeName)
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
  if (filename.toLowerCase().endsWith('.epub')) return 'application/epub+zip'
  return 'application/pdf'
}

function headers(filename: string, size: number, start = 0, end = size - 1) {
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'")
  const encodedName = encodeURIComponent(filename)
  return {
    'Content-Type': contentType(filename),
    'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'private, no-store',
  }
}

export async function HEAD(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const user = getCurrentUser(_req)
  if (!user) return new NextResponse(null, { status: 401 })

  try {
    const { filename } = await params
    const filePath = resolveUploadPath(filename)
    if (!filePath) return new NextResponse(null, { status: 404 })
    const allowed = db.prepare(`
      SELECT b.id, b.is_encrypted,
        EXISTS (
          SELECT 1 FROM reading_group_books gb
          JOIN reading_group_members gm ON gm.group_id = gb.group_id
          WHERE gb.book_id = b.id AND gm.user_id = ?
        ) AS shared_access
      FROM books b
      WHERE b.filename = ? AND (b.user_id = ? OR EXISTS (
        SELECT 1 FROM reading_group_books gb
        JOIN reading_group_members gm ON gm.group_id = gb.group_id
        WHERE gb.book_id = b.id AND gm.user_id = ?
      ))
      LIMIT 1
    `).get(user.id, filename, user.id, user.id) as { id: number; is_encrypted: number; shared_access: number } | undefined
    if (!allowed) return new NextResponse(null, { status: 404 })
    if (allowed.shared_access && allowed.is_encrypted) return new NextResponse(null, { status: 409 })
    const info = await stat(filePath)
    return new NextResponse(null, { status: 200, headers: headers(filename, info.size) })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { filename } = await params
    const filePath = resolveUploadPath(filename)
    if (!filePath) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const allowed = db.prepare(`
      SELECT b.id, b.is_encrypted,
        EXISTS (
          SELECT 1 FROM reading_group_books gb
          JOIN reading_group_members gm ON gm.group_id = gb.group_id
          WHERE gb.book_id = b.id AND gm.user_id = ?
        ) AS shared_access
      FROM books b
      WHERE b.filename = ? AND (b.user_id = ? OR EXISTS (
        SELECT 1 FROM reading_group_books gb
        JOIN reading_group_members gm ON gm.group_id = gb.group_id
        WHERE gb.book_id = b.id AND gm.user_id = ?
      ))
      LIMIT 1
    `).get(user.id, filename, user.id, user.id) as { id: number; is_encrypted: number; shared_access: number } | undefined
    if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (allowed.shared_access && allowed.is_encrypted) return NextResponse.json({ error: 'Encrypted books cannot be shared' }, { status: 409 })

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
        headers: headers(filename, info.size),
      })
    }

    const stream = createReadStream(filePath, { start: range.start, end: range.end })
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...headers(filename, info.size, range.start, range.end),
        'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
