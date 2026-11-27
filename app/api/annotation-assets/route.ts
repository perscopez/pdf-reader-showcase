import { NextRequest, NextResponse } from 'next/server'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { getCurrentUser } from '@/lib/auth'
import { annotationAssetDirectory } from '@/lib/annotationAssets'
import { encryptedBookLocalOnlyResponse, getOwnedBookProtection } from '@/lib/encryptedBookPolicy'

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

function validBookId(value: string | null) {
  return value && /^\d+$/.test(value) ? value : null
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const body = await req.json() as { book_id?: unknown; data_url?: unknown }
    const bookId = validBookId(String(body.book_id ?? ''))
    if (!bookId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const protection = getOwnedBookProtection(user.id, bookId)
    if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()
    if (typeof body.data_url !== 'string') return NextResponse.json({ error: 'Invalid preview' }, { status: 400 })

    const match = body.data_url.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return NextResponse.json({ error: 'Unsupported preview format' }, { status: 400 })
    const bytes = Buffer.from(match[2], 'base64')
    if (!bytes.length || bytes.length > MAX_PREVIEW_BYTES) return NextResponse.json({ error: 'Preview too large' }, { status: 413 })
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
    if (!isPng && !isJpeg) return NextResponse.json({ error: 'Invalid preview image' }, { status: 400 })

    const extension = isPng ? 'png' : 'jpg'
    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extension}`
    const directory = annotationAssetDirectory(user.id, bookId)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, filename), bytes, { flag: 'wx', mode: 0o600 })

    return NextResponse.json({
      previewUrl: `/api/annotation-assets?book_id=${bookId}&file=${encodeURIComponent(filename)}`,
    })
  } catch (error) {
    console.error('[annotation-assets POST]', error)
    return NextResponse.json({ error: 'Could not save preview' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const bookId = validBookId(req.nextUrl.searchParams.get('book_id'))
  const filename = req.nextUrl.searchParams.get('file')
  if (!bookId || !filename || path.basename(filename) !== filename || !/^[A-Za-z0-9.-]+$/.test(filename)) {
    return NextResponse.json({ error: 'Invalid asset' }, { status: 400 })
  }
  const protection = getOwnedBookProtection(user.id, bookId)
  if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

  try {
    const bytes = await readFile(path.join(annotationAssetDirectory(user.id, bookId), filename))
    const contentType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg'
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
