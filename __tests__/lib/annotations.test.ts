import { describe, expect, it } from 'vitest'
import {
  buildAnnotationDeepLink,
  buildAnnotationDraftKey,
  filterAnnotations,
  normalizeAnnotationTags,
  parseAnnotationDeepLink,
  validateAnnotationPatchInput,
} from '@/lib/annotations'
import type { Annotation } from '@/components/ReaderTypes'

const annotations: Annotation[] = [
  {
    id: 1,
    type: 'note',
    page: 2,
    content: { note: 'Sayfanın ana fikri', pageNote: true, tags: ['Önemli'] },
    created_at: '2026-07-01T10:00:00Z',
  },
  {
    id: 2,
    type: 'note',
    page: 4,
    content: {
      text: 'Kaynak paragraf',
      note: 'Daha sonra araştır',
      tags: ['Araştır'],
      rects: [{ left: 0.1, top: 0.3, width: 0.5, height: 0.04 }],
    },
    created_at: '2026-07-02T10:00:00Z',
  },
  {
    id: 3,
    type: 'highlight',
    page: 4,
    content: { text: 'Önemli alıntı', color: '#facc15', tags: ['Alıntı'] },
    created_at: '2026-07-03T10:00:00Z',
  },
]

describe('annotation helpers', () => {
  it('normalizes tags without duplicates, empty values, or unbounded length', () => {
    expect(normalizeAnnotationTags(['  Önemli ', 'önemli', '', 'Araştır', 'x'.repeat(80)]))
      .toEqual(['Önemli', 'Araştır', 'x'.repeat(40)])
  })

  it('builds stable draft keys for new and existing notes', () => {
    expect(buildAnnotationDraftKey(12, 7)).toBe('reader:annotation-draft:12:7:new')
    expect(buildAnnotationDraftKey(12, 7, 99)).toBe('reader:annotation-draft:12:7:99')
  })

  it('filters notes by page-note kind, tag, current page, and search text', () => {
    expect(filterAnnotations(annotations, { type: 'note', kind: 'page' }).map(item => item.id)).toEqual([1])
    expect(filterAnnotations(annotations, { tag: 'Araştır' }).map(item => item.id)).toEqual([2])
    expect(filterAnnotations(annotations, { currentPageOnly: true, currentPage: 4 }).map(item => item.id)).toEqual([2, 3])
    expect(filterAnnotations(annotations, { query: 'alıntı' }).map(item => item.id)).toEqual([3])
    expect(filterAnnotations([
      ...annotations,
      {
        id: 4,
        type: 'note',
        page: 2,
        content: { note: 'Bağlantı', sources: [{ page: 2, text: 'A' }, { page: 9, text: 'B' }] },
      },
    ], { currentPageOnly: true, currentPage: 9 }).map(item => item.id)).toEqual([4])
  })

  it('sorts by updated time descending while remaining compatible with legacy rows', () => {
    const result = filterAnnotations([
      ...annotations,
      { ...annotations[0], id: 4, updated_at: '2026-07-10T10:00:00Z' },
    ], { sort: 'updated-desc' })

    expect(result.map(item => item.id)).toEqual([4, 3, 2, 1])
  })

  it('round-trips an annotation deep link with an optional source index', () => {
    const link = buildAnnotationDeepLink(42, 8, 120, 2)
    expect(link).toBe('/reader/42?page=8&annotation=120&source=2')
    expect(parseAnnotationDeepLink(link)).toEqual({
      bookId: 42,
      page: 8,
      annotationId: 120,
      sourceIndex: 2,
    })
  })

  it('rejects malformed annotation deep links', () => {
    expect(parseAnnotationDeepLink('/reader/nope?page=2&annotation=3')).toBeNull()
    expect(parseAnnotationDeepLink('/reader/1?page=0&annotation=3')).toBeNull()
    expect(parseAnnotationDeepLink('/reader/1?page=2')).toBeNull()
  })

  it('accepts a bounded editable annotation patch and normalizes its tags', () => {
    expect(validateAnnotationPatchInput({
      id: 12,
      content: { note: '  Düzenlenmiş not  ', tags: ['Önemli', 'önemli', ' Araştır '] },
    })).toEqual({
      id: 12,
      content: { note: 'Düzenlenmiş not', tags: ['Önemli', 'Araştır'] },
    })
  })

  it('rejects invalid or empty annotation patches', () => {
    expect(validateAnnotationPatchInput({ id: 0, content: { note: 'x' } })).toBeNull()
    expect(validateAnnotationPatchInput({ id: 1, content: {} })).toBeNull()
    expect(validateAnnotationPatchInput({ id: 1, content: { unknown: true } })).toBeNull()
  })
})
