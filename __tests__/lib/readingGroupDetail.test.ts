import { describe, expect, it } from 'vitest'
import {
  annotationText,
  canDeleteGroupAnnotation,
  canDeleteGroupReply,
  canManageGroup,
  groupDetailHref,
  sourceHref,
} from '@/components/readingGroupDetailModel'

describe('reading group detail model', () => {
  it('builds stable group and source links', () => {
    expect(groupDetailHref(7)).toBe('/groups/7')
    expect(sourceHref(12, 34)).toBe('/reader/12?page=34')
  })

  it('keeps owner-only controls separate from member controls', () => {
    expect(canManageGroup('owner')).toBe(true)
    expect(canManageGroup('member')).toBe(false)
    expect(canDeleteGroupAnnotation({ id: 1, author_user_id: 22, visibility: 'private' }, 22, 'member')).toBe(true)
    expect(canDeleteGroupAnnotation({ id: 1, author_user_id: 22, visibility: 'group' }, 23, 'member')).toBe(false)
    expect(canDeleteGroupAnnotation({ id: 1, author_user_id: 22, visibility: 'group' }, 23, 'owner')).toBe(true)
  })

  it('allows reply removal only for its author or the owner', () => {
    expect(canDeleteGroupReply({ id: 3, author_user_id: 22 }, 22, 'member')).toBe(true)
    expect(canDeleteGroupReply({ id: 3, author_user_id: 22 }, 23, 'member')).toBe(false)
    expect(canDeleteGroupReply({ id: 3, author_user_id: 22 }, 23, 'owner')).toBe(true)
  })

  it('extracts readable annotation text without rendering object data', () => {
    expect(annotationText({ note: '  kısa not  ', text: 'başka' })).toBe('kısa not')
    expect(annotationText({ quote: 'alıntı' })).toBe('alıntı')
    expect(annotationText({ paths: [] })).toBe('')
  })
})
