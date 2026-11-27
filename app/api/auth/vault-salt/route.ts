import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import crypto from 'crypto'
import { checkRateLimit } from '@/lib/rateLimit'

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 'vault-salt', 20, 15 * 60 * 1000)
  if (limited) return limited
  const username = req.nextUrl.searchParams.get('username') || ''
  const cleanUsername = username.trim().toLowerCase()

  if (!cleanUsername) {
    return NextResponse.json({ error: 'Username is required' }, { status: 400 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = db.prepare('SELECT vault_salt FROM users WHERE username = ?').get(cleanUsername) as any

    if (user && user.vault_salt) {
      return NextResponse.json({ salt: user.vault_salt })
    }

    // Deterministic mock salt for non-existent users to prevent username enumeration
    const mockSalt = crypto.createHash('sha256').update(cleanUsername + '_mock_salt_secret').digest('hex').substring(0, 32)
    return NextResponse.json({ salt: mockSalt })
  } catch (error) {
    console.error('[vault-salt GET]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
