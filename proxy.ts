import { NextRequest, NextResponse } from 'next/server'

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return atob(padded)
}

const COOKIE_NAME = 'pdf_library_auth'
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'unknown'
const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || 'build unknown'
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function buildInfoHtml(loginUrl: string) {
  return `<!doctype html><html><body><a href="${loginUrl}">${BUILD_LABEL}</a><script type="application/json" id="build-info">{"buildId":"${BUILD_ID}"}</script><script>location.replace(${JSON.stringify(loginUrl)})</script></body></html>`
}

function securityHeaders(res: NextResponse) {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  res.headers.set('Referrer-Policy', 'same-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  return res
}

function clientKey(req: NextRequest) {
  // Prefer X-Real-IP, which the bundled nginx config overwrites with $remote_addr.
  // The first X-Forwarded-For entry is client-controlled and only used as a fallback.
  return req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

function rateLimit(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  if (!pathname.startsWith('/api/') && pathname !== '/login') return null

  const isAuth = pathname.startsWith('/api/auth/login') || pathname.startsWith('/api/auth/register')
  const isUpload = pathname.startsWith('/api/upload') || pathname.startsWith('/api/backup')
  const limit = isAuth ? 12 : isUpload ? 30 : 240
  const windowMs = 60_000
  const key = `${clientKey(req)}:${isAuth ? 'auth' : isUpload ? 'upload' : 'api'}`
  const now = Date.now()
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, entry] of rateBuckets) {
      if (entry.resetAt <= now) rateBuckets.delete(bucketKey)
    }
  }
  const bucket = rateBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }

  bucket.count += 1
  if (bucket.count <= limit) return null

  return securityHeaders(NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)),
      },
    }
  ))
}

function sessionSecret() {
  return process.env.PDF_LIBRARY_SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? process.env.PDF_LIBRARY_AUTH_TOKEN : '') || ''
}

function base64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signPayload(encodedPayload: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
  return base64Url(signature)
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hasValidSession(value?: string) {
  const legacyToken = process.env.NODE_ENV !== 'production' ? process.env.PDF_LIBRARY_AUTH_TOKEN : undefined
  if (legacyToken && value === legacyToken) return true
  if (!value) return false
  if (!sessionSecret()) return false

  const [encoded, signature] = value.split('.')
  if (!encoded || !signature) return false
  if (!constantTimeEqual(signature, await signPayload(encoded))) return false

  try {
    const payload = JSON.parse(decodeBase64Url(encoded))
    return Boolean(payload?.userId && payload?.exp && payload.exp > Date.now())
  } catch {
    return false
  }
}

function isPublicPath(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/dmca' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/register' ||
    pathname === '/api/auth/check-account' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/vault-salt' ||
    pathname === '/api/auth/recover-vault' ||
    pathname === '/api/auth/resend-verification' ||
    pathname === '/api/auth/restore-account' ||
    pathname === '/api/auth/verify-email' ||
    pathname === '/api/dmca' ||
    pathname === '/api/health' ||
    pathname === '/api/pdf-worker' ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon-32.png' ||
    pathname === '/manifest.json' ||
    pathname === '/apple-touch-icon.png' ||
    pathname === '/icon-192.png' ||
    pathname === '/icon-512.png' ||
    pathname === '/icon-maskable-512.png' ||
    pathname === '/pdf.worker.min.js' ||
    pathname === '/pdf.worker.min.mjs' ||
    pathname === '/pdf.worker.version.json' ||
    pathname === '/sw.js' ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/workbox-') ||
    pathname.startsWith('/themes/') ||
    pathname.startsWith('/tesseract/') ||
    pathname.startsWith('/standard_fonts/') ||
    pathname.startsWith('/cmaps/')
  )
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const limited = rateLimit(req)
  if (limited) return limited

  if (isPublicPath(pathname)) return securityHeaders(NextResponse.next())

  const isAuthenticated = await hasValidSession(req.cookies.get(COOKIE_NAME)?.value)

  if (isAuthenticated) return securityHeaders(NextResponse.next())

  if (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) {
    return securityHeaders(NextResponse.json({ error: 'Authentication required' }, { status: 401 }))
  }

  const loginUrl = req.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.searchParams.set('next', `${pathname}${search}`)
  if (req.method === 'GET' && pathname === '/' && (req.headers.get('user-agent') || '').toLowerCase().includes('curl')) {
    return securityHeaders(new NextResponse(buildInfoHtml(loginUrl.toString()), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }))
  }
  return securityHeaders(new NextResponse(
    buildInfoHtml(loginUrl.toString()),
    {
      status: 307,
      headers: {
        Location: loginUrl.toString(),
        'Content-Type': 'text/html; charset=utf-8',
      },
    }
  ))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
