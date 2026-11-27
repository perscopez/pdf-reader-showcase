import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, unlink, copyFile, chmod } from 'fs/promises'
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

const MAX_EPUB_UNCOMPRESSED = 500 * 1024 * 1024
const MAX_EPUB_COMPRESSION_RATIO = 50

function getEpubTotalUncompressedSize(buffer: Buffer): number {
  const EOCD_SIG = 0x06054b50
  const CDFH_SIG = 0x02014b50

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
    total += buffer.readUInt32LE(pos + 24)
    const fnLen      = buffer.readUInt16LE(pos + 28)
    const extraLen   = buffer.readUInt16LE(pos + 30)
    const commentLen = buffer.readUInt16LE(pos + 32)
    pos += 46 + fnLen + extraLen + commentLen
  }
  return total
}

async function sanitizeEpubBuffer(buffer: Buffer<ArrayBufferLike>): Promise<Buffer<ArrayBufferLike>> {
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

const MAX_SIZE = 100 * 1024 * 1024
const MAX_BOOKS_PER_USER = 500
const IMPORT_SOURCES = new Set(['gutenberg', 'openlibrary', 'googlebooks'])

const GS_TIMEOUT_MS = 300_000
const PDFIMAGES_TIMEOUT_MS = 60_000

async function hasJpeg2000Images(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFilePromise('pdfimages', ['-list', filePath], {
      encoding: 'utf8',
      timeout: PDFIMAGES_TIMEOUT_MS,
    })
    // pdfimages -list output show . enc column with "jpx" for JPEG2000 images.
    return /jpx/i.test(stdout) || /jpeg2000/i.test(stdout)
  } catch {
    return false
  }
}

async function recompressPdfWithGs(inputPath: string, outputPath: string): Promise<void> {
  const gsArgs = [
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dNOPAUSE', '-dBATCH',
    '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false',
    '-dAutoFilterColorImages=false', '-dColorImageFilter=/DCTEncode',
    '-dAutoFilterGrayImages=false', '-dGrayImageFilter=/DCTEncode',
  ]
  const isLinux = process.platform === 'linux'
  const isRoot = isLinux && process.getuid && process.getuid() === 0

  if (isRoot) {
    const tmpIn = `/tmp/gs-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
    const tmpOut = `/tmp/gs-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
    try {
      await copyFile(inputPath, tmpIn)
      await chmod(tmpIn, 0o644)
      await execFilePromise(
        'runuser',
        ['-u', 'nobody', '--', 'gs', ...gsArgs, `-sOutputFile=${tmpOut}`, tmpIn],
        { timeout: GS_TIMEOUT_MS }
      )
      await copyFile(tmpOut, outputPath)
    } finally {
      try { await unlink(tmpIn) } catch {}
      try { await unlink(tmpOut) } catch {}
    }
  } else {
    await execFilePromise('gs', [
      ...gsArgs,
      `-sOutputFile=${outputPath}`, inputPath
    ], { timeout: GS_TIMEOUT_MS })
  }
}

