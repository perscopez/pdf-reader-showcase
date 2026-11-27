import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser, userOwnsBook } from '@/lib/auth'
import type { SyncChange, SyncPushResponse, SyncEntity } from '@/lib/sync'
import { SYNC_TABLES } from '@/lib/sync'
import { ensureBookCategoryByName, setBookCategoryAssignments } from '@/lib/bookCategories'
import { getOwnedBookProtection } from '@/lib/encryptedBookPolicy'

const ALLOWED_FIELDS: Record<SyncEntity, readonly string[]> = {
  book: ['title', 'author', 'last_page', 'total_pages', 'favorite', 'category', 'category_ids', 'tags', 'status', 'last_opened_at', 'total_reading_time', 'wrapped_fek', 'is_encrypted', 'encrypted_metadata'],
  annotation: ['book_id', 'type', 'content', 'page', 'is_encrypted', 'encrypted_data'],
  bookmark: ['book_id', 'page', 'label', 'is_encrypted', 'encrypted_data'],
  word: ['word', 'definition', 'context', 'source_book_id', 'source_page', 'is_encrypted', 'encrypted_data'],
  session: ['book_id', 'start_page', 'end_page', 'pages_read', 'duration_seconds', 'started_at', 'ended_at', 'is_encrypted', 'encrypted_data'],
}

function syncNow() {
  return new Date().toISOString()
}

function validChange(value: unknown): value is SyncChange {
  if (!value || typeof value !== 'object') return false
  const change = value as Partial<SyncChange>
  return Boolean(
    change.entity && change.entity in SYNC_TABLES &&
    (change.action === 'upsert' || change.action === 'delete') &&
    change.data && typeof change.data === 'object' && !Array.isArray(change.data) &&
    typeof change.updated_at === 'string' && !Number.isNaN(Date.parse(change.updated_at)) &&
    (change.server_id === undefined || (Number.isInteger(change.server_id) && change.server_id > 0)) &&
    (change.local_id === undefined || (Number.isInteger(change.local_id) && change.local_id > 0))
  )
}

function leaksEncryptedBookPlaintext(userId: number, change: SyncChange) {
  if (change.action !== 'upsert') return false
  const bookId = change.entity === 'word'
    ? change.data.source_book_id
    : change.data.book_id
  if (!bookId || getOwnedBookProtection(userId, bookId) !== 'encrypted') return false

  // The current web clients use device-local stores for encrypted derivatives.
  // Until ciphertext sync is implemented end-to-end, fail closed instead of
  // trusting client-supplied is_encrypted flags around a plaintext payload.
  return ['annotation', 'bookmark', 'word'].includes(change.entity)
}

