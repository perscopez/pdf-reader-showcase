export const MIN_CITED_BOOKS = 2
export const MAX_CITED_BOOKS = 10
export const MAX_CITED_PAGES_PER_BOOK = 6
export const MAX_CITED_CONTEXT_CHARS = 24_000

export interface CitedPage {
  bookId: number
  title: string
  author: string
  page: number
  content: string
}

export interface Citation {
  bookId: number
  title: string
  author: string
  page: number
  label: string
  href: string
  excerpt: string
}

export interface ParsedCitedAnswer {
  text: string
  citations: Citation[]
  sourceNotFound: boolean
  citationFallback: boolean
}

export function normalizeCitedBookIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const ids = [...new Set(value.map(Number))]
  if (ids.some(id => !Number.isInteger(id) || id < 1)) return null
  if (ids.length < MIN_CITED_BOOKS || ids.length > MAX_CITED_BOOKS) return null
  return ids
}

export function selectionIsFullyOwned(selectedIds: number[], ownedRows: Array<{ id: number }>): boolean {
  const owned = new Set(ownedRows.map(row => row.id))
  return selectedIds.every(id => owned.has(id)) && ownedRows.length === selectedIds.length
}

export function boundedCitedPages(rows: CitedPage[]): CitedPage[] {
  const byBook = new Map<number, CitedPage[]>()
  for (const row of rows) {
    const pages = byBook.get(row.bookId) || []
    if (pages.length < MAX_CITED_PAGES_PER_BOOK && row.content.trim()) pages.push(row)
    byBook.set(row.bookId, pages)
  }
  return [...byBook.values()].flat()
}

export function buildCitedContext(pages: CitedPage[], question: string): { context: string; citations: Citation[] } {
  const terms = question.toLocaleLowerCase().split(/\s+/).map(term => term.replace(/[^\p{L}\p{N}]/gu, '')).filter(word => word.length > 2)
  const rankedPages = pages
    .map((page, index) => {
      const lower = page.content.toLocaleLowerCase()
      const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0)
      return { page, index, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
  let remaining = MAX_CITED_CONTEXT_CHARS
  const citations: Citation[] = []
  const chunks: string[] = []

  for (const ranked of rankedPages) {
    if (remaining <= 0) break
    const page = ranked.page
    const lower = page.content.toLocaleLowerCase()
    const match = terms.map(term => lower.indexOf(term)).find(index => index >= 0) ?? 0
    const start = Math.max(0, match - 180)
    const excerpt = page.content.slice(start, Math.min(page.content.length, start + 900)).trim()
    if (!excerpt) continue
    const citation: Citation = {
      bookId: page.bookId,
      title: page.title,
      author: page.author,
      page: page.page,
      label: `${page.title} · s. ${page.page}`,
      href: `/reader/${page.bookId}?page=${page.page}`,
      excerpt,
    }
    citations.push(citation)
    const chunk = `[SOURCE book=${page.bookId} page=${page.page} title="${page.title}"]\n${excerpt}`
    chunks.push(chunk.slice(0, remaining))
    remaining -= chunk.length + 2
  }

  return { context: chunks.join('\n\n'), citations }
}

export function buildCitedSystemPrompt(question: string, context: string): string {
  return `You are a careful research assistant. Answer the user's question only from the supplied sources.\n- Reply in the same language as the question.\n- Every material claim must cite one or more sources using exactly [CITATION book=<id> page=<number>].\n- Do not invent a page, quotation, title, or claim. If the sources do not support an answer, emit exactly [SOURCE_NOT_FOUND] and say that clearly.\n- Keep the answer concise and distinguish comparison between books when relevant.\n\nQUESTION: ${question}\n\nSOURCES:\n${context || '(no matching source pages)'}\n\nIf the sources do not answer the question, begin the response with [SOURCE_NOT_FOUND].`
}

export function fallbackCitedAnswer(question: string, citations: Citation[]): string {
  if (!citations.length) return `[SOURCE_NOT_FOUND] Bu soru için seçilen kitaplarda eşleşen kaynak bulunamadı: “${question}”.`
  return `Seçilen kitaplarda bu soruyla ilişkili kaynaklar bulundu. Ayrıntılı yanıt için aşağıdaki kaynakları inceleyin.\n\n` + citations.slice(0, 3).map(source => `${source.excerpt.slice(0, 320)} [CITATION book=${source.bookId} page=${source.page}]`).join('\n\n')
}

export function parseCitedAnswer(answer: string, citations: Citation[]): ParsedCitedAnswer {
  const referenced = new Set<string>()
  const citationPattern = /\[CITATION\s+book=(\d+)\s+page=(\d+)\]/gi
  const textWithoutTokens = answer
    .replace(citationPattern, (_, bookId: string, page: string) => {
      referenced.add(`${Number(bookId)}:${Number(page)}`)
      return ''
    })
    .replace(/\[SOURCE_NOT_FOUND\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const usedCitations = citations.filter(citation => referenced.has(`${citation.bookId}:${citation.page}`))
  const explicitSourceNotFound = /\[SOURCE_NOT_FOUND\]/i.test(answer)
    || /(?:source(?:s)?|kaynak(?:lar)?)\s+(?:not found|could not be found|bulunamadı|bulunamadi|yok)/i.test(answer)
    || /(?:does not support|not supported|desteklenmiyor|desteklenmemektedir|yanıtlanamıyor|cevaplanamıyor)/i.test(answer)
  const invalidCitations = referenced.size > 0 && usedCitations.length === 0
  const citationFallback = !explicitSourceNotFound && !invalidCitations && referenced.size === 0 && citations.length > 0
  const sourceNotFound = explicitSourceNotFound || invalidCitations || (referenced.size === 0 && citations.length === 0)
  const displayedCitations = usedCitations.length > 0 || !citationFallback ? usedCitations : citations.slice(0, 3)
  return { text: textWithoutTokens, citations: displayedCitations, sourceNotFound, citationFallback }
}
