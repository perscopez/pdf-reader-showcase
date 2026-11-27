import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveInternetArchiveDownload, searchOpenLibrary } from '@/lib/bookSources'

afterEach(() => vi.unstubAllGlobals())

describe('Open Library downloadable results', () => {
  it('prioritizes public scans and resolves their real Internet Archive file URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://archive.org/metadata/')) {
        return new Response(JSON.stringify({
          d1: 'ia601500.us.archive.org',
          dir: '/17/items/public-nutuk',
          files: [{ name: 'public nutuk.pdf', format: 'Text PDF', size: '7000000' }],
        }), { status: 200 })
      }
      if (decodeURIComponent(url).includes('ebook_access:public')) {
        return new Response(JSON.stringify({ docs: [{
          key: '/works/OLPUBLICW',
          title: 'Public Nutuk',
          author_name: ['Mustafa Kemal Atatürk'],
          ia: ['public-nutuk'],
          ebook_access: 'public',
          availability: { identifier: 'public-nutuk', status: 'open' },
        }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ docs: [{
        key: '/works/OLCATALOGW',
        title: 'Catalog Nutuk',
        author_name: ['Mustafa Kemal Atatürk'],
      }] }), { status: 200 })
    }))

    const results = await searchOpenLibrary('nutuk', 12)

    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Public Nutuk')
    expect(results[0].downloadUrl).toBe('https://ia601500.us.archive.org/17/items/public-nutuk/public%20nutuk.pdf')
    expect(results[0].sourceId).toBe('OLPUBLICW:public-nutuk')
    expect(results[1].downloadUrl).toBeUndefined()
  })

  it('ignores archive files above the application import limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      files: [{ name: 'oversized.pdf', format: 'Text PDF', size: String(101 * 1024 * 1024) }],
    }), { status: 200 })))

    await expect(resolveInternetArchiveDownload('oversized')).resolves.toBeUndefined()
  })
})
