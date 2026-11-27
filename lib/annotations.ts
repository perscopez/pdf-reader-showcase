import type { Annotation } from '@/components/ReaderTypes'
import { cleanText } from '@/lib/text'

export type AnnotationKindFilter = 'all' | 'page' | 'source' | 'area' | 'multi'
export type AnnotationSort = 'page-asc' | 'created-desc' | 'updated-desc'

export interface AnnotationFilters {
  query?: string
  type?: 'all' | 'note' | 'highlight'
  kind?: AnnotationKindFilter
  tag?: string
  categoryId?: number | null
  color?: string
  currentPageOnly?: boolean
  currentPage?: number
  sort?: AnnotationSort
}

const EDITABLE_CONTENT_KEYS = [
  'schemaVersion',
  'text',
  'note',
  'color',
  'rects',
  'cfi',
  'source',
  'pageNote',
  'tags',
  'categoryId',
  'area',
  'sources',
] as const

type EditableContentKey = (typeof EDITABLE_CONTENT_KEYS)[number]

export function normalizeAnnotationTags(input: unknown, limit = 12): string[] {
  if (!Array.isArray(input)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of input) {
    const tag = cleanText(String(value ?? '')).trim().slice(0, 40)
    const key = tag.toLocaleLowerCase('tr')
    if (!tag || seen.has(key)) continue
    seen.add(key)
    result.push(tag)
    if (result.length >= limit) break
  }
  return result
}

export function buildAnnotationDraftKey(bookId: number, page: number, annotationId?: number | null) {
  return `reader:annotation-draft:${bookId}:${page}:${annotationId || 'new'}`
}

export function validateAnnotationPatchInput(input: unknown): { id: number; content: Partial<Annotation['content']> } | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as { id?: unknown; content?: unknown }
  const id = Number(raw.id)
  if (!Number.isInteger(id) || id <= 0 || !raw.content || typeof raw.content !== 'object' || Array.isArray(raw.content)) return null

  const source = raw.content as Record<string, unknown>
  const content: Partial<Annotation['content']> = {}
  for (const key of EDITABLE_CONTENT_KEYS) {
    if (!(key in source)) continue
    const value = source[key]
    if (key === 'tags') {
      content.tags = normalizeAnnotationTags(value)
    } else if (key === 'categoryId') {
      if (value !== null && (!Number.isInteger(Number(value)) || Number(value) <= 0)) return null
      content.categoryId = value === null ? null : Number(value)
    } else if (key === 'text' || key === 'note' || key === 'color' || key === 'cfi' || key === 'source') {
      content[key as Extract<EditableContentKey, 'text' | 'note' | 'color' | 'cfi' | 'source'>] = cleanText(String(value ?? '')).trim()
    } else if (key === 'pageNote') {
      if (typeof value !== 'boolean') return null
      content.pageNote = value
    } else if (key === 'schemaVersion') {
      if (value !== 2) return null
      content.schemaVersion = 2
    } else if (key === 'rects' || key === 'area' || key === 'sources') {
      content[key] = value as never
    }
  }

  if (Object.keys(content).length === 0) return null
  return { id, content }
}

function annotationKind(annotation: Annotation): AnnotationKindFilter {
  if (annotation.content.pageNote) return 'page'
  if (annotation.content.sources?.length) return 'multi'
  if (annotation.content.area) return 'area'
  return 'source'
}

function timestamp(annotation: Annotation, field: 'created_at' | 'updated_at') {
  const value = annotation[field]
  const parsed = value ? new Date(value).getTime() : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function filterAnnotations(items: Annotation[], filters: AnnotationFilters = {}) {
  const query = cleanText(filters.query || '').trim().toLocaleLowerCase('tr')
  const tag = cleanText(filters.tag || '').trim().toLocaleLowerCase('tr')

  const result = items.filter(item => {
    if (filters.type && filters.type !== 'all' && item.type !== filters.type) return false
    if (filters.kind && filters.kind !== 'all' && annotationKind(item) !== filters.kind) return false
    if (
      filters.currentPageOnly
      && filters.currentPage
      && item.page !== filters.currentPage
      && !item.content.sources?.some(source => source.page === filters.currentPage)
    ) return false
    if (filters.color && item.content.color !== filters.color) return false
    if (filters.categoryId !== undefined && filters.categoryId !== null && item.content.categoryId !== filters.categoryId) return false
    if (tag && !normalizeAnnotationTags(item.content.tags).some(itemTag => itemTag.toLocaleLowerCase('tr') === tag)) return false
    if (query) {
      const sourceTexts = item.content.sources?.map(source => source.text || '').join(' ') || ''
      const haystack = cleanText([
        item.content.text || '',
        item.content.note || '',
        sourceTexts,
        normalizeAnnotationTags(item.content.tags).join(' '),
      ].join(' ')).toLocaleLowerCase('tr')
      if (!haystack.includes(query)) return false
    }
    return true
  })

  const sort = filters.sort || 'page-asc'
  return result.sort((a, b) => {
    if (sort === 'created-desc') return timestamp(b, 'created_at') - timestamp(a, 'created_at') || b.id - a.id
    if (sort === 'updated-desc') {
      const aTime = timestamp(a, 'updated_at') || timestamp(a, 'created_at')
      const bTime = timestamp(b, 'updated_at') || timestamp(b, 'created_at')
      return bTime - aTime || b.id - a.id
    }
    return a.page - b.page || a.id - b.id
  })
}

export interface AnnotationDeepLink {
  bookId: number
  page: number
  annotationId: number
  sourceIndex?: number
}

export function buildAnnotationDeepLink(bookId: number, page: number, annotationId: number, sourceIndex?: number) {
  const params = new URLSearchParams({
    page: String(page),
    annotation: String(annotationId),
  })
  if (typeof sourceIndex === 'number' && sourceIndex >= 0) params.set('source', String(sourceIndex))
  return `/reader/${bookId}?${params.toString()}`
}

export function parseAnnotationDeepLink(input: string): AnnotationDeepLink | null {
  try {
    const url = new URL(input, 'https://reader.local')
    const match = url.pathname.match(/^\/reader\/(\d+)$/)
    if (!match) return null
    const bookId = Number(match[1])
    const page = Number(url.searchParams.get('page'))
    const annotationId = Number(url.searchParams.get('annotation'))
    const sourceRaw = url.searchParams.get('source')
    const sourceIndex = sourceRaw === null ? undefined : Number(sourceRaw)
    if (![bookId, page, annotationId].every(value => Number.isInteger(value) && value > 0)) return null
    if (sourceIndex !== undefined && (!Number.isInteger(sourceIndex) || sourceIndex < 0)) return null
    return { bookId, page, annotationId, ...(sourceIndex === undefined ? {} : { sourceIndex }) }
  } catch {
    return null
  }
}
