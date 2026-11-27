import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET() {
  try {
    const candidates = [
      path.join(process.cwd(), 'public/pdf.worker.min.mjs'),
      path.join(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
    ]
    let source = ''
    for (const workerPath of candidates) {
      try {
        source = await readFile(workerPath, 'utf8')
        break
      } catch {
        // try next path
      }
    }
    if (!source) throw new Error('Worker not found')

    return new NextResponse(source, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('[pdf-worker GET]', error)
    return NextResponse.json({ error: 'Worker not found' }, { status: 404 })
  }
}
