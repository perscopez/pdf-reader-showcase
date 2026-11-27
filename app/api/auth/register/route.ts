import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import db, { distributeOwnerBooksToUser } from '@/lib/db'
import { cleanText } from '@/lib/text'
import { hashPassword } from '@/lib/password'
import { checkRateLimit } from '@/lib/rateLimit'

type AvailabilityError = 'invalid_invite' | 'username_exists' | 'email_exists'
type AvailabilityResult = { invite: { id: number } } | { error: AvailabilityError }
type RegistrationResult = { userId: number } | { error: AvailabilityError }

type RegisterBody = {
  mode?: string
  username?: unknown
  password?: unknown
  email?: unknown
  inviteCode?: unknown
  website?: unknown
  vaultSalt?: unknown
  wrappedVaultKey?: unknown
  recoveryWrappedVaultKey?: unknown
  recoveryVerifier?: unknown
}

function getAvailability(cleanUsername: string, cleanEmail: string, inviteCode: string): AvailabilityResult {
  const invite = db.prepare('SELECT id FROM invitation_codes WHERE code = ? AND used_by_user_id IS NULL').get(inviteCode.trim()) as { id: number } | undefined
  if (!invite) return { error: 'invalid_invite' as const }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername)) return { error: 'username_exists' as const }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) return { error: 'email_exists' as const }
  return { invite }
}

function availabilityErrorResponse(error: AvailabilityError) {
  if (error === 'invalid_invite') return NextResponse.json({ error: 'invalid_invite' }, { status: 400 })
  if (error === 'email_exists') return NextResponse.json({ error: 'email_exists' }, { status: 409 })
  return NextResponse.json({ error: 'Username already exists' }, { status: 409 })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as RegisterBody
    const preflight = body.mode === 'preflight'
    const limited = checkRateLimit(req, preflight ? 'auth-register-preflight' : 'auth-register', preflight ? 30 : 8, 60 * 60 * 1000)
    if (limited) return limited

    const {
      username = '',
      password = '',
      email = '',
      inviteCode = '',
      website = '',
      vaultSalt = '',
      wrappedVaultKey = '',
      recoveryWrappedVaultKey = '',
      recoveryVerifier = '',
    } = body

    const cleanUsername = cleanText(username).trim().toLowerCase()

    if (typeof website === 'string' && website.trim()) {
      return NextResponse.json({ error: 'Invalid account details' }, { status: 400 })
    }

    if (
      !/^[a-z0-9._-]{3,32}$/.test(cleanUsername) ||
      typeof password !== 'string' ||
      password.length < 8 ||
      typeof email !== 'string' ||
      !email.includes('@') ||
      typeof inviteCode !== 'string' ||
      !inviteCode.trim()
    ) {
      return NextResponse.json({ error: 'Invalid account details' }, { status: 400 })
    }

    const cleanEmail = email.trim().toLowerCase()
    const availability = getAvailability(cleanUsername, cleanEmail, inviteCode)
    if ('error' in availability) return availabilityErrorResponse(availability.error)

    if (preflight) {
      return NextResponse.json({ success: true })
    }

    if (
      typeof recoveryVerifier !== 'string' ||
      !/^[a-f0-9]{64}$/.test(recoveryVerifier) ||
      typeof vaultSalt !== 'string' ||
      typeof wrappedVaultKey !== 'string' ||
      typeof recoveryWrappedVaultKey !== 'string' ||
      !vaultSalt ||
      !wrappedVaultKey ||
      !recoveryWrappedVaultKey
    ) {
      return NextResponse.json({ error: 'Invalid account details' }, { status: 400 })
    }

    const resendApiKey = process.env.RESEND_API_KEY?.trim()
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const shouldSendVerification = Boolean(resendApiKey)

    const registration = db.transaction((): RegistrationResult => {
      const latest = getAvailability(cleanUsername, cleanEmail, inviteCode)
      if ('error' in latest) return latest

      const result = db.prepare(`
        INSERT INTO users (username, password_hash, role, is_test, email, is_email_verified, email_verification_token, email_verification_expires_at, vault_salt, wrapped_vault_key, recovery_wrapped_vault_key, recovery_verifier)
        VALUES (?, ?, 'user', 0, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanUsername,
        hashPassword(password),
        cleanEmail,
        shouldSendVerification ? 0 : 1,
        shouldSendVerification ? token : null,
        shouldSendVerification ? expiresAt : null,
        vaultSalt,
        wrappedVaultKey,
        recoveryWrappedVaultKey,
        recoveryVerifier,
      )

      const claimed = db.prepare(`
        UPDATE invitation_codes
        SET used_by_user_id = ?, used_at = datetime('now')
        WHERE id = ? AND used_by_user_id IS NULL
      `).run(result.lastInsertRowid, latest.invite.id)
      if (claimed.changes !== 1) throw new Error('Invite claim race')
      return { userId: result.lastInsertRowid as number }
    })()

    if ('error' in registration) return availabilityErrorResponse(registration.error)

    const proto = req.headers.get('x-forwarded-proto') || 'http'
    const host = req.headers.get('host') || 'localhost:3000'
    const appUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, '') || `${proto}://${host}`
    const verificationLink = `${appUrl}/api/auth/verify-email?token=${token}`

    let emailDelivered = false
    if (resendApiKey) {
      try {
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: `Kütüphane <${fromEmail}>`,
            to: [cleanEmail],
            subject: 'Kütüphane E-posta Doğrulama',
            html: `<p>Merhaba,</p><p>Kütüphaneye kayıt olduğunuz için teşekkürler. Hesabınızı doğrulamak ve etkinleştirmek için lütfen aşağıdaki bağlantıya tıklayın:</p><p><a href="${verificationLink}">${verificationLink}</a></p><p>Bu bağlantı 24 saat geçerlidir.</p>`,
          }),
        })
        if (!emailResponse.ok) throw new Error(`Resend returned ${emailResponse.status}`)
        emailDelivered = true
      } catch (err) {
        console.error('[Resend Error]', err)
      }
    }

    if (process.env.NODE_ENV !== 'production' && shouldSendVerification) {
      console.log(`[Email Verification Link for ${cleanUsername}]: ${verificationLink}`)
    }

    if (shouldSendVerification && !emailDelivered) {
      db.prepare(`
        UPDATE users
        SET is_email_verified = 1, email_verification_token = NULL, email_verification_expires_at = NULL
        WHERE id = ?
      `).run(registration.userId)
    }

    // Owner kitaplarini yeni kayit olan kullaniciya sifir ekstra disk alaniyla otomatik kopyala
    try {
      distributeOwnerBooksToUser(registration.userId)
    } catch (e) {
      console.error('[register] Failed to distribute owner books:', e)
    }

    return NextResponse.json({
      success: true,
      message: emailDelivered ? 'verification_sent' : 'account_ready',
      verificationLink: process.env.NODE_ENV !== 'production' && emailDelivered ? verificationLink : undefined,
    })
  } catch (err) {
    console.error('[register POST]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
