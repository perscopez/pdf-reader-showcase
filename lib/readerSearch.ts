import { findMatchesInText, normalizeSearchQuery, withPageNumber, type PdfSearchMatch } from './pdfInDocSearch'
import { normalizeReaderSearchKey } from './readerV3'

export interface ReaderSearchPage {
  page: number
  text: string
}

export interface ReaderSearchOptions {
  query: string
  pages: number[]
  loadPage: (page: number) => Promise<string>
  signal?: AbortSignal
  concurrency?: number
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError')
}

/** Bounded concurrent document search. It keeps page order deterministic while
 * allowing a new query to cancel the old one before stale matches are painted. */
export async function searchReaderDocument({ query, pages, loadPage, signal, concurrency = 4 }: ReaderSearchOptions): Promise<PdfSearchMatch[]> {
  const normalized = normalizeSearchQuery(query)
  if (!normalized || normalized.length < 2 || pages.length === 0) return []
  const results: ReaderSearchPage[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < pages.length) {
      throwIfAborted(signal)
      const index = cursor++
      const page = pages[index]
      const text = await loadPage(page).catch(() => '')
      throwIfAborted(signal)
      results[index] = { page, text }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), pages.length) }, () => worker()))
  throwIfAborted(signal)
  return results.flatMap(item => withPageNumber(findMatchesInText(item.text, normalized), item.page))
}

export function readerSearchCacheKey(bookId: number, query: string) {
  return `${bookId}:${normalizeReaderSearchKey(query)}`
}

