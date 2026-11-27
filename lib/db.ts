/* eslint-disable @typescript-eslint/no-require-imports */
import Database from 'better-sqlite3'
import path from 'path'
import fs, { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { cleanText } from './text'
import { hashPassword } from './password'
import { migrateAudioNotesSchema, migrateBookPagesUniqueness, migrateReadingGroupsSchema, migrateResearchNotebooksSchema } from './dbMigrations'

const dataDir = path.join(process.cwd(), 'data')
mkdirSync(dataDir, { recursive: true })

// === BOOT GUARD (data-loss protection) ===
// Opt-in: if BACKUP_RESTORE_DIR is set and the database is missing/empty, restore the
// newest `pdf-library-*.tar.gz` archive from that directory before opening SQLite.
if (process.env.NEXT_PHASE !== 'phase-production-build' && process.env.BACKUP_RESTORE_DIR) {
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    const os = require('os') as typeof import('os')
    const backupDir = process.env.BACKUP_RESTORE_DIR
    const dbFile = path.join(dataDir, 'library.db')
    const ok = fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0
    if (!ok && fs.existsSync(backupDir)) {
      const archives = readdirSync(backupDir)
        .filter(f => /^pdf-library-[\w.-]+\.tar\.gz$/.test(f))
        .map(f => path.join(backupDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      if (archives.length) {
        console.error('[db-guard] library.db missing or empty, restoring from', archives[0])
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-guard-'))
        try {
          execFileSync('tar', ['-xzf', archives[0], '-C', tmp])
          fs.copyFileSync(path.join(tmp, 'data', 'library.db'), dbFile)
          const uploadsSrc = path.join(tmp, 'public', 'uploads')
          if (fs.existsSync(uploadsSrc)) {
            fs.cpSync(uploadsSrc, path.join(process.cwd(), 'public', 'uploads'), { recursive: true })
          }
          console.error('[db-guard] restore complete.')
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true })
        }
      }
    }
  } catch (e) { console.error('[db-guard] warning:', e instanceof Error ? e.message : e) }
}
// === /BOOT GUARD ===

const db = new Database(path.join(dataDir, 'library.db'))

try {
  db.pragma('journal_mode = WAL')
} catch {
  try {
    db.pragma('journal_mode = DELETE')
  } catch {
    // Keep SQLite's current journal mode when neither pragma is supported.
  }
}
db.pragma('busy_timeout = 10000')
db.pragma('foreign_keys = ON')

