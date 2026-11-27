import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, unlink, copyFile, chmod, stat } from 'fs/promises'
import path from 'path'
import JSZip from 'jszip'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getCurrentUser } from '@/lib/auth'
import { getUserStorageUsage } from '@/lib/quotas'
import { checkRateLimit } from '@/lib/rateLimit'

import { indexBookPages } from '@/lib/indexer'

const execFilePromise = promisify(execFile)
const CONVERT_TIMEOUT_MS = 5 * 60 * 1000

const SUPPORTED_EXTENSIONS = ['.pdf', '.epub']
const MAX_SIZE = 100 * 1024 * 1024 // 100 MB per file
const MAX_BOOKS_PER_USER = 500
// 500 MB uncompressed ceiling for EPUB content
const MAX_EPUB_UNCOMPRESSED = 500 * 1024 * 1024
// Reject EPUBs where uncompressed/compressed ratio exceeds this
const MAX_EPUB_COMPRESSION_RATIO = 50

/**
 * Parse the ZIP Central Directory (at end of buffer) to sum uncompressed sizes
 * without decompressing any file data. Returns -1 if the ZIP structure is unreadable.
 * Used for ZIP-bomb detection on EPUB uploads.
 */
function getEpubTotalUncompressedSize(buffer: Buffer): number {
  // End of Central Directory record signature: 0x06054b50 (little-endian)
  const EOCD_SIG = 0x06054b50
  // Central Directory File Header signature: 0x02014b50
  const CDFH_SIG = 0x02014b50

  // Scan backwards for EOCD (comment field may push it away from the very end)
  let eocdOffset = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) return -1

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)
  const cdSize   = buffer.readUInt32LE(eocdOffset + 12)
  if (cdOffset + cdSize > buffer.length) return -1

  let total = 0
  let pos = cdOffset
  while (pos + 46 <= cdOffset + cdSize && pos + 46 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== CDFH_SIG) break
    total += buffer.readUInt32LE(pos + 24) // uncompressed size field
    const fnLen      = buffer.readUInt16LE(pos + 28)
    const extraLen   = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    pos += 46 + fnLen + extraLen + commentLen
  }
  return total
}

/**
 * Per-user upload lock. Prevents a single user from racing two concurrent
 * uploads to bypass the storage-quota check (read-then-write race).
 */
const uploadingUsers = new Set<number>()

type UploadFailure = { error: string; status: number }

function getExtension(filename: string) {
  return path.extname(filename).toLowerCase()
}

function hasExpectedSignature(buffer: Buffer, extension: string) {
  if (extension === '.pdf') {
    // PDF spec allows the header anywhere in the first 1024 bytes.
    return buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))
  }
  if (extension === '.epub') {
    // EPUB is a ZIP container: local file header "PK\x03\x04".
    return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50
  }
  return false
}

function titleFromFilename(filename: string) {
  return cleanText(filename.replace(/\.(pdf|epub)$/i, '').replace(/_/g, ' ')).trim()
}

