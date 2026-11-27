import { describe, expect, it } from 'vitest'
import { boundedCitedPages, buildCitedContext, normalizeCitedBookIds, parseCitedAnswer, selectionIsFullyOwned } from '@/lib/citedMultiDocumentAi'

describe('cited multi-document AI bounds and citations', () => {
  it('requires 2–10 unique positive book ids', () => {
    expect(normalizeCitedBookIds([1])).toBeNull()
    expect(normalizeCitedBookIds([1, 1, 2])).toEqual([1, 2])
    expect(normalizeCitedBookIds(Array.from({ length: 11 }, (_, i) => i + 1))).toBeNull()
  })

  it('limits pages per book and emits reader deep links', () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ bookId: 7, title: 'A', author: '', page: index + 1, content: `term ${index}` }))
    const result = buildCitedContext(boundedCitedPages(rows), 'term')
    expect(result.citations).toHaveLength(6)
    expect(result.citations[0].href).toBe('/reader/7?page=1')
    expect(result.context).toContain('[SOURCE book=7 page=1')
  })

  it('does not cite unrelated pages and parses source chips from answer tokens', () => {
    const pages = boundedCitedPages([
      { bookId: 7, title: 'A', author: '', page: 1, content: 'history of astronomy' },
      { bookId: 7, title: 'A', author: '', page: 2, content: 'a recipe for bread' },
    ])
    const result = buildCitedContext(pages, 'astronomy')
    expect(result.citations.map(citation => citation.page)).toEqual([1])
    const parsed = parseCitedAnswer(`Astronomi anlatılıyor. [CITATION book=7 page=1]`, result.citations)
    expect(parsed.text).toBe('Astronomi anlatılıyor.')
    expect(parsed.citations).toHaveLength(1)
    expect(parsed.sourceNotFound).toBe(false)
  })

  it('marks explicit and empty-source answers as not found', () => {
    expect(parseCitedAnswer('[SOURCE_NOT_FOUND] Kaynak bulunamadı.', []).sourceNotFound).toBe(true)
    expect(parseCitedAnswer('Bu iddia desteklenmiyor.', []).sourceNotFound).toBe(true)
    expect(parseCitedAnswer('Bu iddia kaynaklarda desteklenmiyor.', [{ bookId: 7, title: 'A', author: '', page: 1, label: 'A · s. 1', href: '/reader/7?page=1', excerpt: 'context' }]).sourceNotFound).toBe(true)
  })

  it('shows matching context sources when the model omits inline citation tokens', () => {
    const pages = boundedCitedPages([
      { bookId: 7, title: 'A', author: '', page: 1, content: 'history of astronomy' },
    ])
    const context = buildCitedContext(pages, 'astronomy')
    const parsed = parseCitedAnswer('Astronomi anlatılıyor.', context.citations)
    expect(parsed.sourceNotFound).toBe(false)
    expect(parsed.citationFallback).toBe(true)
    expect(parsed.citations).toHaveLength(1)
    expect(parsed.citations[0]?.page).toBe(1)
  })

  it('keeps the parsed answer available to the UI contract', () => {
    const pages = boundedCitedPages([
      { bookId: 7, title: 'A', author: '', page: 1, content: 'history of astronomy' },
    ])
    const context = buildCitedContext(pages, 'astronomy')
    const parsed = parseCitedAnswer('Astronomi anlatılıyor. [CITATION book=7 page=1]', context.citations)
    expect(parsed.text).toBe('Astronomi anlatılıyor.')
    expect(parsed.citations[0]?.href).toBe('/reader/7?page=1')
  })

  it('rejects a selection containing a book outside the owned snapshot', () => {
    expect(selectionIsFullyOwned([1, 2], [{ id: 1 }, { id: 2 }])).toBe(true)
    expect(selectionIsFullyOwned([1, 3], [{ id: 1 }, { id: 2 }])).toBe(false)
  })
})
