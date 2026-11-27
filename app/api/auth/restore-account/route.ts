import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'
import { verifyPassword } from '@/lib/password'
import { setAuthCookie, type AuthUser } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'auth-restore', 5, 10 * 60 * 1000)
  if (limited) return limited

  const { username, password } = await req.json().catch(() => ({ username: '', password: '' }))
  const cleanUsername = cleanText(username || '').trim().toLowerCase()

  if (!cleanUsername || typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const user = db.prepare(`
    SELECT id, username, password_hash, role, is_test, email, is_email_verified, deleted_at, session_version
    FROM users
    WHERE username = ?
  `).get(cleanUsername) as (AuthUser & { password_hash: string; email: string; is_email_verified: number; deleted_at: string | null }) | undefined

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  if (user.deleted_at) {
    const deletedTime = new Date(user.deleted_at).getTime()
    const now = Date.now()
    if (now - deletedTime >= 7 * 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
    }

    // Clear deletion flag
    db.prepare('UPDATE users SET deleted_at = NULL WHERE id = ?').run(user.id)
  }

  const res = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      is_test: Boolean(user.is_test),
    },
  })
  setAuthCookie(res, user)
  return res
}
