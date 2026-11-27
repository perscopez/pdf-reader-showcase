import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  protection: 'encrypted' as 'missing' | 'plain' | 'encrypted',
  getOwnedBookProtection: vi.fn(),
  prepare: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => ({ id: 7, username: 'fixture-user', role: 'user' }),
  userOwnsBook: vi.fn(),
}))

vi.mock('@/lib/encryptedBookPolicy', () => ({
  getOwnedBookProtection: (...args: unknown[]) => mocks.getOwnedBookProtection(...args),
  encryptedBookLocalOnlyResponse: () => new Response(JSON.stringify({
    error: 'Encrypted book derived data is local-only',
    code: 'ENCRYPTED_BOOK_LOCAL_ONLY',
  }), {
    status: 409,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  }),
}))

vi.mock('@/lib/db', () => ({
  default: {
    prepare: (...args: unknown[]) => mocks.prepare(...args),
    transaction: vi.fn(() => () => undefined),
  },
}))

vi.mock('@/lib/indexer', () => ({
  TEXT_EXTRACTION_VERSION: 99,
  indexBookPages: vi.fn(() => Promise.reject(new Error('encrypted books must not be indexed'))),
}))

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => null }))

import { GET as getPageText, POST as postPageText } from '@/app/api/books/[id]/page-text/route'
import {
  GET as getAnnotations,
  PATCH as patchAnnotation,
  POST as postAnnotation,
} from '@/app/api/annotations/route'
import { GET as getAnnotationAsset, POST as postAnnotationAsset } from '@/app/api/annotation-assets/route'
import { GET as getWords, POST as postWord } from '@/app/api/words/route'
import { GET as pullSync } from '@/app/api/sync/pull/route'
import { POST as pushSync } from '@/app/api/sync/push/route'

async function expectLocalOnly(response: Response) {
  expect(response.status).toBe(409)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toEqual({
    error: 'Encrypted book derived data is local-only',
    code: 'ENCRYPTED_BOOK_LOCAL_ONLY',
  })
}

describe('encrypted-book derived data server boundary', () => {
  beforeEach(() => {
    mocks.protection = 'encrypted'
    mocks.getOwnedBookProtection.mockReset()
    mocks.getOwnedBookProtection.mockImplementation(() => mocks.protection)
    mocks.prepare.mockReset()
    mocks.prepare.mockImplementation((sql: unknown) => ({
      get: () => String(sql).includes('FROM annotations')
        ? { id: 41, user_id: 7, book_id: 12, type: 'note', content: '{}', page: 1, book_is_encrypted: 1 }
        : undefined,
      all: () => [],
      run: () => ({ changes: 1, lastInsertRowid: 1 }),
    }))
  })

  it('rejects encrypted page-text reads before cache lookup or full-book indexing', async () => {
    const request = new NextRequest('http://localhost/api/books/12/page-text?page=1')
    const response = await getPageText(request, { params: Promise.resolve({ id: '12' }) })

    await expectLocalOnly(response)
    expect(mocks.getOwnedBookProtection).toHaveBeenCalledWith(7, 12)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('rejects plaintext page-text model writes before reading the request body or database', async () => {
    const request = new NextRequest('http://localhost/api/books/12/page-text', {
      method: 'POST',
      body: '{ deliberately invalid plaintext model',
      headers: { 'content-type': 'application/json' },
    })
    const response = await postPageText(request, { params: Promise.resolve({ id: '12' }) })

    await expectLocalOnly(response)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('rejects encrypted annotation list and create operations before persistence', async () => {
    const getResponse = await getAnnotations(
      new NextRequest('http://localhost/api/annotations?book_id=12'),
    )
    await expectLocalOnly(getResponse)
    expect(mocks.prepare).not.toHaveBeenCalled()

    const postResponse = await postAnnotation(new NextRequest('http://localhost/api/annotations', {
      method: 'POST',
      body: JSON.stringify({ book_id: 12, type: 'note', content: { note: 'plaintext' }, page: 1 }),
      headers: { 'content-type': 'application/json' },
    }))
    await expectLocalOnly(postResponse)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('rejects updates to legacy encrypted-book annotations without writing', async () => {
    const response = await patchAnnotation(new NextRequest('http://localhost/api/annotations', {
      method: 'PATCH',
      body: JSON.stringify({ id: 41, content: { note: 'new plaintext' } }),
      headers: { 'content-type': 'application/json' },
    }))

    await expectLocalOnly(response)
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
  })

  it('rejects encrypted annotation preview upload and download before filesystem access', async () => {
    const postResponse = await postAnnotationAsset(new NextRequest('http://localhost/api/annotation-assets', {
      method: 'POST',
      body: JSON.stringify({ book_id: 12, data_url: 'data:image/png;base64,cGxhaW50ZXh0' }),
      headers: { 'content-type': 'application/json' },
    }))
    await expectLocalOnly(postResponse)

    const getResponse = await getAnnotationAsset(
      new NextRequest('http://localhost/api/annotation-assets?book_id=12&file=legacy.png'),
    )
    await expectLocalOnly(getResponse)
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('keeps missing ownership indistinguishable from an absent book', async () => {
    mocks.protection = 'missing'
    const response = await getPageText(
      new NextRequest('http://localhost/api/books/999/page-text?page=1'),
      { params: Promise.resolve({ id: '999' }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('filters legacy encrypted-book words out of the server word library', async () => {
    const response = await getWords(new NextRequest('http://localhost/api/words'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual([])
    const query = mocks.prepare.mock.calls.map(call => String(call[0])).join('\n')
    expect(query).toContain('LEFT JOIN books b ON w.source_book_id = b.id')
    expect(query).toMatch(/COALESCE\(b\.is_encrypted,\s*0\)\s*=\s*0/)
  })

  it('rejects encrypted-book words through direct and sync write paths', async () => {
    const direct = await postWord(new NextRequest('http://localhost/api/words', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        word: 'secret', definition: '', context: 'plaintext', source_book_id: 12, source_page: 1,
      }),
    }))
    await expectLocalOnly(direct)

    const sync = await pushSync(new NextRequest('http://localhost/api/sync/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        changes: [{
          entity: 'word',
          action: 'upsert',
          local_id: 1,
          data: { word: 'secret', source_book_id: 12 },
          updated_at: '2026-08-01T12:00:00.000Z',
        }],
      }),
    }))
    await expectLocalOnly(sync)
    expect(mocks.getOwnedBookProtection).toHaveBeenCalledWith(7, 12)
  })

  it('filters encrypted annotations, bookmarks and words from sync pull queries', async () => {
    const response = await pullSync(new NextRequest('http://localhost/api/sync/pull'))
    expect(response.status).toBe(200)

    const queries = mocks.prepare.mock.calls.map(call => String(call[0]))
    const derivativeQueries = queries.filter(sql => (
      sql.includes('SELECT a.*') || sql.includes('SELECT bm.*') || sql.includes('SELECT w.*')
    ))
    expect(derivativeQueries).toHaveLength(3)
    expect(derivativeQueries.every(sql => /COALESCE\(b\.is_encrypted,\s*0\)\s*=\s*0/.test(sql))).toBe(true)
  })
})
