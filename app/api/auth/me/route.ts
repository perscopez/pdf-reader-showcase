import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import db from '@/lib/db'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  // Query salt and wrapped key directly for the logged-in user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbUser = db.prepare('SELECT vault_salt, wrapped_vault_key FROM users WHERE id = ?').get(user.id) as any

  return NextResponse.json({
    id: user.id,
    username: user.username,
    role: user.role,
    is_test: Boolean(user.is_test),
    avatar: user.avatar || '',
    vaultSalt: dbUser?.vault_salt || '',
    wrappedVaultKey: dbUser?.wrapped_vault_key || '',
  })
}
