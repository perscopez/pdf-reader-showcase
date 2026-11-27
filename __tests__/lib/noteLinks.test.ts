import { describe, expect, it } from 'vitest'
import { parseNoteLinks } from '@/lib/noteLinks'

describe('note link parser', () => {
  it('recognizes plain http, https, and www links while preserving text', () => {
    expect(parseNoteLinks('Bkz. https://example.com/a ve www.example.org.')).toEqual([
      { type: 'text', text: 'Bkz. ' },
      { type: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
      { type: 'text', text: ' ve ' },
      { type: 'link', text: 'www.example.org', href: 'https://www.example.org/' },
      { type: 'text', text: '.' },
    ])
  })

  it('recognizes safe Markdown links and keeps the label', () => {
    expect(parseNoteLinks('Oku: [Kaynak](https://example.com/page?q=1)')).toEqual([
      { type: 'text', text: 'Oku: ' },
      { type: 'link', text: 'Kaynak', href: 'https://example.com/page?q=1' },
    ])
  })

  it('keeps unsafe protocols and malformed Markdown inert', () => {
    const text = '[Tehlikeli](javascript:alert(1)) ve [eksik](https://example.com'
    expect(parseNoteLinks(text)).toEqual([{ type: 'text', text }])
  })

  it('supports multiple links and line breaks', () => {
    const tokens = parseNoteLinks('Birinci https://a.example\nİkinci [B](www.b.example)')
    expect(tokens.filter(token => token.type === 'link')).toEqual([
      { type: 'link', text: 'https://a.example', href: 'https://a.example/' },
      { type: 'link', text: 'B', href: 'https://www.b.example/' },
    ])
    expect(tokens.map(token => token.text).join('')).toBe('Birinci https://a.example\nİkinci B')
  })

  it('does not include common trailing punctuation in a URL', () => {
    expect(parseNoteLinks('Git: https://example.com/test), sonra.')).toEqual([
      { type: 'text', text: 'Git: ' },
      { type: 'link', text: 'https://example.com/test', href: 'https://example.com/test' },
      { type: 'text', text: '), sonra.' },
    ])
  })
})
