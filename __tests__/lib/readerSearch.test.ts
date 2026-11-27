import { describe, expect, it } from 'vitest'
import { readerSearchCacheKey, searchReaderDocument } from '@/lib/readerSearch'

describe('reader search', () => {
  it('searches pages concurrently but returns deterministic page order', async () => {
    const matches = await searchReaderDocument({
      query: 'kitap',
      pages: [1, 2, 3],
      loadPage: async page => {
        await new Promise(resolve => setTimeout(resolve, page === 1 ? 8 : 1))
        return page === 2 ? 'Bu kitap ikinci sayfada.' : page === 3 ? 'Başka kitap burada.' : ''
      },
    })
    expect(matches.map(match => match.page)).toEqual([2, 3])
    expect(matches[0]?.snippet).toContain('kitap')
  })

  it('cancels stale requests', async () => {
    const controller = new AbortController()
    const promise = searchReaderDocument({ query: 'kitap', pages: [1], loadPage: async () => { await new Promise(resolve => setTimeout(resolve, 15)); return 'kitap' }, signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('normalizes cache keys', () => {
    expect(readerSearchCacheKey(3, '  İNCE   ÇALIŞMA ')).toBe('3:ince çalışma')
  })
})
