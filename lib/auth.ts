import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import db from './db'

export const AUTH_COOKIE_NAME = 'pdf_library_auth'
const SESSION_DAYS = 30

export interface AuthUser {
  id: number
  username: string
  role: string
  is_test: number
  session_version?: number
  avatar?: string
}

interface SessionPayload {
  userId: number
  username: string
  isTest: boolean
  exp: number
  sessionVersion: number
}

function sessionSecret() {
  const secret = process.env.PDF_LIBRARY_SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? process.env.PDF_LIBRARY_AUTH_TOKEN : undefined)
  if (!secret) {
    throw new Error('PDF_LIBRARY_SESSION_SECRET is not set. Configure it in the environment to enable authentication.')
  }
  return secret
}

function signEncodedPayload(encodedPayload: string) {
  return createHmac('sha256', sessionSecret()).update(encodedPayload).digest('base64url')
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createSessionValue(user: AuthUser) {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    isTest: Boolean(user.is_test),
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
    sessionVersion: user.session_version || 0,
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${signEncodedPayload(encoded)}`
}

function readSession(value?: string | null): SessionPayload | null {
  if (!value) return null

  const legacyToken = process.env.NODE_ENV !== 'production' ? process.env.PDF_LIBRARY_AUTH_TOKEN : undefined
  if (legacyToken && value === legacyToken) {
    const admin = db.prepare(`SELECT id, username, role, is_test FROM users WHERE is_test = 0 ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id LIMIT 1`).get() as AuthUser | undefined
    if (!admin) return null
    return {
      userId: admin.id,
      username: admin.username,
      isTest: Boolean(admin.is_test),
      exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
      sessionVersion: admin.session_version || 0,
    }
  }

  const [encoded, signature] = value.split('.')
  if (!encoded || !signature) return null
  if (!safeEqual(signature, signEncodedPayload(encoded))) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function getCurrentUser(req: NextRequest): AuthUser | null {
  const payload = readSession(req.cookies.get(AUTH_COOKIE_NAME)?.value)
  if (!payload) return null

  const user = db.prepare(`SELECT id, username, role, is_test, avatar, deleted_at, session_version FROM users WHERE id = ?`).get(payload.userId) as (AuthUser & { deleted_at: string | null }) | undefined

  if (!user || user.deleted_at || (user.session_version || 0) !== (payload.sessionVersion || 0)) return null

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    is_test: user.is_test,
    avatar: user.avatar,
  }
}

export function setAuthCookie(res: NextResponse, user: AuthUser) {
  res.cookies.set(AUTH_COOKIE_NAME, createSessionValue(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

export function userOwnsBook(userId: number, bookId: unknown) {
  return Boolean(db.prepare('SELECT id FROM books WHERE id = ? AND user_id = ?').get(bookId, userId))
}
