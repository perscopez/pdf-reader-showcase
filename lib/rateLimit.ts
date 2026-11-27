import { NextRequest, NextResponse } from 'next/server'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateLimitEntry>()

function clientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  // CF-Connecting-IP is only trustworthy when the app is actually behind Cloudflare.
  const cloudflare = process.env.TRUST_CF_CONNECTING_IP === '1' ? req.headers.get('cf-connecting-ip') : null
  return cloudflare || req.headers.get('x-real-ip') || forwarded || 'unknown'
}

export function checkRateLimit(req: NextRequest, key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const bucketKey = `${key}:${clientIp(req)}`
  const current = buckets.get(bucketKey)

  if (!current || current.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs })
    return null
  }

  current.count += 1
  if (current.count <= limit) return null

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  return NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    }
  )
}