if (process.env.NEXT_PHASE !== 'phase-production-build') {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    is_test INTEGER DEFAULT 0,
    email TEXT,
    is_email_verified INTEGER DEFAULT 0,
    email_verification_token TEXT,
    email_verification_expires_at TEXT,
    deleted_at TEXT,
    vault_salt TEXT,
    wrapped_vault_key TEXT,
    recovery_wrapped_vault_key TEXT,
    recovery_verifier TEXT,
    session_version INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
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
    favorite INTEGER DEFAULT 0,
    category TEXT DEFAULT '',
    category_ids TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'reading',
    last_opened_at TEXT,
    wrapped_fek TEXT,
    is_encrypted INTEGER DEFAULT 0,
    encrypted_metadata TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER DEFAULT 1,
    book_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '{}',
    page INTEGER NOT NULL,
    is_encrypted INTEGER DEFAULT 0,
    encrypted_data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS annotation_categories (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#e50914',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_annotation_categories_user_position
    ON annotation_categories(user_id, position, id);

  CREATE TABLE IF NOT EXISTS book_categories (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#e50914',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_book_categories_user_position
    ON book_categories(user_id, position, id);

  CREATE TABLE IF NOT EXISTS book_category_assignments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, category_id, book_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(category_id) REFERENCES book_categories(id) ON DELETE CASCADE,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_book_category_assignments_category
    ON book_category_assignments(user_id, category_id, book_id);
  CREATE INDEX IF NOT EXISTS idx_book_category_assignments_book
    ON book_category_assignments(user_id, book_id, category_id);

  CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER DEFAULT 1,
    book_id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    label TEXT,
    is_encrypted INTEGER DEFAULT 0,
    encrypted_data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS word_library (
    id INTEGER PRIMARY KEY,
    user_id INTEGER DEFAULT 1,
    word TEXT NOT NULL,
    definition TEXT DEFAULT '',
    context TEXT DEFAULT '',
    source_book_id INTEGER,
    source_page INTEGER,
    mastery INTEGER DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    last_reviewed_at TEXT,
    is_encrypted INTEGER DEFAULT 0,
    encrypted_data TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reading_sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER DEFAULT 1,
    book_id INTEGER NOT NULL,
    start_page INTEGER DEFAULT 1,
    end_page INTEGER DEFAULT 1,
    pages_read INTEGER DEFAULT 1,
    duration_seconds INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT DEFAULT (datetime('now')),
    is_encrypted INTEGER DEFAULT 0,
    encrypted_data TEXT
  );

  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    page_url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS book_pages (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS invitation_codes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    used_by_user_id INTEGER,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS daily_usage (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    usage_date TEXT NOT NULL,
    ai_requests_count INTEGER DEFAULT 0,
    tts_duration_seconds REAL DEFAULT 0.0,
    UNIQUE(user_id, usage_date),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`)

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

db.transaction(() => {
  ensureColumn('users', 'role', "TEXT DEFAULT 'user'")
  ensureColumn('users', 'is_test', 'INTEGER DEFAULT 0')
  ensureColumn('users', 'created_at', "TEXT DEFAULT (datetime('now'))")
  ensureColumn('users', 'avatar', "TEXT DEFAULT ''")
  ensureColumn('users', 'email', "TEXT")
  ensureColumn('users', 'is_email_verified', "INTEGER DEFAULT 0")
  ensureColumn('users', 'email_verification_token', "TEXT")
  ensureColumn('users', 'email_verification_expires_at', "TEXT")
  ensureColumn('users', 'deleted_at', "TEXT")

  // E-postasi olmayan veya bos olan hesaplarda e-posta dogrulama kilidini otomatik kaldir
  try {
    db.prepare("UPDATE users SET is_email_verified = 1 WHERE email IS NULL OR TRIM(COALESCE(email, '')) = ''").run()
  } catch {
    // Ignore concurrency locks
  }
  ensureColumn('books', 'user_id', 'INTEGER DEFAULT 1')
  ensureColumn('books', 'favorite', 'INTEGER DEFAULT 0')
  ensureColumn('books', 'category', "TEXT DEFAULT ''")
  ensureColumn('books', 'tags', "TEXT DEFAULT '[]'")
  ensureColumn('books', 'status', "TEXT DEFAULT 'reading'")
  ensureColumn('books', 'last_opened_at', 'TEXT')
  ensureColumn('books', 'total_reading_time', 'INTEGER DEFAULT 0')
  ensureColumn('books', 'thumbnail', 'TEXT')
  ensureColumn('books', 'text_extraction_version', 'INTEGER DEFAULT 0')
  ensureColumn('books', 'file_revision', 'TEXT')
  ensureColumn('annotations', 'user_id', 'INTEGER DEFAULT 1')
  ensureColumn('annotations', 'created_at', "TEXT DEFAULT (datetime('now'))")
  ensureColumn('bookmarks', 'user_id', 'INTEGER DEFAULT 1')
  ensureColumn('bookmarks', 'created_at', "TEXT DEFAULT (datetime('now'))")
  ensureColumn('word_library', 'user_id', 'INTEGER DEFAULT 1')
  ensureColumn('word_library', 'mastery', 'INTEGER DEFAULT 0')
  ensureColumn('word_library', 'review_count', 'INTEGER DEFAULT 0')
  ensureColumn('word_library', 'last_reviewed_at', 'TEXT')
  ensureColumn('reading_sessions', 'user_id', 'INTEGER DEFAULT 1')
  ensureColumn('reading_sessions', 'start_page', 'INTEGER DEFAULT 1')
  ensureColumn('reading_sessions', 'end_page', 'INTEGER DEFAULT 1')
  ensureColumn('bug_reports', 'resolved', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('bug_reports', 'resolved_at', 'TEXT')
  ensureColumn('bug_reports', 'resolved_by_user_id', 'INTEGER')
  ensureColumn('reading_sessions', 'pages_read', 'INTEGER DEFAULT 1')
  ensureColumn('reading_sessions', 'duration_seconds', 'INTEGER DEFAULT 0')
  ensureColumn('reading_sessions', 'started_at', "TEXT DEFAULT (datetime('now'))")
  ensureColumn('reading_sessions', 'ended_at', "TEXT DEFAULT (datetime('now'))")
  ensureColumn('book_pages', 'layout_json', 'TEXT')
  ensureColumn('book_pages', 'extraction_version', 'INTEGER DEFAULT 0')
  ensureColumn('book_pages', 'file_revision', 'TEXT')
  // E2EE Columns
  ensureColumn('users', 'vault_salt', 'TEXT')
  ensureColumn('users', 'wrapped_vault_key', 'TEXT')
  ensureColumn('users', 'recovery_wrapped_vault_key', 'TEXT')
  ensureColumn('users', 'recovery_verifier', 'TEXT')
  ensureColumn('users', 'session_version', 'INTEGER DEFAULT 0')
  ensureColumn('books', 'wrapped_fek', 'TEXT')
  ensureColumn('books', 'import_source', 'TEXT')
  ensureColumn('books', 'import_source_id', 'TEXT')
  ensureColumn('books', 'is_encrypted', 'INTEGER DEFAULT 0')
  ensureColumn('books', 'encrypted_metadata', 'TEXT')
  ensureColumn('annotations', 'is_encrypted', 'INTEGER DEFAULT 0')
  ensureColumn('annotations', 'encrypted_data', 'TEXT')
  ensureColumn('bookmarks', 'is_encrypted', 'INTEGER DEFAULT 0')
  ensureColumn('bookmarks', 'encrypted_data', 'TEXT')
  ensureColumn('word_library', 'is_encrypted', 'INTEGER DEFAULT 0')
  ensureColumn('word_library', 'encrypted_data', 'TEXT')
  ensureColumn('reading_sessions', 'is_encrypted', 'INTEGER DEFAULT 0')
  ensureColumn('reading_sessions', 'encrypted_data', 'TEXT')

  // Sync columns
  ensureColumn('books', 'updated_at', 'TEXT')
  ensureColumn('books', 'category_ids', "TEXT DEFAULT '[]'")
  ensureColumn('books', 'rating', 'INTEGER DEFAULT 0')
  ensureColumn('books', 'description', "TEXT DEFAULT ''")
  ensureColumn('books', 'isbn', "TEXT DEFAULT ''")
  ensureColumn('books', 'doi', "TEXT DEFAULT ''")
  ensureColumn('books', 'publication_year', 'INTEGER')
  ensureColumn('books', 'publisher', "TEXT DEFAULT ''")
  ensureColumn('books', 'publication', "TEXT DEFAULT ''")
  ensureColumn('books', 'volume', "TEXT DEFAULT ''")
  ensureColumn('books', 'issue', "TEXT DEFAULT ''")
  ensureColumn('books', 'pages', "TEXT DEFAULT ''")
  ensureColumn('books', 'edition', "TEXT DEFAULT ''")
  ensureColumn('books', 'language', "TEXT DEFAULT ''")
  ensureColumn('books', 'edition_group_id', "TEXT DEFAULT ''")
  ensureColumn('books', 'furthest_page', 'INTEGER DEFAULT 1')
  ensureColumn('books', 'rtl', 'INTEGER DEFAULT 0')
  ensureColumn('books', 'margin_crop', "TEXT DEFAULT '{}'")
  ensureColumn('annotations', 'style', "TEXT DEFAULT 'highlight'")
  ensureColumn('annotations', 'drawing_data', "TEXT DEFAULT ''")
  ensureColumn('annotations', 'color_meaning', "TEXT DEFAULT ''")
  ensureColumn('annotations', 'deleted_at', 'TEXT')
  ensureColumn('annotations', 'updated_at', 'TEXT')
  ensureColumn('bookmarks', 'updated_at', 'TEXT')
  ensureColumn('word_library', 'updated_at', 'TEXT')
  ensureColumn('reading_sessions', 'updated_at', 'TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS trash_items (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      deleted_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_trash_items_user_time
      ON trash_items(user_id, deleted_at);

    CREATE TABLE IF NOT EXISTS background_ocr_queue (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      current_page INTEGER DEFAULT 0,
      total_pages INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      job_type TEXT NOT NULL DEFAULT 'text_extraction',
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, book_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS page_text_models (
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      model_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'native',
      quality REAL NOT NULL DEFAULT 0,
      extraction_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(book_id, page_number),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_page_text_models_user_book
      ON page_text_models(user_id, book_id, page_number);
  `)

  ensureColumn('background_ocr_queue', 'job_type', "TEXT NOT NULL DEFAULT 'text_extraction'")
  ensureColumn('background_ocr_queue', 'attempts', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('background_ocr_queue', 'lease_owner', 'TEXT')
  ensureColumn('background_ocr_queue', 'lease_expires_at', 'TEXT')
  db.exec(`CREATE INDEX IF NOT EXISTS idx_background_text_extraction_claim
    ON background_ocr_queue(job_type, status, updated_at, id)`)

  const legacyCategoryBooks = db.prepare(`
    SELECT id, user_id, category FROM books
    WHERE TRIM(COALESCE(category, '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM book_category_assignments a
        WHERE a.user_id = books.user_id AND a.book_id = books.id
      )
  `).all() as { id: number; user_id: number; category: string }[]
  if (legacyCategoryBooks.length) {
    const findCategory = db.prepare('SELECT id FROM book_categories WHERE user_id = ? AND name = ? COLLATE NOCASE')
    const categoryCount = db.prepare('SELECT COUNT(*) count FROM book_categories WHERE user_id = ?')
    const insertCategory = db.prepare('INSERT INTO book_categories (user_id, name, color, position) VALUES (?, ?, ?, ?)')
    const insertAssignment = db.prepare('INSERT OR IGNORE INTO book_category_assignments (user_id, category_id, book_id) VALUES (?, ?, ?)')
    const updateBook = db.prepare('UPDATE books SET category_ids = ? WHERE id = ? AND user_id = ?')
    db.transaction(() => {
      for (const book of legacyCategoryBooks) {
        let category = findCategory.get(book.user_id, book.category) as { id: number } | undefined
        if (!category) {
          const count = (categoryCount.get(book.user_id) as { count: number }).count
          const result = insertCategory.run(book.user_id, book.category.trim().slice(0, 60), '#e50914', count)
          category = { id: Number(result.lastInsertRowid) }
        }
        insertAssignment.run(book.user_id, category.id, book.id)
        updateBook.run(JSON.stringify([category.id]), book.id, book.user_id)
      }
    })()
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_devices (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      last_seen_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, device_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sync_checkpoints (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      last_sync_at TEXT NOT NULL,
      UNIQUE(user_id, device_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sync_deletions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      entity TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      deleted_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sync_deletions_user_time
      ON sync_deletions(user_id, deleted_at);
  `)

  const deviceSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_devices'"
  ).get() as { sql?: string } | undefined
  if (deviceSchema?.sql?.includes('device_id TEXT NOT NULL UNIQUE')) {
    db.exec(`
      ALTER TABLE sync_devices RENAME TO sync_devices_legacy;
      CREATE TABLE sync_devices (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        last_seen_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, device_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO sync_devices (id, user_id, device_id, device_name, last_seen_at, created_at)
      SELECT id, user_id, device_id, device_name, last_seen_at, created_at FROM sync_devices_legacy;
      DROP TABLE sync_devices_legacy;
    `)
  }

  try {
    db.exec(`
      UPDATE sync_deletions
      SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', deleted_at)
      WHERE deleted_at NOT LIKE '____-__-__T%';
    `)

    const syncTables = ['books', 'annotations', 'bookmarks', 'word_library', 'reading_sessions']
    for (const table of syncTables) {
      db.exec(`
        UPDATE ${table}
        SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE updated_at IS NULL;
        UPDATE ${table}
        SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
        WHERE updated_at NOT LIKE '____-__-__T%';
        CREATE TRIGGER IF NOT EXISTS ${table}_sync_insert_timestamp
        AFTER INSERT ON ${table}
        WHEN NEW.updated_at IS NULL
        BEGIN
          UPDATE ${table}
          SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = NEW.id;
        END;
        CREATE TRIGGER IF NOT EXISTS ${table}_sync_update_timestamp
        AFTER UPDATE ON ${table}
        WHEN NEW.updated_at IS OLD.updated_at
        BEGIN
          UPDATE ${table}
          SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = NEW.id;
        END;
      `)
    }
  } catch {}
})()

migrateBookPagesUniqueness(db)
migrateReadingGroupsSchema(db)
migrateResearchNotebooksSchema(db)
migrateAudioNotesSchema(db)

const legacyFsrsColumns = [
  'fsrs_due',
  'fsrs_state',
  'fsrs_stability',
  'fsrs_difficulty',
  'fsrs_elapsed_days',
  'fsrs_scheduled_days',
  'fsrs_reps',
  'fsrs_lapses',
  'fsrs_learning_steps',
]
for (const column of legacyFsrsColumns) {
  try {
    db.exec(`ALTER TABLE word_library DROP COLUMN ${column}`)
  } catch {
    // Older SQLite versions can retain harmless legacy columns.
  }
}

function migrateDataImages(table: 'users' | 'books', column: 'avatar' | 'thumbnail', folder: 'avatars' | 'thumbnails') {
  const rows = db.prepare(`SELECT id, ${column} AS image FROM ${table} WHERE ${column} LIKE 'data:image/%'`).all() as { id: number; image: string }[]
  const imageTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
  const directory = path.join(process.cwd(), 'public', 'uploads', folder)
  mkdirSync(directory, { recursive: true })

  for (const row of rows) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(row.image)
    const extension = match ? imageTypes[match[1].toLowerCase()] : undefined
    if (!match || !extension) continue
    const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
    if (!data.length || data.length > 5 * 1024 * 1024) continue
    const filename = `${table === 'users' ? 'user' : 'book'}-${row.id}-migrated.${extension}`
    writeFileSync(path.join(directory, filename), data)
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(`/uploads/${folder}/${filename}`, row.id)
  }
}

migrateDataImages('users', 'avatar', 'avatars')
migrateDataImages('books', 'thumbnail', 'thumbnails')

function upsertUser(username: string, password: string, role: string, isTest: boolean, email: string) {
  const cleanUsername = cleanText(username).trim().toLowerCase()
  const passwordHash = hashPassword(password)

  db.prepare('INSERT OR IGNORE INTO users (username, password_hash, role, is_test, email, is_email_verified) VALUES (?, ?, ?, ?, ?, 1)')
    .run(cleanUsername, passwordHash, role, isTest ? 1 : 0, email)

  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername) as { id: number }
  db.prepare('UPDATE users SET password_hash = ?, role = ?, is_test = ?, email = ?, is_email_verified = 1, deleted_at = NULL WHERE id = ?')
    .run(passwordHash, role, isTest ? 1 : 0, email, user.id)
  return user.id
}

if (process.env.NODE_ENV === 'production') {
  const required = ['PDF_LIBRARY_PASSWORD', 'PDF_LIBRARY_SESSION_SECRET']
    .filter(key => !process.env[key]?.trim())
  if (required.length) throw new Error(`Missing required production configuration: ${required.join(', ')}`)
}

const ownerUsername = cleanText(process.env.PDF_LIBRARY_USERNAME || 'owner').trim().toLowerCase() || 'owner'
const ownerPassword = process.env.PDF_LIBRARY_PASSWORD?.trim() || randomBytes(24).toString('base64url')
const ownerUserId = upsertUser(ownerUsername, ownerPassword, 'admin', false, 'owner@kutuphane.local')
db.prepare("UPDATE users SET is_test = 0 WHERE role = 'admin'").run()
const configuredTestPassword = process.env.PDF_LIBRARY_TEST_PASSWORD?.trim()
let testUserId: number | null = null
const testAccountEnabled = process.env.NODE_ENV !== 'production' || (process.env.ENABLE_TEST_ACCOUNT === 'true' && configuredTestPassword)
if (testAccountEnabled) {
  testUserId = upsertUser('test', configuredTestPassword || 'test123', 'test', true, 'test@kutuphane.local')
} else {
  const disabledPassword = hashPassword(randomBytes(32).toString('base64url'))
  db.prepare(`
    UPDATE users
    SET password_hash = ?, is_email_verified = 0, deleted_at = COALESCE(deleted_at, datetime('now'))
    WHERE is_test = 1
  `).run(disabledPassword)
}

try {
  const defaultCodes = ['BETA-INVITE-1', 'BETA-INVITE-2', 'BETA-INVITE-3', 'BETA-INVITE-4', 'BETA-INVITE-5']
  if (process.env.NODE_ENV === 'production') {
    const placeholders = defaultCodes.map(() => '?').join(', ')
    db.prepare(`DELETE FROM invitation_codes WHERE used_by_user_id IS NULL AND code IN (${placeholders})`).run(...defaultCodes)
  } else {
    const count = db.prepare('SELECT COUNT(*) AS count FROM invitation_codes').get() as { count: number }
    if (count.count === 0) {
      const stmt = db.prepare('INSERT INTO invitation_codes (code) VALUES (?)')
      for (const code of defaultCodes) stmt.run(code)
      console.log('[db] Seeded development invitation codes')
    }
  }
} catch (e) {
  console.error('[db] Failed to seed invitation codes:', e)
}

db.transaction(() => {
  db.prepare('UPDATE books SET user_id = ? WHERE user_id IS NULL OR user_id <= 0').run(ownerUserId)
  db.prepare('UPDATE annotations SET user_id = ? WHERE user_id IS NULL OR user_id <= 0').run(ownerUserId)
  db.prepare('UPDATE bookmarks SET user_id = ? WHERE user_id IS NULL OR user_id <= 0').run(ownerUserId)
  db.prepare('UPDATE word_library SET user_id = ? WHERE user_id IS NULL OR user_id <= 0').run(ownerUserId)
  db.prepare('UPDATE reading_sessions SET user_id = ? WHERE user_id IS NULL OR user_id <= 0').run(ownerUserId)
})()

db.prepare("UPDATE books SET filepath = '/api/pdf/' || filename WHERE filepath LIKE '/uploads/%'").run()

// Only seed test books/files when a test user actually exists
if (testUserId) {
  try {
    const existingTestBooks = db.prepare('SELECT COUNT(*) AS count FROM books WHERE user_id = ?').get(testUserId) as { count: number }
    if (!existingTestBooks.count) {
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
      const files = readdirSync(uploadsDir).filter(f => /\.pdf$/i.test(f)).slice(0, 2)
      const insertBook = db.prepare(`
        INSERT INTO books (user_id, title, author, filename, filepath, category, tags, status, thumbnail)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertedBookIds: number[] = []

      for (const filename of files) {
        const source = db.prepare(`
          SELECT title, author, category, tags, thumbnail
          FROM books
          WHERE user_id = ? AND filename = ?
          LIMIT 1
        `).get(ownerUserId, filename) as {
          title: string
          author: string
          category: string
          tags: string
          thumbnail: string | null
        } | undefined
        const title = source?.title || cleanText(filename.replace(/^\d+-/, '').replace(/_/g, ' ').replace(/\.pdf$/i, ''))
        const result = insertBook.run(
          testUserId,
          title,
          source?.author || 'Demo',
          filename,
          `/api/pdf/${filename}`,
          source?.category || 'Demo',
          source?.tags || JSON.stringify(['sample', 'test']),
          'reading',
          source?.thumbnail || null
        )
        insertedBookIds.push(Number(result.lastInsertRowid))
      }

      const firstBookId = insertedBookIds[0] || null
      const insertWord = db.prepare(`
        INSERT INTO word_library (user_id, word, definition, context, source_book_id, source_page, mastery)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      ;[
        ['serendipity', 'A pleasant discovery made by chance.', 'A small word saved for testing the word library.'],
        ['resilience', 'The ability to recover and keep going after difficulty.', 'A sample English definition.'],
        ['merak', 'Bir şeyi anlama veya öğrenme isteği.', 'Örnek Türkçe kelime.'],
      ].forEach(([word, definition, context], index) => {
        insertWord.run(testUserId, word, definition, context, firstBookId, index + 1, index === 0 ? 1 : 0)
      })
    }
  } catch {
    // Demo seeding is best-effort; the real library must still boot.
  }
}

// Dedup: delete duplicate books keeping the lowest ID for each title+author+user_id
try {
  db.exec(`
    DELETE FROM books WHERE id NOT IN (
      SELECT MIN(id) FROM books GROUP BY user_id, LOWER(TRIM(title)), LOWER(TRIM(author))
    )
  `)
} catch {
  // best-effort cleanup
}

}

export function purgeExpiredDeletedAccounts() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  try {
    const expiredUsers = db.prepare(`
      SELECT id, avatar FROM users
      WHERE deleted_at IS NOT NULL AND datetime(deleted_at) <= datetime('now', '-7 days')
    `).all() as { id: number; avatar: string | null }[]

    if (expiredUsers.length === 0) return

    console.log(`[db-purge] Found ${expiredUsers.length} expired accounts to delete permanently.`);

    for (const user of expiredUsers) {
      const userBooks = db.prepare('SELECT filename, thumbnail FROM books WHERE user_id = ?').all(user.id) as { filename: string; thumbnail: string | null }[]
      const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
      const audioDir = path.join(uploadsDir, 'audio-notes', String(user.id))

      for (const book of userBooks) {
        if (book.filename) {
          const filePath = path.join(uploadsDir, book.filename)
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath)
              console.log(`[db-purge] Deleted book file: ${filePath}`)
            } catch (err) {
              console.error(`[db-purge] Failed to delete book file ${filePath}:`, err)
            }
          }
        }
        if (book.thumbnail && book.thumbnail.startsWith('/uploads/thumbnails/')) {
          const thumbPath = path.join(process.cwd(), 'public', book.thumbnail)
          if (fs.existsSync(thumbPath)) {
            try {
              fs.unlinkSync(thumbPath)
              console.log(`[db-purge] Deleted thumbnail file: ${thumbPath}`)
            } catch (err) {
              console.error(`[db-purge] Failed to delete thumbnail file ${thumbPath}:`, err)
            }
          }
        }
      }

      if (user.avatar && user.avatar.startsWith('/uploads/avatars/')) {
        const avatarPath = path.join(process.cwd(), 'public', user.avatar)
        if (fs.existsSync(avatarPath)) {
          try {
            fs.unlinkSync(avatarPath)
            console.log(`[db-purge] Deleted avatar file: ${avatarPath}`)
          } catch (err) {
            console.error(`[db-purge] Failed to delete avatar file ${avatarPath}:`, err)
          }
        }
      }

      if (fs.existsSync(audioDir)) {
        try {
          fs.rmSync(audioDir, { recursive: true, force: true })
          console.log(`[db-purge] Deleted audio notes directory: ${audioDir}`)
        } catch (err) {
          console.error(`[db-purge] Failed to delete audio notes directory ${audioDir}:`, err)
        }
      }

      db.transaction(() => {
        db.prepare('DELETE FROM book_pages WHERE book_id IN (SELECT id FROM books WHERE user_id = ?)').run(user.id)
        db.prepare('DELETE FROM books WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM annotations WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM word_library WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM reading_sessions WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM audio_note_sessions WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM bug_reports WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM daily_usage WHERE user_id = ?').run(user.id)
        db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
      })()

      console.log(`[db-purge] Permanently deleted user ID ${user.id} and all associated data.`);
    }
  } catch (err) {
    console.error('[db-purge] Error running expired accounts purge:', err)
  }
}

export function distributeOwnerBooksToUser(targetUserId: number): number {
  const owner = db.prepare("SELECT id FROM users WHERE username = 'owner' ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined
  if (!owner || owner.id === targetUserId) return 0

  const ownerBooks = db.prepare(`
    SELECT title, author, filename, filepath, total_pages, category, category_ids, tags, wrapped_fek, is_encrypted, thumbnail
    FROM books
    WHERE user_id = ?
  `).all(owner.id) as {
    title: string
    author: string
    filename: string
    filepath: string
    total_pages: number
    category: string
    category_ids: string
    tags: string
    wrapped_fek: string | null
    is_encrypted: number
    thumbnail: string | null
  }[]

  if (ownerBooks.length === 0) return 0

  let clonedCount = 0

  const checkStmt = db.prepare('SELECT id FROM books WHERE user_id = ? AND (filepath = ? OR title = ?)')
  const insertStmt = db.prepare(`
    INSERT INTO books (
      user_id, title, author, filename, filepath, total_pages, category, category_ids, tags, wrapped_fek, is_encrypted, thumbnail, last_page, favorite, status
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'reading'
    )
  `)

  db.transaction(() => {
    for (const b of ownerBooks) {
      const existing = checkStmt.get(targetUserId, b.filepath, b.title)
      if (!existing) {
        insertStmt.run(
          targetUserId,
          b.title,
          b.author || '',
          b.filename,
          b.filepath,
          b.total_pages || 0,
          b.category || '',
          b.category_ids || '[]',
          b.tags || '[]',
          b.wrapped_fek || null,
          b.is_encrypted || 0,
          b.thumbnail || null
        )
        clonedCount++
      }
    }
  })()

  // Özel yüklenen thumbnail'leri (migrated olmayan) önceliklendirerek senkronize et
  try {
    db.prepare(`
      UPDATE books
      SET thumbnail = (
        SELECT ob.thumbnail FROM books ob 
        WHERE ob.filepath = books.filepath AND ob.thumbnail IS NOT NULL AND ob.thumbnail != '' 
        ORDER BY CASE WHEN ob.thumbnail LIKE '%-migrated.%' THEN 1 ELSE 0 END, ob.id DESC
        LIMIT 1
      )
      WHERE (thumbnail IS NULL OR thumbnail = '' OR thumbnail LIKE '%-migrated.%')
    `).run()
  } catch {}

  return clonedCount
}

export function distributeOwnerBooksToAllUsers(): { totalUsersUpdated: number; totalBooksCloned: number } {
  const users = db.prepare("SELECT id FROM users WHERE username != 'owner'").all() as { id: number }[]
  let totalUsersUpdated = 0
  let totalBooksCloned = 0

  for (const u of users) {
    const count = distributeOwnerBooksToUser(u.id)
    if (count > 0) {
      totalUsersUpdated++
      totalBooksCloned += count
    }
  }

  return { totalUsersUpdated, totalBooksCloned }
}

// Owner kitaplarini tum diger kullanicilara sifir disk alaniyla otomatik aktar
try {
  distributeOwnerBooksToAllUsers()
} catch (e) {
  console.error('[db] Failed to auto-distribute owner books:', e)
}

export default db
