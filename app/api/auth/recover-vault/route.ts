import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { checkRateLimit } from '@/lib/rateLimit'
import { cleanText } from '@/lib/text'
import { timingSafeEqual } from 'crypto'

/**
 * GET  — Return the recovery_wrapped_vault_key for a given username.
 *         Client uses this to unwrap the vault key with their recovery phrase.
 *
 * POST — Validate username exists and return the recovery_wrapped_vault_key
 *         so the client can unwrap the vault key with the recovery phrase.
 *
 * PATCH — Accept the new password + new vault keys (all key operations happened client-side).
 *          Update password_hash, vault_salt, wrapped_vault_key, recovery_wrapped_vault_key.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserRow = { id: number; vault_salt: string | null; recovery_wrapped_vault_key: string | null } | any

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'recover-vault', 5, 15 * 60 * 1000)
  if (limited) return limited

  try {
    const { username } = await req.json().catch(() => ({ username: '' }))
    const cleanUsername = cleanText(username || '').trim().toLowerCase()

    if (!cleanUsername) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 })
    }

    const user = db.prepare(
      'SELECT id, vault_salt, recovery_wrapped_vault_key FROM users WHERE username = ?'
    ).get(cleanUsername) as UserRow

    if (!user || !user.recovery_wrapped_vault_key) {
      // Don't reveal whether user exists
      return NextResponse.json({ error: 'Recovery not available for this account' }, { status: 404 })
    }

    return NextResponse.json({
      vaultSalt: user.vault_salt,
      recoveryWrappedVaultKey: user.recovery_wrapped_vault_key,
    })
  } catch (err) {
    console.error('[recover-vault POST]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const limited = checkRateLimit(req, 'recover-vault-patch', 5, 15 * 60 * 1000)
  if (limited) return limited

  try {
    const {
      username,
      newPassword,
      newVaultSalt,
      newWrappedVaultKey,
      newRecoveryWrappedVaultKey,
      recoveryVerifier,
    } = await req.json().catch(() => ({}))

    const cleanUsername = cleanText(username || '').trim().toLowerCase()

    if (
      !cleanUsername ||
      typeof newPassword !== 'string' ||
      newPassword.length < 8 ||
      !newVaultSalt ||
      !newWrappedVaultKey ||
      !newRecoveryWrappedVaultKey ||
      typeof recoveryVerifier !== 'string' ||
      !/^[a-f0-9]{64}$/.test(recoveryVerifier)
    ) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const user = db.prepare('SELECT id, recovery_verifier FROM users WHERE username = ?').get(cleanUsername) as { id: number; recovery_verifier: string | null } | undefined
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (!user.recovery_verifier) {
      return NextResponse.json({ error: 'recovery_not_enrolled' }, { status: 409 })
    }
    const expected = Buffer.from(user.recovery_verifier, 'hex')
    const received = Buffer.from(recoveryVerifier, 'hex')
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return NextResponse.json({ error: 'Invalid recovery code' }, { status: 403 })
    }

    // Update password hash and vault keys
    db.prepare(`
      UPDATE users
      SET password_hash = ?, vault_salt = ?, wrapped_vault_key = ?, recovery_wrapped_vault_key = ?, session_version = COALESCE(session_version, 0) + 1
      WHERE id = ?
    `).run(hashPassword(newPassword), newVaultSalt, newWrappedVaultKey, newRecoveryWrappedVaultKey, user.id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[recover-vault PATCH]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
