import { describe, it, expect, beforeAll } from 'vitest'

describe('sync database schema', () => {
  let db: import('better-sqlite3').Database

  beforeAll(async () => {
    db = new (await import('better-sqlite3')).default(':memory:')
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY,
        user_id INTEGER DEFAULT 1,
        title TEXT NOT NULL,
        author TEXT DEFAULT '',
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        last_page INTEGER DEFAULT 1,
        total_pages INTEGER DEFAULT 0,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY,
        user_id INTEGER DEFAULT 1,
        book_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '{}',
        page INTEGER NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY,
        user_id INTEGER DEFAULT 1,
        book_id INTEGER NOT NULL,
        page INTEGER NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS word_library (
        id INTEGER PRIMARY KEY,
        user_id INTEGER DEFAULT 1,
        word TEXT NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS reading_sessions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER DEFAULT 1,
        book_id INTEGER NOT NULL,
        duration_seconds INTEGER DEFAULT 0,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_devices (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        last_seen_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        last_sync_at TEXT NOT NULL,
        UNIQUE(user_id, device_id)
      );

      CREATE TABLE IF NOT EXISTS sync_deletions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        entity TEXT NOT NULL,
        row_id INTEGER NOT NULL,
        deleted_at TEXT DEFAULT (datetime('now'))
      );

      INSERT INTO users (id, username, password_hash) VALUES (1, 'testuser', 'hash');
    `)
  })

  it('sync_devices: insert and retrieve device', () => {
    db.prepare(`
      INSERT INTO sync_devices (user_id, device_id, device_name)
      VALUES (?, ?, ?)
    `).run(1, 'test-device-1', 'iPhone 15')

    const device = db.prepare('SELECT * FROM sync_devices WHERE device_id = ?').get('test-device-1') as Record<string, unknown>
    expect(device).toBeTruthy()
    expect(device.user_id).toBe(1)
    expect(device.device_name).toBe('iPhone 15')
    expect(typeof device.last_seen_at).toBe('string')
    expect(typeof device.created_at).toBe('string')
  })

  it('sync_checkpoints: upsert works', () => {
    db.prepare(`
      INSERT INTO sync_checkpoints (user_id, device_id, last_sync_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, device_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
    `).run(1, 'test-device-1', '2024-01-01T00:00:00.000Z')

    let cp = db.prepare('SELECT * FROM sync_checkpoints WHERE user_id = ? AND device_id = ?').get(1, 'test-device-1') as { last_sync_at: string }
    expect(cp.last_sync_at).toBe('2024-01-01T00:00:00.000Z')

    db.prepare(`
      INSERT INTO sync_checkpoints (user_id, device_id, last_sync_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, device_id) DO UPDATE SET last_sync_at = excluded.last_sync_at
    `).run(1, 'test-device-1', '2024-06-01T00:00:00.000Z')

    cp = db.prepare('SELECT * FROM sync_checkpoints WHERE user_id = ? AND device_id = ?').get(1, 'test-device-1') as { last_sync_at: string }
    expect(cp.last_sync_at).toBe('2024-06-01T00:00:00.000Z')
  })

  it('sync_deletions: records deletions correctly', () => {
    db.prepare('INSERT INTO sync_deletions (user_id, entity, row_id) VALUES (?, ?, ?)').run(1, 'annotation', 42)
    db.prepare('INSERT INTO sync_deletions (user_id, entity, row_id) VALUES (?, ?, ?)').run(1, 'bookmark', 7)

    const rows = db.prepare('SELECT * FROM sync_deletions WHERE user_id = ? ORDER BY id').all(1) as { entity: string; row_id: number; deleted_at: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0].entity).toBe('annotation')
    expect(rows[0].row_id).toBe(42)
    expect(rows[1].entity).toBe('bookmark')
    expect(rows[1].row_id).toBe(7)
  })

  it('sync_deletions: query by deleted_at range', () => {
    const now = new Date().toISOString()
    const rows = db.prepare(
      'SELECT * FROM sync_deletions WHERE user_id = ? AND deleted_at > ?'
    ).all(1, '2020-01-01T00:00:00.000Z') as { row_id: number }[]
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  it('books: updated_at can be set explicitly', () => {
    const now = new Date().toISOString()
    db.prepare('INSERT INTO books (user_id, title, filename, filepath, updated_at) VALUES (?, ?, ?, ?, ?)').run(1, 'Test Book', 'test.pdf', '/test.pdf', now)
    const book = db.prepare('SELECT updated_at FROM books WHERE title = ?').get('Test Book') as { updated_at: string }
    expect(book.updated_at).toBe(now)
    expect(new Date(book.updated_at).getTime()).not.toBeNaN()
  })

  it('books: updated_at changes on update', () => {
    const original = db.prepare('SELECT updated_at FROM books WHERE title = ?').get('Test Book') as { updated_at: string }
    const before = original.updated_at

    const afterNow = new Date().toISOString()
    db.prepare('UPDATE books SET title = ?, updated_at = ? WHERE title = ?').run('Test Book Updated', afterNow, 'Test Book')

    const updated = db.prepare('SELECT updated_at FROM books WHERE title = ?').get('Test Book Updated') as { updated_at: string }
    expect(updated.updated_at).toBe(afterNow)
    expect(afterNow >= before).toBe(true)
  })

  it('updated_at columns exist on all syncable tables', () => {
    const tableNames = ['books', 'annotations', 'bookmarks', 'word_library', 'reading_sessions']
    for (const table of tableNames) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      expect(columns.some(c => c.name === 'updated_at'), `Table ${table} missing updated_at`).toBe(true)
    }
  })

  it('sync_devices allows the same random device id for different users', () => {
    db.prepare("INSERT INTO users (id, username, password_hash) VALUES (2, 'other', 'hash')").run()
    expect(() => {
      db.prepare('INSERT INTO sync_devices (user_id, device_id, device_name) VALUES (?, ?, ?)').run(2, 'test-device-1', 'Other device')
    }).not.toThrow()
  })

  it('sync_devices unique constraint is scoped to the user', () => {
    expect(() => {
      db.prepare('INSERT INTO sync_devices (user_id, device_id, device_name) VALUES (?, ?, ?)').run(1, 'test-device-1', 'Duplicate')
    }).toThrow()
  })

  it('sync_checkpoints unique constraint on (user_id, device_id)', () => {
    expect(() => {
      db.prepare('INSERT INTO sync_checkpoints (user_id, device_id, last_sync_at) VALUES (?, ?, ?)').run(1, 'test-device-1', 'now')
    }).toThrow()
  })

  it('device registration: ON CONFLICT updates last_seen_at', () => {
    const oldVal = '2020-01-01T00:00:00.000Z'

    db.prepare('UPDATE sync_devices SET last_seen_at = ? WHERE device_id = ?').run(oldVal, 'test-device-1')

    db.prepare(`
      INSERT INTO sync_devices (user_id, device_id, device_name)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, device_id) DO UPDATE SET last_seen_at = datetime('now')
    `).run(1, 'test-device-1', 'iPhone 15')

    const device = db.prepare('SELECT last_seen_at FROM sync_devices WHERE device_id = ?').get('test-device-1') as { last_seen_at: string }
    expect(device.last_seen_at).not.toBe(oldVal)
  })
})
