import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid_token', req.url))
  }

  try {
    const user = db.prepare(`
      SELECT id, email_verification_expires_at
      FROM users
      WHERE email_verification_token = ?
    `).get(token) as { id: number; email_verification_expires_at: string } | undefined

    if (!user) {
      return NextResponse.redirect(new URL('/login?error=invalid_token', req.url))
    }

    const expires = new Date(user.email_verification_expires_at).getTime()
    if (expires < Date.now()) {
      return NextResponse.redirect(new URL('/login?error=token_expired', req.url))
    }

    // Mark as verified
    db.prepare(`
      UPDATE users
      SET is_email_verified = 1, email_verification_token = NULL, email_verification_expires_at = NULL
      WHERE id = ?
    `).run(user.id)

    return NextResponse.redirect(new URL('/login?verified=true', req.url))
  } catch (err) {
    console.error('[verify-email GET]', err)
    return NextResponse.redirect(new URL('/login?error=server_error', req.url))
  }
}