function isAllowedDownloadUrl(value: string, source: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase()
    if (source === 'openlibrary') {
      return (hostname === 'archive.org' || hostname.endsWith('.archive.org')) &&
        (url.pathname.includes('/items/') || url.pathname.startsWith('/download/'))
    }
    if (source === 'gutenberg') return hostname === 'gutenberg.org' || hostname.endsWith('.gutenberg.org')
    if (source === 'googlebooks') {
      return hostname === 'googleapis.com' || hostname.endsWith('.googleapis.com') ||
        hostname === 'googleusercontent.com' || hostname.endsWith('.googleusercontent.com') ||
        hostname === 'google.com' || hostname.endsWith('.google.com')
    }
    return false
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = checkRateLimit(req, 'import-books', 10, 60 * 60 * 1000)
  if (limited) return limited

  try {
    const body = await req.json()
    const { downloadUrl, title, author, source, sourceId } = body

    if (!downloadUrl || !title) {
      return NextResponse.json({ error: 'downloadUrl and title are required' }, { status: 400 })
    }

    const cleanTitleStr = cleanText(title).trim() || 'Untitled'
    const authorStr = cleanText(author || '').trim()
    const sourceStr = cleanText(source || '').trim()
    const sourceIdStr = cleanText(sourceId || '').trim()
    if (!IMPORT_SOURCES.has(sourceStr) || !isAllowedDownloadUrl(downloadUrl, sourceStr)) {
      return NextResponse.json({ error: 'Invalid download source' }, { status: 400 })
    }

    // Dedup: check by source+sourceId first, then by normalized title+author
    let existing: { id: number; filename: string } | undefined

    if (sourceStr && sourceIdStr) {
      existing = db.prepare(
        'SELECT id, filename FROM books WHERE user_id = ? AND import_source = ? AND import_source_id = ?'
      ).get(user.id, sourceStr, sourceIdStr) as { id: number; filename: string } | undefined
    }

    if (!existing) {
      const all = db.prepare(
        'SELECT id, filename, title, author FROM books WHERE user_id = ?'
      ).all(user.id) as { id: number; filename: string; title: string; author: string }[]

      const normTitle = cleanTitleStr.toLowerCase().replace(/\s+/g, ' ')
      const normAuthor = authorStr.toLowerCase().replace(/\s+/g, ' ')
      existing = all.find(b => {
        const bt = cleanText(b.title).toLowerCase().replace(/\s+/g, ' ')
        const ba = cleanText(b.author || '').toLowerCase().replace(/\s+/g, ' ')
        return bt === normTitle && ba === normAuthor
      })
    }

    if (existing) {
      return NextResponse.json(
        { error: 'Bu kitap zaten kütüphanede.', existingBookId: existing.id },
        { status: 409 }
      )
    }

    if (user.role !== 'admin') {
      const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM books WHERE user_id = ?').get(user.id) as { cnt: number }
      if (cnt >= MAX_BOOKS_PER_USER) {
        return NextResponse.json(
          { error: `Book limit (${MAX_BOOKS_PER_USER}) reached. Delete some books before adding more.` },
          { status: 429 }
        )
      }

      const storageLimit = 2 * 1024 * 1024 * 1024
      const currentUsage = await getUserStorageUsage(user.id)
      if (currentUsage > storageLimit) {
        return NextResponse.json({ error: 'Storage quota (2 GB) exceeded.' }, { status: 413 })
      }
    }

    console.log(`[import] Downloading from ${source}/${sourceId}: ${downloadUrl?.slice(0, 120)}`)
    const downloadRes = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) })
    if (!downloadRes.ok) {
      return NextResponse.json({ error: `Download failed: HTTP ${downloadRes.status}` }, { status: 502 })
    }
    if (!isAllowedDownloadUrl(downloadRes.url, sourceStr)) {
      return NextResponse.json({ error: 'Download redirected to an invalid source' }, { status: 502 })
    }

    const contentType = downloadRes.headers.get('content-type') || ''
    const contentLength = Number(downloadRes.headers.get('content-length') || 0)
    if (contentLength > MAX_SIZE) {
      return NextResponse.json({ error: 'Book too large (max 100 MB).' }, { status: 413 })
    }
    let buffer = Buffer.from(await downloadRes.arrayBuffer())

    if (buffer.length > MAX_SIZE) {
      return NextResponse.json({ error: 'Book too large (max 100 MB).' }, { status: 413 })
    }

    const isPdf = buffer.subarray(0, 5).toString() === '%PDF-'
    const isEpub = buffer[0] === 0x50 && buffer[1] === 0x4b &&
      (contentType.includes('epub') || downloadRes.url.toLowerCase().includes('.epub'))
    if (!isPdf && !isEpub) {
      return NextResponse.json({ error: 'Source did not return a valid PDF or EPUB file.' }, { status: 502 })
    }

    const safeSource = sourceStr.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30)
    const safeSourceId = sourceIdStr.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const cleanTitleName = title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)

    const uploadDir = path.join(process.cwd(), 'public', 'uploads')
    await mkdir(uploadDir, { recursive: true })

    let finalFilename = ''

    if (isEpub) {
      // Sanitize EPUB buffer first
      try {
        buffer = Buffer.from(await sanitizeEpubBuffer(buffer))
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid EPUB file' }, { status: 400 })
      }

      // Save temporary EPUB file
      const tempEpubFilename = `temp-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeSource}-${safeSourceId}.epub`
      const tempEpubPath = path.join(uploadDir, tempEpubFilename)
      await writeFile(tempEpubPath, buffer)

      // Setup output PDF filename
      const pdfFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeSource}-${safeSourceId}-${cleanTitleName}.pdf`
      const finalPdfPath = path.join(uploadDir, pdfFilename)

      console.log(`[import] Converting downloaded EPUB to PDF: ${tempEpubFilename} -> ${pdfFilename}`)

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
            console.log(`[import] Running isolated calibre conversion as 'nobody': ${tmpInPath} -> ${tmpOutPath}`)
            await execFilePromise('runuser', ['-u', 'nobody', '--', 'ebook-convert', tmpInPath, tmpOutPath], { timeout: CONVERT_TIMEOUT_MS })
            await copyFile(tmpOutPath, finalPdfPath)
          } finally {
            try { await unlink(tmpInPath) } catch {}
            try { await unlink(tmpOutPath) } catch {}
          }
        } else {
          // Run normally on Windows / non-root Linux
          console.log(`[import] Running calibre conversion: ${tempEpubPath} -> ${finalPdfPath}`)
          await execFilePromise('ebook-convert', [tempEpubPath, finalPdfPath], {
            env: { ...process.env },
            timeout: CONVERT_TIMEOUT_MS,
          })
        }
        finalFilename = pdfFilename

        // Detect and fix JPEG2000 images in calibre output
        try {
          const hasJpx = await hasJpeg2000Images(finalPdfPath)
          if (hasJpx) {
            console.log(`[import] JPEG2000 detected in ${pdfFilename}. Recompressing with Ghostscript...`)
            const gsTempPath = path.join(uploadDir, `gs-temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`)
            await recompressPdfWithGs(finalPdfPath, gsTempPath)
            await copyFile(gsTempPath, finalPdfPath)
            try { await unlink(gsTempPath) } catch {}
            console.log(`[import] JPEG2000 recompression complete for ${pdfFilename}`)
          }
        } catch (jpxErr) {
          console.warn(`[import] JPEG2000 fix skipped for ${pdfFilename}:`, jpxErr)
        }
      } catch (err) {
        console.error('[import] Calibre conversion failed:', err)
        return NextResponse.json({ error: 'EPUB to PDF conversion failed.' }, { status: 500 })
      } finally {
        try { await unlink(tempEpubPath) } catch {}
      }
    } else {
      // PDF file - save directly
      const pdfFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeSource}-${safeSourceId}-${cleanTitleName}.pdf`
      const pdfPath = path.join(uploadDir, pdfFilename)
      await writeFile(pdfPath, buffer)
      finalFilename = pdfFilename

      // Detect and fix JPEG2000 images (Internet Archive PDFs) which cause blank canvas in Chrome/Firefox
      try {
        const hasJpx = await hasJpeg2000Images(pdfPath)
        if (hasJpx) {
          console.log(`[import] JPEG2000 detected in ${pdfFilename}. Recompressing with Ghostscript...`)
          const gsTempPath = path.join(uploadDir, `gs-temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`)
          await recompressPdfWithGs(pdfPath, gsTempPath)
          await copyFile(gsTempPath, pdfPath)
          try { await unlink(gsTempPath) } catch {}
          console.log(`[import] JPEG2000 recompression complete for ${pdfFilename}`)
        }
      } catch (jpxErr) {
        console.warn(`[import] JPEG2000 fix skipped for ${pdfFilename}:`, jpxErr)
      }
    }

    const result = db.prepare(
      'INSERT INTO books (user_id, title, author, filename, filepath, import_source, import_source_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, cleanTitleStr, authorStr, finalFilename, `/api/pdf/${finalFilename}`, sourceStr || null, sourceIdStr || null)

    const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(
      result.lastInsertRowid, user.id
    )

    if (book) {
      indexBookPages((book as { id: number }).id, finalFilename).catch(err => {
        console.error(`[import] Indexing failed for book ${(book as { id: number }).id}:`, err)
      })
    }

    return NextResponse.json(book)
  } catch (err) {
    console.error('[import]', err)
    const msg = err instanceof Error && err.name === 'TimeoutError'
      ? 'Download timed out. The source may be slow or unavailable.'
      : 'Import failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
