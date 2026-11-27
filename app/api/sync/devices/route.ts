import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import type { SyncDevice } from '@/lib/sync'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const devices = db.prepare(
      'SELECT * FROM sync_devices WHERE user_id = ? ORDER BY last_seen_at DESC'
    ).all(user.id) as SyncDevice[]
    return NextResponse.json(devices)
  } catch (err) {
    console.error('[sync/devices GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const body = await req.json()
    const { device_id, device_name } = body
    if (typeof device_id !== 'string' || !device_id.trim() || device_id.length > 128 ||
        typeof device_name !== 'string' || !device_name.trim() || device_name.length > 80) {
      return NextResponse.json({ error: 'device_id and device_name required' }, { status: 400 })
    }

    db.prepare(`
      INSERT INTO sync_devices (user_id, device_id, device_name, last_seen_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, device_id) DO UPDATE SET
        device_name = excluded.device_name,
        last_seen_at = datetime('now')
    `).run(user.id, device_id, device_name.trim())

    const row = db.prepare('SELECT * FROM sync_devices WHERE user_id = ? AND device_id = ?').get(user.id, device_id) as SyncDevice
    return NextResponse.json(row)
  } catch (err) {
    console.error('[sync/devices POST]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const device_id = req.nextUrl.searchParams.get('device_id')
  if (!device_id) return NextResponse.json({ error: 'device_id required' }, { status: 400 })

  try {
    db.prepare('DELETE FROM sync_devices WHERE device_id = ? AND user_id = ?').run(device_id, user.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[sync/devices DELETE]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
