import { describe, expect, it } from 'vitest'
import { detectCitationMetadata, toBibTeX, toCslJson, toRIS } from '@/lib/citations'

describe('citation manager', () => {
  const input = {
    title: 'A {useful} book', author: 'Ada Lovelace and Grace Hopper', year: 1843,
    doi: '10.1234/example', isbn: '9789750800000', publisher: 'Press', publication: 'Journal',
    annotations: [{ page: 12, type: 'highlight', text: 'A quoted passage', note: 'Follow up' }],
  }

  it('detects DOI, ISBN and year without online metadata', () => {
    expect(detectCitationMetadata('Title 10.5555/ABC.123, ISBN 978-975-080-0000 (2024)')).toEqual({ doi: '10.5555/abc.123', isbn: '9789750800000', year: '2024' })
  })

  it('escapes BibTeX fields and keeps page-aware notes', () => {
    const output = toBibTeX(input)
    expect(output).toContain('title = {A \\{useful\\} book}')
    expect(output).toContain('p. 12: “A quoted passage”: Follow up')
  })

  it('omits missing optional fields and emits valid minimal formats', () => {
    expect(toRIS({ title: 'Untitled' })).toBe('TY  - BOOK\nID  - untitled\nTI  - Untitled\nER  -')
    expect(toCslJson({ title: 'Untitled' })).not.toContain('undefined')
  })
})
