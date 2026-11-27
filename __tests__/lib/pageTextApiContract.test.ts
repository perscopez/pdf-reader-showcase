import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  transaction: vi.fn(),
  indexBookPages: vi.fn(),
  enqueueBookIndexing: vi.fn(),
  writes: [] as string[],
  cachedFingerprint: 'sha256:fixture',
}))

vi.mock('@/lib/auth', () => ({ getCurrentUser: () => ({ id: 7 }) }))
vi.mock('@/lib/encryptedBookPolicy', () => ({
  getOwnedBookProtection: () => 'plain',
  encryptedBookLocalOnlyResponse: vi.fn(),
}))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => null }))
vi.mock('@/lib/indexer', () => ({
  TEXT_EXTRACTION_VERSION: 9,
  indexBookPages: (...args: unknown[]) => mocks.indexBookPages(...args),
  enqueueBookIndexing: (...args: unknown[]) => mocks.enqueueBookIndexing(...args),
  getDocumentRevisionFingerprint: vi.fn(() => 'sha256:fixture'),
}))
vi.mock('@/lib/pdfTextModel', () => ({
  PAGE_TEXT_MODEL_VERSION: 5,
  isValidPageTextModel: () => true,
  pageTextModelMatchesDocument: (
    value: { provenance?: { documentFingerprint?: string } },
    fingerprint: string,
  ) => value.provenance?.documentFingerprint === fingerprint,
}))
vi.mock('@/lib/db', () => ({
  default: {
    prepare: (...args: unknown[]) => mocks.prepare(...args),
    transaction: (...args: unknown[]) => mocks.transaction(...args),
  },
}))

import { GET, POST } from '@/app/api/books/[id]/page-text/route'

const model = (quality: number) => ({
  version: 5,
  source: 'ocr',
  quality,
  needsOcr: false,
  text: 'fixture page text',
  blocks: [],
  words: [{ text: 'fixture', left: 0.1, top: 0.1, width: 0.1, height: 0.03, line: 1 }],
  provenance: {
    documentFingerprint: 'sha256:fixture',
    rotation: 0,
    extractor: 'tesseract',
    extractorVersion: 'fixture',
    languages: ['eng', 'tur'],
    dpi: 300,
  },
})

function statement(sql: unknown) {
  const source = String(sql)
  return {
    get: (...args: unknown[]) => {
      if (source.includes('SELECT filename')) {
        return { filename: 'fixture.pdf', version: 0, file_revision: 'sha256:fixture' }
      }
      if (source.includes('FROM page_text_models')) {
        return {
          source: 'ocr',
          quality: 0.95,
          extraction_version: 5,
          model_json: JSON.stringify({
            ...model(0.95),
            provenance: {
              ...model(0.95).provenance,
              documentFingerprint: mocks.cachedFingerprint,
            },
          }),
        }
      }
      if (source.includes('FROM book_pages')) {
        return {
          page_number: Number(args[1]),
          content: 'cached page',
          layout_json: null,
          extraction_version: 9,
          file_revision: 'sha256:fixture',
        }
      }
      return undefined
    },
    all: (...args: unknown[]) => {
      if (source.includes('FROM book_pages')) {
        const cursor = Number(args[1] ?? 0)
        const limit = Number(args.at(-1) ?? 2)
        return Array.from({ length: Math.min(limit, 3) }, (_, index) => ({
          page_number: cursor + index + 1,
          content: `page ${cursor + index + 1}`,
        }))
      }
      return []
    },
    run: () => {
      mocks.writes.push(source)
      return { changes: 1 }
    },
  }
}

describe('page-text API safety and scalability contract', () => {
  beforeEach(() => {
    mocks.writes.length = 0
    mocks.prepare.mockReset()
    mocks.prepare.mockImplementation(statement)
    mocks.transaction.mockReset()
    mocks.transaction.mockImplementation((callback: () => unknown) => () => callback())
    mocks.indexBookPages.mockReset()
    mocks.indexBookPages.mockReturnValue(new Promise<void>(() => {}))
    mocks.enqueueBookIndexing.mockReset()
    mocks.cachedFingerprint = 'sha256:fixture'
  })

  it('serves a cached page without awaiting a full-book background reindex', async () => {
    const response = await Promise.race([
      GET(new NextRequest('http://localhost/api/books/12/page-text?page=3'), {
        params: Promise.resolve({ id: '12' }),
      }),
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 100)),
    ])

    expect(response).not.toBe('timeout')
    if (response === 'timeout') return
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ page: 3, text: 'fixture page text' })
  })

  it('paginates all-pages reads with a bounded limit and cursor', async () => {
    mocks.indexBookPages.mockResolvedValue(undefined)
    const response = await GET(
      new NextRequest('http://localhost/api/books/12/page-text?limit=2&cursor=2'),
      { params: Promise.resolve({ id: '12' }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      pages: [
        { page_number: 3, content: 'page 3' },
        { page_number: 4, content: 'page 4' },
      ],
      pagination: { limit: 2, nextCursor: 4, hasMore: true },
    })
    const pageQuery = mocks.prepare.mock.calls
      .map(call => String(call[0]))
      .find(sql => sql.includes('FROM book_pages') && sql.includes('LIMIT'))
    expect(pageQuery).toMatch(/page_number\s*>\s*\?/)
  })

  it('keeps an existing high-quality OCR model instead of accepting a downgrade', async () => {
    const response = await POST(new NextRequest('http://localhost/api/books/12/page-text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: 3, model: model(0.4) }),
    }), { params: Promise.resolve({ id: '12' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, keptExisting: true })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.writes).toEqual([])
  })

  it('accepts a genuinely higher-quality OCR replacement', async () => {
    const response = await POST(new NextRequest('http://localhost/api/books/12/page-text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: 3, model: model(0.98) }),
    }), { params: Promise.resolve({ id: '12' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, keptExisting: false })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.writes).toHaveLength(2)
  })

  it('ignores stale cached provenance and does not let it block a replacement document', async () => {
    mocks.cachedFingerprint = 'sha256:previous-file'
    const getResponse = await GET(
      new NextRequest('http://localhost/api/books/12/page-text?page=3'),
      { params: Promise.resolve({ id: '12' }) },
    )
    await expect(getResponse.json()).resolves.toMatchObject({ text: 'cached page' })

    const postResponse = await POST(new NextRequest('http://localhost/api/books/12/page-text', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: 3, model: model(0.4) }),
    }), { params: Promise.resolve({ id: '12' }) })
    await expect(postResponse.json()).resolves.toEqual({ success: true, keptExisting: false })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})
