import { cleanText } from './text'

export interface CitationMetadata {
  id?: number
  title?: string | null
  author?: string | null
  year?: number | string | null
  doi?: string | null
  isbn?: string | null
  publisher?: string | null
  publication?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  edition?: string | null
  language?: string | null
}

export interface CitationAnnotation {
  page: number
  type: string
  text?: string | null
  note?: string | null
  id?: number
}

export interface CitationInput extends CitationMetadata {
  annotations?: CitationAnnotation[]
}

export function detectCitationMetadata(text: string): Pick<CitationMetadata, 'doi' | 'isbn' | 'year'> {
  const doi = text.match(/\b10\.\d{4,9}\/[\w.!#$%&'*+/=?^_`{|}~-]+/i)?.[0]
  const isbn = text.match(/\b(?:97[89][\d\s-]{10,16}|\d[\d\s-]{8,14}[\dX])\b/i)?.[0]
  const year = text.match(/\b((?:18|19|20|21)\d{2})\b/)?.[1]
  return {
    doi: doi?.replace(/[.,;:)]+$/, '').toLowerCase(),
    isbn: isbn?.replace(/[\s-]/g, '').toUpperCase(),
    year,
  }
}

function value(input: unknown) {
  return cleanText(input == null ? '' : String(input))
}

function bibEscape(input: unknown) {
  return value(input).replace(/([\\{}])/g, '\\$1')
}

function risEscape(input: unknown) {
  return value(input).replace(/[\r\n]+/g, ' ').trim()
}

function key(input: CitationInput) {
  const author = value(input.author).split(/\s+/)[0]
  const year = value(input.year) || 'nd'
  const title = value(input.title).split(/\s+/)[0] || 'work'
  return `${author || ''}${author ? year : ''}${title}`.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase() || 'source'
}

function pageReference(annotation: CitationAnnotation) {
  const page = Number(annotation.page)
  return Number.isInteger(page) && page > 0 ? `p. ${page}` : ''
}

function annotationText(annotation: CitationAnnotation) {
  const quote = value(annotation.text)
  const note = value(annotation.note)
  return [pageReference(annotation), quote ? `“${quote}”` : '', note].filter(Boolean).join(': ').replace(': “', ': “')
}

function notes(input: CitationInput) {
  return (input.annotations || []).map(annotationText).filter(Boolean).join(' | ')
}

export function toBibTeX(input: CitationInput) {
  const fields: Array<[string, unknown]> = [
    ['title', input.title], ['author', input.author], ['year', input.year],
    ['publisher', input.publisher], ['journal', input.publication], ['volume', input.volume],
    ['number', input.issue], ['pages', input.pages], ['edition', input.edition],
    ['doi', input.doi], ['isbn', input.isbn], ['note', notes(input)],
  ]
  return `@book{${key(input)},\n${fields.filter(([, field]) => value(field)).map(([name, field]) => `  ${name} = {${bibEscape(field)}}`).join(',\n')}\n}`
}

export function toRIS(input: CitationInput) {
  const lines = [['TY', 'BOOK'], ['ID', key(input)], ['TI', input.title], ['AU', input.author], ['PY', input.year],
    ['PB', input.publisher], ['JO', input.publication], ['VL', input.volume], ['IS', input.issue], ['SP', input.pages],
    ['ET', input.edition], ['DO', input.doi], ['SN', input.isbn], ['N1', notes(input)]] as Array<[string, unknown]>
  return `${lines.filter(([, field]) => value(field)).map(([tag, field]) => `${tag}  - ${risEscape(field)}`).join('\n')}\nER  -`
}

export function toCslJson(input: CitationInput) {
  const item: Record<string, unknown> = { id: key(input), type: 'book', title: value(input.title) || undefined }
  const author = value(input.author)
  if (author) item.author = author.split(/\s+and\s+|\s*;\s*/i).map(name => {
    const parts = name.trim().split(/\s+/)
    return { given: parts.slice(0, -1).join(' '), family: parts.at(-1) }
  })
  if (value(input.year)) item.issued = { 'date-parts': [[Number(input.year) || value(input.year)]] }
  for (const [target, source] of [['DOI', input.doi], ['ISBN', input.isbn], ['publisher', input.publisher], ['container-title', input.publication], ['volume', input.volume], ['issue', input.issue], ['page', input.pages], ['edition', input.edition]] as const) {
    if (value(source)) item[target] = value(source)
  }
  const note = notes(input)
  if (note) item.note = note
  return JSON.stringify([item], null, 2)
}
