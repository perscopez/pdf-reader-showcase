import { NextRequest, NextResponse } from 'next/server'
import db, { purgeExpiredDeletedAccounts } from '@/lib/db'
import { cleanText } from '@/lib/text'
import { verifyPassword } from '@/lib/password'
import { setAuthCookie, type AuthUser } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'

function resetTestAccount(userId: number) {
  // Yalnizca okuma ilerlemesi sifirlanir. Vurgu/yer imi/kelime asla silinmez.
  db.transaction(() => {
    db.prepare(`
      UPDATE books
      SET last_page = 1, favorite = 0, status = 'reading', last_opened_at = NULL, total_reading_time = 0
      WHERE user_id = ?
    `).run(userId)
  })()
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'auth-login', 20, 10 * 60 * 1000)
  if (limited) return limited

  // Run the expired accounts purge
  try {
    purgeExpiredDeletedAccounts()
  } catch (e) {
    console.error('[login] Purge failed:', e)
  }

  const { username, password } = await req.json().catch(() => ({ username: '', password: '' }))
  const cleanUsername = cleanText(username || process.env.PDF_LIBRARY_USERNAME || 'owner').trim().toLowerCase()

  if (!cleanUsername || typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const user = db.prepare(`
    SELECT id, username, password_hash, role, is_test, email, is_email_verified, deleted_at, vault_salt, wrapped_vault_key, session_version
    FROM users
    WHERE username = ?
  `).get(cleanUsername) as (AuthUser & { password_hash: string; email: string; is_email_verified: number; deleted_at: string | null; vault_salt: string | null; wrapped_vault_key: string | null }) | undefined

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  if (user.deleted_at) {
    const deletedTime = new Date(user.deleted_at).getTime()
    const now = Date.now()
    if (now - deletedTime >= 7 * 24 * 60 * 60 * 1000) {
      // It is expired but not purged yet. Run purge and block.
      try {
        purgeExpiredDeletedAccounts()
      } catch {}
      return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
    }
    return NextResponse.json({ error: 'account_pending_deletion', deletedAt: user.deleted_at }, { status: 403 })
  }

  const hasEmail = Boolean(user.email && user.email.trim())
  if (hasEmail && !user.is_email_verified) {
    return NextResponse.json({ error: 'email_unverified', email: user.email }, { status: 403 })
  }

  if (user.is_test) resetTestAccount(user.id)

  const res = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      is_test: Boolean(user.is_test),
      vaultSalt: user.vault_salt || '',
      wrappedVaultKey: user.wrapped_vault_key || '',
    },
  })
  setAuthCookie(res, user)
  return res
}
