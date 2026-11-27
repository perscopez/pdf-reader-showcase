import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { encryptedBookLocalOnlyResponse, getOwnedBookProtection } from '@/lib/encryptedBookPolicy'
import { toBibTeX, toCslJson, toRIS, type CitationInput } from '@/lib/citations'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const { id } = await params
  const protection = getOwnedBookProtection(user.id, id)
  if (protection === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (protection === 'encrypted') return encryptedBookLocalOnlyResponse()

  const book = db.prepare('SELECT title, author, publication_year, doi, isbn, publisher, publication, volume, issue, pages, edition, language FROM books WHERE id = ? AND user_id = ?').get(id, user.id) as (CitationInput & { publication_year?: number }) | undefined
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const includeAnnotations = req.nextUrl.searchParams.get('annotations') !== '0'
  const annotations = includeAnnotations ? db.prepare('SELECT id, type, page, content FROM annotations WHERE book_id = ? AND user_id = ? ORDER BY page, id').all(id, user.id).map(row => {
    const item = row as { id: number; type: string; page: number; content: string }
    let content: { text?: string; note?: string } = {}
    try { content = JSON.parse(item.content || '{}') } catch { /* malformed legacy content is omitted */ }
    return { id: item.id, type: item.type, page: item.page, text: content.text, note: content.note }
  }) : []
  const input: CitationInput = { ...book, year: book.publication_year, annotations }
  const format = req.nextUrl.searchParams.get('format') || 'bibtex'
  const output = format === 'ris' ? toRIS(input) : format === 'csl-json' ? toCslJson(input) : toBibTeX(input)
  const contentType = format === 'csl-json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
  const extension = format === 'ris' ? 'ris' : format === 'csl-json' ? 'json' : 'bib'
  return new NextResponse(output, { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="citation-${id}.${extension}"`, 'Cache-Control': 'no-store' } })
}
