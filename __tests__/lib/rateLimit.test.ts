import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '@/lib/rateLimit'

function mockRequest(ip = '127.0.0.1') {
  return {
    headers: new Map([['x-forwarded-for', ip]]),
  } as unknown as Request
}

describe('checkRateLimit', () => {
  it('should allow requests within limit', () => {
    const result = checkRateLimit(mockRequest() as never, 'allow-test-1', 5, 60000)
    expect(result).toBeNull()
  })

  it('should block requests at the limit boundary', () => {
    const ip = `block-boundary-${Date.now()}`
    const req = mockRequest(ip)
    const limit = 2

    expect(checkRateLimit(req as never, 'boundary', limit, 60000)).toBeNull()
    expect(checkRateLimit(req as never, 'boundary', limit, 60000)).toBeNull()
    const blocked = checkRateLimit(req as never, 'boundary', limit, 60000)
    expect(blocked).not.toBeNull()
  })

  it('should use different buckets per IP', () => {
    const req1 = mockRequest(`ip-a-${Date.now()}`)
    const req2 = mockRequest(`ip-b-${Date.now()}`)

    checkRateLimit(req1 as never, 'same-key', 1, 60000)
    expect(checkRateLimit(req1 as never, 'same-key', 1, 60000)).not.toBeNull()
    expect(checkRateLimit(req2 as never, 'same-key', 1, 60000)).toBeNull()
  })

  it('should use different buckets per key', () => {
    const req = mockRequest(`key-test-${Date.now()}`)
    checkRateLimit(req as never, 'key-a', 1, 60000)
    expect(checkRateLimit(req as never, 'key-a', 1, 60000)).not.toBeNull()
    expect(checkRateLimit(req as never, 'key-b', 1, 60000)).toBeNull()
  })

  it('should return 429 status on block', () => {
    const req = mockRequest(`status-test-${Date.now()}`)
    checkRateLimit(req as never, 'status-test', 1, 60000)
    const blocked = checkRateLimit(req as never, 'status-test', 1, 60000)
    expect(blocked?.status).toBe(429)
  })

  it('should include retry-after header on block', () => {
    const req = mockRequest(`retry-test-${Date.now()}`)
    checkRateLimit(req as never, 'retry-test', 1, 60000)
    const blocked = checkRateLimit(req as never, 'retry-test', 1, 60000)
    const retryAfter = (blocked as Response)?.headers?.get('Retry-After')
    expect(retryAfter).toBeTruthy()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('should handle high limit gracefully', () => {
    const req = mockRequest(`high-limit-${Date.now()}`)
    for (let i = 0; i < 100; i++) {
      const result = checkRateLimit(req as never, 'high', 100, 60000)
      expect(result).toBeNull()
    }
  })
})
