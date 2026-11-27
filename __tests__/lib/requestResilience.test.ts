import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout } from '@/lib/request'
import { fetchJsonWithTimeout } from '@/lib/requestResilience'

describe('request resilience', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('parses JSON through the shared bounded request helper', async () => {
    const response = new Response(JSON.stringify({ role: 'admin' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchJsonWithTimeout<{ role: string }>('/api/auth/me', {}, 1000))
      .resolves.toEqual({ response, data: { role: 'admin' } })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('forwards caller cancellation to the actual network request', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = fetchWithTimeout('/api/auth/me', { signal: controller.signal }, 10_000)

    controller.abort(new DOMException('Navigation changed', 'AbortError'))

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('aborts a stalled request at its timeout boundary', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = fetchWithTimeout('/api/stalled', {}, 250)
    const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })

    await vi.advanceTimersByTimeAsync(250)

    await rejection
  })
})
