import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import type { SyncChange, SyncPullResponse, SyncEntity } from '@/lib/sync'
import { SYNC_TABLES, isSyncEntity } from '@/lib/sync'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const since = req.nextUrl.searchParams.get('since')
    const deviceId = req.nextUrl.searchParams.get('device_id')
    if (deviceId && deviceId.length > 128) {
      return NextResponse.json({ error: 'Invalid device_id' }, { status: 400 })
    }
    if (since && Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: 'Invalid since timestamp' }, { status: 400 })
    }
    const sinceDate = since || '1970-01-01T00:00:00.000Z'
    const serverTime = new Date().toISOString()

    const changes: SyncChange[] = []

    const syncableEntities = Object.keys(SYNC_TABLES) as SyncEntity[]
    for (const entity of syncableEntities) {
      const table = SYNC_TABLES[entity]
      let rows: Record<string, unknown>[]

      if (entity === 'book') {
        rows = db.prepare(
          `SELECT * FROM ${table} WHERE user_id = ? AND updated_at > ? AND updated_at <= ? ORDER BY updated_at ASC`
        ).all(user.id, sinceDate, serverTime) as Record<string, unknown>[]
      } else if (entity === 'annotation') {
        rows = db.prepare(`
          SELECT a.* FROM ${table} a
          JOIN books b ON a.book_id = b.id AND a.user_id = b.user_id
          WHERE a.user_id = ? AND a.updated_at > ? AND a.updated_at <= ?
            AND COALESCE(b.is_encrypted, 0) = 0
          ORDER BY a.updated_at ASC
        `).all(user.id, sinceDate, serverTime) as Record<string, unknown>[]
      } else if (entity === 'bookmark') {
        rows = db.prepare(`
          SELECT bm.* FROM ${table} bm
          JOIN books b ON bm.book_id = b.id AND bm.user_id = b.user_id
          WHERE bm.user_id = ? AND bm.updated_at > ? AND bm.updated_at <= ?
            AND COALESCE(b.is_encrypted, 0) = 0
          ORDER BY bm.updated_at ASC
        `).all(user.id, sinceDate, serverTime) as Record<string, unknown>[]
      } else if (entity === 'word') {
        rows = db.prepare(`
          SELECT w.* FROM ${table} w
          LEFT JOIN books b ON w.source_book_id = b.id AND w.user_id = b.user_id
          WHERE w.user_id = ? AND w.updated_at > ? AND w.updated_at <= ?
            AND COALESCE(b.is_encrypted, 0) = 0
          ORDER BY w.updated_at ASC
        `).all(user.id, sinceDate, serverTime) as Record<string, unknown>[]
      } else if (entity === 'session') {
        rows = db.prepare(`
          SELECT rs.* FROM ${table} rs
          JOIN books b ON rs.book_id = b.id AND rs.user_id = b.user_id
          WHERE rs.user_id = ? AND rs.updated_at > ? AND rs.updated_at <= ?
          ORDER BY rs.updated_at ASC
        `).all(user.id, sinceDate, serverTime) as Record<string, unknown>[]
      } else {
        continue
      }

      for (const row of rows) {
        changes.push({
          server_id: row.id as number,
          entity,
          action: 'upsert',
          data: row as Record<string, unknown>,
          updated_at: (row.updated_at as string) || new Date().toISOString(),
        })
      }
    }

    const deletionRows = db.prepare(
      `SELECT id, entity, row_id, deleted_at FROM sync_deletions
       WHERE user_id = ? AND deleted_at > ? AND deleted_at <= ?
       ORDER BY deleted_at ASC`
    ).all(user.id, sinceDate, serverTime) as { id: number; entity: string; row_id: number; deleted_at: string }[]

    const deleted = deletionRows
      .filter((r): r is typeof r & { entity: SyncEntity } => isSyncEntity(r.entity))
      .map(r => ({ entity: r.entity as SyncEntity, id: r.row_id }))

    if (deviceId) {
      db.prepare(`
        INSERT INTO sync_checkpoints (user_id, device_id, last_sync_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, device_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
      `).run(user.id, deviceId, serverTime)
    }

    return NextResponse.json<SyncPullResponse>({
      changes,
      deleted,
      server_time: serverTime,
    })
  } catch (err) {
    console.error('[sync/pull]', err)
    return NextResponse.json({ error: 'Sync error' }, { status: 500 })
  }
}
