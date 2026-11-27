import { describe, expect, it } from 'vitest'
import { buildPageText, buildSnippet, findMatchesInText, normalizeSearchQuery, withPageNumber } from '@/lib/pdfInDocSearch'

describe('pdfInDocSearch', () => {
  it('normalizes search queries', () => {
    expect(normalizeSearchQuery('  Hello ')).toBe('hello')
  })

  it('builds page text from pdf.js items', () => {
    expect(buildPageText([{ str: 'Hello ' }, { str: 'world' }])).toBe('Hello world')
  })

  it('finds all case-insensitive matches with per-page occurrence indexes', () => {
    const matches = findMatchesInText('Test test TEST', 'test')
    expect(matches.map(m => ({ start: m.start, end: m.end, occurrenceOnPage: m.occurrenceOnPage }))).toEqual([
      { start: 0, end: 4, occurrenceOnPage: 0 },
      { start: 5, end: 9, occurrenceOnPage: 1 },
      { start: 10, end: 14, occurrenceOnPage: 2 },
    ])
  })

  it('attaches a context snippet with the matched span located inside it', () => {
    const [match] = findMatchesInText('The quick brown fox jumps over the lazy dog', 'fox')
    expect(match.snippet).toContain('fox')
    expect(match.snippet.slice(match.snippetMatchStart, match.snippetMatchEnd)).toBe('fox')
  })

  it('adds ellipsis markers when the snippet is clipped', () => {
    const longText = `${'a '.repeat(60)}needle${' b'.repeat(60)}`
    const result = buildSnippet(longText, longText.indexOf('needle'), longText.indexOf('needle') + 6)
    expect(result.snippet.startsWith('…')).toBe(true)
    expect(result.snippet.endsWith('…')).toBe(true)
    expect(result.snippet.slice(result.snippetMatchStart, result.snippetMatchEnd)).toBe('needle')
  })

  it('stamps the page number on matches', () => {
    const matches = withPageNumber(findMatchesInText('alpha beta', 'beta'), 7)
    expect(matches[0].page).toBe(7)
  })

  it('returns no matches for empty query', () => {
    expect(findMatchesInText('Hello', '   ')).toEqual([])
  })
})
