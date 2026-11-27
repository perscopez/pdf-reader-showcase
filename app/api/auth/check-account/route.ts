import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { checkRateLimit } from '@/lib/rateLimit'

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 'auth-check-account', 10, 15 * 60 * 1000)
  if (limited) return limited

  const { searchParams } = new URL(req.url)
  const username = (searchParams.get('username') || '').trim().toLowerCase()

  if (!username) {
    return NextResponse.json({ exists: false, hasEmail: false, isEmailVerified: false, hasRecoveryKey: false })
  }

  const user = db.prepare(`
    SELECT id, username, email, is_email_verified, recovery_wrapped_vault_key
    FROM users
    WHERE LOWER(username) = ?
  `).get(username) as {
    id: number
    username: string
    email: string | null
    is_email_verified: number
    recovery_wrapped_vault_key: string | null
  } | undefined

  if (!user) {
    return NextResponse.json({ exists: false, hasEmail: false, isEmailVerified: false, hasRecoveryKey: false })
  }

  const hasEmail = Boolean(user.email && user.email.trim())
  const isEmailVerified = Boolean(user.is_email_verified)
  const hasRecoveryKey = Boolean(user.recovery_wrapped_vault_key && user.recovery_wrapped_vault_key.trim())

  let notice: string | null = null
  if (!hasEmail) {
    notice = 'Beta Sürümü Uyarısı: Bu hesapta tanımlı e-posta adresi bulunmamaktadır. Beta sürecinde e-posta ile şifre sıfırlama veya doğrulama bağlantısı gönderme işlemi bu hesap için kısıtlanmıştır.'
  } else if (!isEmailVerified) {
    notice = 'Beta Sürümü Uyarısı: Bu hesabın e-postası doğrulanmamış. Lütfen e-postanızı kontrol edin veya yöneticinizle iletişime geçin.'
  }

  return NextResponse.json({
    exists: true,
    hasEmail,
    isEmailVerified,
    hasRecoveryKey,
    notice,
  })
}
