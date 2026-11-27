import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import db from '@/lib/db'
import { checkRateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'auth-resend-verification', 5, 60 * 60 * 1000)
  if (limited) return limited

  try {
    const resendApiKey = process.env.RESEND_API_KEY?.trim()
    if (process.env.NODE_ENV === 'production' && !resendApiKey) {
      return NextResponse.json({ error: 'verification_temporarily_unavailable' }, { status: 503 })
    }
    const { email } = await req.json().catch(() => ({ email: '' }))

    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const cleanEmail = email.trim().toLowerCase()
    const user = db.prepare(`
      SELECT id, username, is_email_verified FROM users WHERE email = ?
    `).get(cleanEmail) as { id: number; username: string; is_email_verified: number } | undefined

    if (!user) {
      // Return success even if user not found to prevent email enumeration
      return NextResponse.json({ success: true, message: 'verification_sent' })
    }

    if (user.is_email_verified) {
      return NextResponse.json({ error: 'already_verified' }, { status: 400 })
    }

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    db.prepare(`
      UPDATE users
      SET email_verification_token = ?, email_verification_expires_at = ?
      WHERE id = ?
    `).run(token, expiresAt, user.id)

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

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Email Verification Link for ${user.username} (Resent)]: ${verificationLink}`)
    }

    if (process.env.NODE_ENV === 'production' && !emailDelivered) {
      return NextResponse.json({ error: 'verification_delivery_failed' }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      message: 'verification_sent',
      verificationLink: !resendApiKey ? verificationLink : undefined,
    })
  } catch (err) {
    console.error('[resend-verification POST]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
