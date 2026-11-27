import { describe, it, expect, beforeEach } from 'vitest'
import { getAssetUrl } from '@/lib/api'

describe('getAssetUrl', () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL
  })

  afterEach(() => {
    if (originalBaseUrl) process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl
  })

  it('should return empty string for null/undefined', () => {
    expect(getAssetUrl(null)).toBe('')
    expect(getAssetUrl(undefined)).toBe('')
  })

  it('should return absolute URLs as-is', () => {
    expect(getAssetUrl('https://example.com/image.jpg')).toBe('https://example.com/image.jpg')
    expect(getAssetUrl('http://example.com/image.jpg')).toBe('http://example.com/image.jpg')
  })

  it('should return data URIs as-is', () => {
    expect(getAssetUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
  })

  it('should return blob URLs as-is', () => {
    expect(getAssetUrl('blob:http://localhost/test')).toBe('blob:http://localhost/test')
  })

  it('should prefix relative paths with base URL when set', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.com'
    expect(getAssetUrl('/uploads/image.jpg')).toBe('https://api.example.com/uploads/image.jpg')
  })

  it('should handle base URL with trailing slash', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.com/'
    const result = getAssetUrl('/uploads/image.jpg')
    expect(result).toMatch(/^https:\/\/api\.example\.com/)
    expect(result).toContain('/uploads/image.jpg')
  })

  it('should return relative path as-is when no base URL', () => {
    expect(getAssetUrl('/uploads/image.jpg')).toBe('/uploads/image.jpg')
  })

  it('should handle empty string input', () => {
    expect(getAssetUrl('')).toBe('')
  })
})
