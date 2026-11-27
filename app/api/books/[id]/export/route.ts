import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { PDFDocument, PDFPage, PDFFont, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'
import { getCurrentUser } from '@/lib/auth'

interface Point {
  x: number
  y: number
  pressure?: number
}

interface DrawPath {
  color: string
  width: number
  points: Point[]
  opacity?: number
  tool?: string
  text?: string
  fontSize?: number
}

interface AnnotationRow {
  type: string
  content: string
  page: number
}

function parseContent(row: AnnotationRow) {
  try {
    return JSON.parse(row.content || '{}') as { text?: string; note?: string; paths?: DrawPath[] }
  } catch {
    return {}
  }
}

function colorFromHex(value = '#38bdf8') {
  const hex = value.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
  const parsed = Number.parseInt(full, 16)
  if (Number.isNaN(parsed)) return rgb(0.22, 0.74, 0.97)
  return rgb(((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255)
}

function pdfText(value: unknown) {
  return cleanText(value)
}

function wrapText(text: string, maxChars = 92) {
  const words = pdfText(text).split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > maxChars) {
      if (line) lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function drawWrappedPdfText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxChars: number,
  size: number,
  font: PDFFont,
  color = rgb(0.08, 0.1, 0.15),
) {
  let cursorY = y
  for (const line of wrapText(text, maxChars)) {
    page.drawText(line, { x, y: cursorY, size, font, color })
    cursorY -= size * 1.25
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(_req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { id } = await params
    const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(id, user.id) as { title: string; filename: string } | undefined
    if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const source = await readFile(path.join(process.cwd(), 'public', 'uploads', book.filename))
    const pdf = await PDFDocument.load(source)
    pdf.registerFontkit(fontkit)
    const [fontBytes, boldBytes] = await Promise.all([
      readFile(path.join(process.cwd(), 'node_modules', '@fontsource', 'noto-sans', 'files', 'noto-sans-latin-400-normal.woff')),
      readFile(path.join(process.cwd(), 'node_modules', '@fontsource', 'noto-sans', 'files', 'noto-sans-latin-700-normal.woff')),
    ])
    const font = await pdf.embedFont(fontBytes)
    const bold = await pdf.embedFont(boldBytes)
    const annotations = db.prepare('SELECT type, content, page FROM annotations WHERE book_id = ? AND user_id = ? ORDER BY page, id').all(id, user.id) as AnnotationRow[]

    const notes: AnnotationRow[] = []
    for (const annotation of annotations) {
      const page = pdf.getPage(annotation.page - 1)
      if (!page) continue
      const content = parseContent(annotation)
      if (annotation.type === 'drawing' && Array.isArray(content.paths)) {
        const { height } = page.getSize()
        for (const item of content.paths) {
          const points = item.points || []
          if (points.length < 2 && !item.text) continue
          const color = colorFromHex(item.color)
          const width = Math.max(0.5, Number(item.width || 2))
          if ((item.tool === 'text' || item.tool === 'sticky') && item.text && points[0]) {
            const start = points[0]
            const end = points[1] || { x: start.x + 190, y: start.y + 90 }
            const left = Math.min(start.x, end.x)
            const top = Math.min(start.y, end.y)
            const boxWidth = Math.max(80, Math.abs(end.x - start.x))
            const boxHeight = Math.max(36, Math.abs(end.y - start.y))
            const size = Math.max(8, Number(item.fontSize || width * 4 || 14))
            if (item.tool === 'sticky') {
              page.drawRectangle({
                x: left,
                y: height - top - boxHeight,
                width: boxWidth,
                height: boxHeight,
                color,
                opacity: item.opacity ?? 0.92,
                borderColor: rgb(0.35, 0.28, 0.08),
                borderWidth: 0.5,
              })
              drawWrappedPdfText(page, item.text, left + 9, height - top - size - 9, Math.max(8, Math.floor(boxWidth / (size * 0.55))), size, font)
            } else {
              drawWrappedPdfText(page, item.text, left + 2, height - top - size, Math.max(8, Math.floor(boxWidth / (size * 0.55))), size, font, color)
            }
            continue
          }
          if (['line', 'arrow'].includes(item.tool || '')) {
            const start = points[0]
            const end = points[points.length - 1]
            page.drawLine({ start: { x: start.x, y: height - start.y }, end: { x: end.x, y: height - end.y }, thickness: width, color, opacity: item.opacity ?? 1 })
          } else if (item.tool === 'rectangle') {
            const start = points[0]
            const end = points[points.length - 1]
            page.drawRectangle({
              x: Math.min(start.x, end.x),
              y: height - Math.max(start.y, end.y),
              width: Math.abs(end.x - start.x),
              height: Math.abs(end.y - start.y),
              borderWidth: width,
              borderColor: color,
              opacity: item.opacity ?? 1,
            })
          } else if (item.tool === 'ellipse') {
            const start = points[0]
            const end = points[points.length - 1]
            page.drawEllipse({
              x: (start.x + end.x) / 2,
              y: height - ((start.y + end.y) / 2),
              xScale: Math.max(0.5, Math.abs(end.x - start.x) / 2),
              yScale: Math.max(0.5, Math.abs(end.y - start.y) / 2),
              borderWidth: width,
              borderColor: color,
              opacity: item.opacity ?? 1,
            })
          } else {
            for (let i = 1; i < points.length; i++) {
              page.drawLine({
                start: { x: points[i - 1].x, y: height - points[i - 1].y },
                end: { x: points[i].x, y: height - points[i].y },
                thickness: width,
                color,
                opacity: item.opacity ?? 1,
              })
            }
          }
        }
      } else {
        notes.push(annotation)
      }
    }

    if (notes.length) {
      let page = pdf.addPage()
      let { width, height } = page.getSize()
      let y = height - 54
      page.drawText('PDF Reader Notes', { x: 54, y, size: 18, font: bold, color: rgb(0.1, 0.12, 0.18) })
      y -= 34

      for (const annotation of notes) {
        const content = parseContent(annotation)
        const block = [`Page ${annotation.page} - ${annotation.type}`, content.text || '', content.note || ''].filter(Boolean)
        for (const [index, raw] of block.entries()) {
          for (const line of wrapText(raw, index === 0 ? 70 : 88)) {
            if (y < 54) {
              page = pdf.addPage()
              ;({ width, height } = page.getSize())
              y = height - 54
            }
            page.drawText(line, { x: 54, y, size: index === 0 ? 12 : 10, font: index === 0 ? bold : font, color: index === 0 ? rgb(0.25, 0.2, 0.65) : rgb(0.12, 0.14, 0.2) })
            y -= index === 0 ? 18 : 14
          }
        }
        y -= 10
      }
      void width
    }

    const bytes = await pdf.save()
    const filename = `${pdfText(book.title || 'annotated').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'annotated'}-annotated.pdf`
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[books export]', err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
