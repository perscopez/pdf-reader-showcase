import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { purgeExpiredTrash } from '@/lib/trash'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    await purgeExpiredTrash(user.id)
    const items = db.prepare(`
      SELECT id, item_type, item_id, data_json, deleted_at,
        datetime(deleted_at, '+30 days') AS expires_at
      FROM trash_items WHERE user_id = ? ORDER BY deleted_at DESC, id DESC
    `).all(user.id)
    return NextResponse.json({ items })
  } catch (error) {
    console.error('[trash GET]', error)
    return NextResponse.json({ error: 'Trash could not be loaded' }, { status: 500 })
  }
}