async function sanitizeEpubBuffer(buffer: Buffer<ArrayBufferLike>): Promise<Buffer<ArrayBufferLike>> {
  // ── ZIP-bomb guard (reads ZIP headers only — no decompression) ────────────
  const totalUncompressed = getEpubTotalUncompressedSize(buffer as Buffer)
  if (totalUncompressed > MAX_EPUB_UNCOMPRESSED) {
    throw new Error(
      `EPUB rejected: uncompressed content (${(totalUncompressed / 1024 / 1024).toFixed(0)} MB) ` +
      `exceeds the ${MAX_EPUB_UNCOMPRESSED / 1024 / 1024} MB limit.`
    )
  }
  if (buffer.length > 0 && totalUncompressed > 0 && totalUncompressed > buffer.length * MAX_EPUB_COMPRESSION_RATIO) {
    throw new Error(
      `EPUB rejected: compression ratio ${(totalUncompressed / buffer.length).toFixed(1)}× ` +
      `exceeds the ${MAX_EPUB_COMPRESSION_RATIO}× limit (possible ZIP bomb).`
    )
  }
  // ─────────────────────────────────────────────────────────────────────────

  const zip = await JSZip.loadAsync(buffer)
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = /full-path=["']([^"']+)["']/.exec(container || '')?.[1]
  if (!opfPath) return buffer

  const opfFile = zip.file(opfPath)
  const opf = await opfFile?.async('string')
  if (!opf) return buffer

  const manifestIds = new Set(
    [...opf.matchAll(/<item\b[^>]*\sid=["']([^"']+)["'][^>]*>/g)].map(match => match[1])
  )
  let changed = false
  const sanitized = opf.replace(/<itemref\b[^>]*\sidref=["']([^"']+)["'][^>]*\/?>/g, (tag, idref) => {
    if (manifestIds.has(idref)) return tag
    changed = true
    return ''
  })

  if (!changed) return buffer
  zip.file(opfPath, sanitized)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function saveBookFile(file: File, formData: FormData, batch: boolean, userId: number) {
  // E2EE encrypted upload metadata — check before extension validation
  const isEncrypted = formData.get('isEncrypted') === '1' || formData.get('isEncrypted') === 'true'
  const wrappedFek = typeof formData.get('wrappedFek') === 'string' ? (formData.get('wrappedFek') as string) : null
  const encryptedMetadata = typeof formData.get('encryptedMetadata') === 'string' ? (formData.get('encryptedMetadata') as string) : null

  // Encrypted files arrive as "filename.pdf.enc" — strip the .enc for extension check
  const effectiveName = isEncrypted && file.name.endsWith('.enc') ? file.name.slice(0, -4) : file.name
  const extension = getExtension(effectiveName)
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return { error: `${file.name}: Only PDF and EPUB files are supported`, status: 400 }
  }

  if (file.size > MAX_SIZE) {
    return { error: `${file.name}: File too large. Maximum size is 100 MB.`, status: 413 }
  }

  const title = batch
    ? titleFromFilename(effectiveName)
    : cleanText(formData.get('title')).trim() || titleFromFilename(effectiveName)
  const author = cleanText(formData.get('author')).trim()

  const bytes = await file.arrayBuffer()
  let buffer: Buffer<ArrayBufferLike> = Buffer.from(bytes)

  // Content sniffing: the extension alone is not trusted. Encrypted uploads are opaque ciphertext.
  if (!isEncrypted && !hasExpectedSignature(buffer, extension)) {
    return { error: `${file.name}: File content does not match a ${extension.slice(1).toUpperCase()} document`, status: 400 }
  }

  const safeName = effectiveName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const uploadDir = path.join(process.cwd(), 'public', 'uploads')
  await mkdir(uploadDir, { recursive: true })

  let finalFilename = ''

  if (extension === '.epub') {
    // Sanitize EPUB buffer first
    buffer = await sanitizeEpubBuffer(buffer)
    
    // Save temporary EPUB file
    const tempEpubFilename = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
    const tempEpubPath = path.join(uploadDir, tempEpubFilename)
    await writeFile(tempEpubPath, buffer)

    // Setup output PDF filename
    const pdfFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName.replace(/\.epub$/i, '.pdf')}`
    const finalPdfPath = path.join(uploadDir, pdfFilename)

    console.log(`[Upload] Converting EPUB to PDF: ${tempEpubFilename} -> ${pdfFilename}`)

    try {
      const isLinux = process.platform === 'linux'
      const isRoot = isLinux && process.getuid && process.getuid() === 0

      if (isRoot) {
        // Isolate conversion to /tmp/ to run as unprivileged 'nobody' user
        const tempInName = `calibre-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.epub`
        const tempOutName = `calibre-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
        const tmpInPath = path.join('/tmp', tempInName)
        const tmpOutPath = path.join('/tmp', tempOutName)

        try {
          await copyFile(tempEpubPath, tmpInPath)
          await chmod(tmpInPath, 0o644)
          console.log(`[Upload] Running isolated calibre conversion as 'nobody': ${tmpInPath} -> ${tmpOutPath}`)
          await execFilePromise('runuser', ['-u', 'nobody', '--', 'ebook-convert', tmpInPath, tmpOutPath], { timeout: CONVERT_TIMEOUT_MS })
          await copyFile(tmpOutPath, finalPdfPath)
        } finally {
          try { await unlink(tmpInPath) } catch {}
          try { await unlink(tmpOutPath) } catch {}
        }
      } else {
        // Run normally on Windows / non-root Linux
        console.log(`[Upload] Running calibre conversion: ${tempEpubPath} -> ${finalPdfPath}`)
        await execFilePromise('ebook-convert', [tempEpubPath, finalPdfPath], {
          env: { ...process.env },
          timeout: CONVERT_TIMEOUT_MS,
        })
      }
      
      finalFilename = pdfFilename
    } catch (err) {
      console.error('[Upload] Calibre conversion failed:', err)
      // Cleanup temp file
      try { await unlink(tempEpubPath) } catch {}
      return { error: `${file.name}: EPUB to PDF conversion failed.`, status: 500 }
    }

    // Cleanup temp EPUB file
    try { await unlink(tempEpubPath) } catch {}
  } else {
    // PDF file - save directly
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
    await writeFile(path.join(uploadDir, filename), buffer)
    finalFilename = filename
  }

  const result = db.prepare(
    'INSERT INTO books (user_id, title, author, filename, filepath, is_encrypted, wrapped_fek, encrypted_metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, title, author, finalFilename, `/api/pdf/${finalFilename}`, isEncrypted ? 1 : 0, wrappedFek, encryptedMetadata)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, userId) as any
  // Skip server-side indexing for encrypted books — server cannot read the ciphertext
  if (book && !isEncrypted && finalFilename.toLowerCase().endsWith('.pdf')) {
    indexBookPages(book.id, finalFilename).catch(err => {
      console.error(`[Upload] Async indexing failed for book ${book.id}:`, err)
    })
  }
  return book
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = checkRateLimit(req, 'upload-books', 30, 60 * 60 * 1000)
  if (limited) return limited

  // ── Per-user concurrent upload lock ───────────────────────────────────────
  // Prevents a read-then-write race where two simultaneous uploads both see
  // the same quota usage and both proceed past the storage-limit check.
  if (uploadingUsers.has(user.id)) {
    return NextResponse.json(
      { error: 'Another upload is already in progress. Please wait for it to finish.' },
      { status: 429 }
    )
  }
  uploadingUsers.add(user.id)

  try {
    const formData = await req.formData()
    const files = [
      ...formData.getAll('files'),
      ...formData.getAll('file'),
    ].filter((item): item is File => item instanceof File && Boolean(item.name))

    if (files.length === 0) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const isAdmin = user.role === 'admin'

    // ── Book-count limit ──────────────────────────────────────────────────────
    if (!isAdmin) {
      const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM books WHERE user_id = ?').get(user.id) as { cnt: number }
      if (cnt >= MAX_BOOKS_PER_USER) {
        return NextResponse.json(
          { error: `Book limit (${MAX_BOOKS_PER_USER}) reached. Delete some books before uploading more.` },
          { status: 429 }
        )
      }
    }

    const storageLimit = 2 * 1024 * 1024 * 1024 // 2 GB
    let currentUsage = await getUserStorageUsage(user.id)

    const books = []
    for (const file of files) {
      if (!isAdmin && currentUsage + file.size > storageLimit) {
        return NextResponse.json({ error: 'Storage quota (2 GB) exceeded.' }, { status: 413 })
      }

      const saved = await saveBookFile(file, formData, files.length > 1, user.id)
      if (saved && typeof saved === 'object' && 'error' in saved) {
        const failure = saved as UploadFailure
        return NextResponse.json({ error: failure.error }, { status: failure.status })
      }
      books.push(saved)

      if (!isAdmin) {
        currentUsage = await getUserStorageUsage(user.id)
      }
    }

    return NextResponse.json(files.length === 1 ? books[0] : { books })
  } catch (err) {
    console.error('[upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  } finally {
    uploadingUsers.delete(user.id)
  }
}
