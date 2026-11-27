import { cleanText } from '@/lib/text'

export interface PdfSearchMatch {
  page: number
  start: number
  end: number
  occurrenceOnPage: number
  snippet: string
  snippetMatchStart: number
  snippetMatchEnd: number
}

export function foldTurkishChars(str: string): string {
  return cleanText(str)
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/ı/g, 'i')
    .toLocaleLowerCase('tr-TR')
    .trim()
}

export function normalizeSearchQuery(query: string): string {
  return foldTurkishChars(query)
}

export function buildPageText(items: { str: string }[]): string {
  return items.map(item => item.str).join('')
}

export function buildSnippet(
  text: string,
  start: number,
  end: number,
  radius = 48,
): { snippet: string; snippetMatchStart: number; snippetMatchEnd: number } {
  const rawFrom = Math.max(0, start - radius)
  const rawTo = Math.min(text.length, end + radius)

  let from = rawFrom
  if (rawFrom > 0) {
    const space = text.indexOf(' ', rawFrom)
    if (space !== -1 && space < start) from = space + 1
  }
  let to = rawTo
  if (rawTo < text.length) {
    const space = text.lastIndexOf(' ', rawTo)
    if (space !== -1 && space > end) to = space
  }

  const leadingEllipsis = from > 0 ? '… ' : ''
  const trailingEllipsis = to < text.length ? ' …' : ''
  const core = text.slice(from, to).replace(/\s+/g, ' ').trimStart()
  const trimmedLeadOffset = text.slice(from, to).length - text.slice(from, to).trimStart().length

  const snippet = `${leadingEllipsis}${core}${trailingEllipsis}`
  const snippetMatchStart = leadingEllipsis.length + (start - from) - trimmedLeadOffset
  const snippetMatchEnd = snippetMatchStart + (end - start)

  return {
    snippet,
    snippetMatchStart: Math.max(0, snippetMatchStart),
    snippetMatchEnd: Math.max(0, snippetMatchEnd),
  }
}

export function findMatchesInText(text: string, query: string): PdfSearchMatch[] {
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return []

  const normalizedText = foldTurkishChars(text)
  const matches: PdfSearchMatch[] = []
  let pos = 0
  let occurrence = 0

  while (pos < normalizedText.length) {
    const idx = normalizedText.indexOf(normalizedQuery, pos)
    if (idx === -1) break
    const end = idx + normalizedQuery.length
    const { snippet, snippetMatchStart, snippetMatchEnd } = buildSnippet(text, idx, end)
    matches.push({
      page: 0,
      start: idx,
      end,
      occurrenceOnPage: occurrence,
      snippet,
      snippetMatchStart,
      snippetMatchEnd,
    })
    occurrence += 1
    pos = idx + Math.max(1, normalizedQuery.length)
  }

  return matches
}

export function withPageNumber(matches: PdfSearchMatch[], page: number): PdfSearchMatch[] {
  return matches.map(match => ({ ...match, page }))
}