function processUpsert(userId: number, change: SyncChange, userOwns: (id: number, bookId: unknown) => boolean): { server_id: number } | null {
  const table = SYNC_TABLES[change.entity]
  if (!table) return null

  const now = syncNow()
  const allowed = ALLOWED_FIELDS[change.entity]
  const fields = allowed.filter(key => change.data[key] !== undefined)

  if (change.entity === 'book') {
    if (change.server_id) {
      const existing = db.prepare(`SELECT id, updated_at FROM ${table} WHERE id = ? AND user_id = ?`).get(change.server_id, userId) as { id: number; updated_at: string } | undefined
      if (!existing) return null
      if (existing && existing.updated_at >= change.updated_at) return { server_id: existing.id }
      const bookFields = fields.filter(key => key !== 'category_ids')
      const assignments = bookFields.map(k => `${k} = ?`).join(', ')
      const values = bookFields.map(k => change.data[k])
      if (assignments) {
        db.prepare(`UPDATE ${table} SET ${assignments}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...values, now, change.server_id, userId)
      }
      if (change.data.category_ids !== undefined) {
        try {
          setBookCategoryAssignments(userId, change.server_id, change.data.category_ids)
        } catch {
          return null
        }
      } else if (change.data.category !== undefined) {
        try {
          const categoryId = ensureBookCategoryByName(userId, change.data.category)
          setBookCategoryAssignments(userId, change.server_id, categoryId ? [categoryId] : [])
        } catch {
          return null
        }
      }
      return { server_id: change.server_id }
    }
    return null
  }

  if (change.entity === 'annotation' || change.entity === 'bookmark') {
    if (!userOwns(userId, change.data.book_id)) return null
  }
  if (change.entity === 'word' && change.data.source_book_id) {
    if (!userOwns(userId, change.data.source_book_id)) return null
  }
  if (change.entity === 'session') {
    if (!userOwns(userId, change.data.book_id)) return null
  }

  if (change.server_id) {
    const existing = db.prepare(`SELECT id, updated_at FROM ${table} WHERE id = ? AND user_id = ?`).get(change.server_id, userId) as { id: number; updated_at: string } | undefined
    if (!existing) return null
    if (existing && existing.updated_at >= change.updated_at) return { server_id: existing.id }
    const setClauses = fields.map(k => `${k} = ?`).join(', ')
    const values = fields.map(k => change.data[k])
    if (setClauses) {
      db.prepare(`UPDATE ${table} SET ${setClauses}, updated_at = ? WHERE id = ? AND user_id = ?`).run(...values, now, change.server_id, userId)
    }
    return { server_id: change.server_id }
  }

  const cols = fields
  if (!cols.length) return null
  const placeholders = cols.map(() => '?').join(', ')
  const values = cols.map(k => change.data[k])
  const result = db.prepare(
    `INSERT INTO ${table} (user_id, ${cols.join(', ')}, updated_at) VALUES (?, ${placeholders}, ?)`
  ).run(userId, ...values, now)
  return { server_id: Number(result.lastInsertRowid) }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const body: { device_id?: string; changes: SyncChange[] } = await req.json()
    if (!Array.isArray(body.changes) || body.changes.length > 500 || !body.changes.every(validChange)) {
      return NextResponse.json({ error: 'changes array required' }, { status: 400 })
    }
    if (body.device_id !== undefined && (typeof body.device_id !== 'string' || !body.device_id.trim() || body.device_id.length > 128)) {
      return NextResponse.json({ error: 'Invalid device_id' }, { status: 400 })
    }
    if (body.changes.some(change => leaksEncryptedBookPlaintext(user.id, change))) {
      return NextResponse.json(
        { error: 'Encrypted book derived data is local-only', code: 'ENCRYPTED_BOOK_LOCAL_ONLY' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    if (body.device_id) {
      db.prepare(`
        INSERT INTO sync_devices (user_id, device_id, device_name, last_seen_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, device_id) DO UPDATE SET last_seen_at = datetime('now')
      `).run(user.id, body.device_id, 'Book Reader')
    }

    const results = db.transaction(() => {
      return body.changes.map(change => {
        if (change.action === 'delete' && change.server_id) {
          if (change.entity === 'book') {
            return { server_id: 0, entity: change.entity, local_id: change.local_id }
          }
          const table = SYNC_TABLES[change.entity]
          if (table) {
            const result = db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(change.server_id, user.id)
            if (!result.changes) return { server_id: 0, entity: change.entity, local_id: change.local_id }
            db.prepare(`INSERT INTO sync_deletions (user_id, entity, row_id, deleted_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(user.id, change.entity, change.server_id)
          }
          return { server_id: change.server_id, entity: change.entity, local_id: change.local_id }
        }
        const owned = userOwnsBook as (id: number, bookId: unknown) => boolean
        const result = processUpsert(user.id, change, owned)
        if (result) {
          return { ...result, entity: change.entity, local_id: change.local_id }
        }
        return { server_id: 0, entity: change.entity, local_id: change.local_id }
      })
    })() as { server_id: number; entity: SyncEntity; local_id?: number }[]

    if (body.device_id) {
      db.prepare(`
        INSERT INTO sync_checkpoints (user_id, device_id, last_sync_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, device_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
      `).run(user.id, body.device_id, new Date().toISOString())
    }

    return NextResponse.json<SyncPushResponse>({ results })
  } catch (err) {
    console.error('[sync/push]', err)
    return NextResponse.json({ error: 'Sync error' }, { status: 500 })
  }
}
