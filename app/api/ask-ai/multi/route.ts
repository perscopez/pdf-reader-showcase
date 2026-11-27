import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { checkAndIncrementAiQuota } from '@/lib/quotas'
import { checkRateLimit } from '@/lib/rateLimit'
import { getOwnedBookProtection } from '@/lib/encryptedBookPolicy'
import { runAiTextCompletion } from '@/lib/aiTextCompletion'
import {
  boundedCitedPages, buildCitedContext, buildCitedSystemPrompt, fallbackCitedAnswer,
  normalizeCitedBookIds, parseCitedAnswer, selectionIsFullyOwned, type CitedPage,
} from '@/lib/citedMultiDocumentAi'

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const limited = checkRateLimit(req, 'ask-ai-multi-rate', 40, 60 * 60 * 1000)
  if (limited) return limited

  try {
    const body = await req.json() as { bookIds?: unknown; question?: unknown }
    const bookIds = normalizeCitedBookIds(body.bookIds)
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!bookIds || !question || question.length > 2000) {
      return NextResponse.json({ error: 'Select 2–10 books and enter a question up to 2000 characters.' }, { status: 400 })
    }

    const books = db.prepare(`SELECT id, title, author, is_encrypted FROM books WHERE user_id = ? AND id IN (${bookIds.map(() => '?').join(',')})`).all(user.id, ...bookIds) as { id: number; title: string; author: string; is_encrypted: number }[]
    if (!selectionIsFullyOwned(bookIds, books)) return NextResponse.json({ error: 'One or more books were not found.' }, { status: 404 })
    if (books.some(book => getOwnedBookProtection(user.id, book.id) === 'encrypted')) {
      return NextResponse.json({ error: 'Encrypted books cannot be sent to cloud AI.', code: 'ENCRYPTED_BOOK_LOCAL_ONLY' }, { status: 409 })
    }
    if (!checkAndIncrementAiQuota(user.id, 50)) return NextResponse.json({ error: 'Daily AI request limit exceeded.' }, { status: 429 })

    const placeholders = bookIds.map(() => '?').join(',')
    const rows = db.prepare(`SELECT p.book_id AS bookId, b.title, b.author, p.page_number AS page, p.content FROM book_pages p JOIN books b ON b.id = p.book_id AND b.user_id = ? WHERE p.book_id IN (${placeholders}) ORDER BY p.book_id, p.page_number`).all(user.id, ...bookIds) as CitedPage[]
    const pages = boundedCitedPages(rows)
    const { context, citations } = buildCitedContext(pages, question)
    const prompt = buildCitedSystemPrompt(question, context)
    const rawAnswer = context ? await runAiTextCompletion([{ role: 'system', content: prompt }, { role: 'user', content: question }]) : ''
    const parsed = parseCitedAnswer(rawAnswer || fallbackCitedAnswer(question, citations), citations)
    return NextResponse.json({ ...parsed, answer: parsed.text, selectedBookIds: bookIds })
  } catch (error) {
    console.error('[ask-ai/multi POST]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
