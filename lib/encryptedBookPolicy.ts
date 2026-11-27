import { NextResponse } from 'next/server'
import db from './db'

export type OwnedBookProtection = 'missing' | 'plain' | 'encrypted'

/**
 * Returns the protection state only when the requested book belongs to the user.
 * Keeping ownership and encryption in one lookup avoids probing another user's
 * book state and prevents routes from accidentally checking encryption globally.
 */
export function getOwnedBookProtection(userId: number, bookId: unknown): OwnedBookProtection {
  const row = db.prepare(
    'SELECT COALESCE(is_encrypted, 0) AS is_encrypted FROM books WHERE id = ? AND user_id = ?'
  ).get(bookId, userId) as { is_encrypted: number } | undefined

  if (!row) return 'missing'
  return row.is_encrypted ? 'encrypted' : 'plain'
}

export function encryptedBookLocalOnlyResponse() {
  return NextResponse.json(
    {
      error: 'Encrypted book derived data is local-only',
      code: 'ENCRYPTED_BOOK_LOCAL_ONLY',
    },
    {
      status: 409,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
