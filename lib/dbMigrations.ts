import type BetterSqlite3 from 'better-sqlite3'

export type MigrationDatabase = Pick<BetterSqlite3.Database, 'exec' | 'prepare' | 'transaction'>

export function runVersionedMigration(
  database: MigrationDatabase,
  migrationId: string,
  migrate: () => void,
) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)

  const execute = database.transaction(() => {
    const applied = database.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(migrationId)
    if (applied) return false
    migrate()
    database.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migrationId)
    return true
  })

  // BEGIN IMMEDIATE serializes startup migrations across separate Next.js
  // module connections before any read-then-write upgrade can race.
  return execute.immediate ? execute.immediate() : execute()
}

export function migrateBookPagesUniqueness(database: MigrationDatabase) {
  return runVersionedMigration(database, '2026-08-01-book-pages-unique-v1', () => {
    database.exec(`
      DELETE FROM book_pages
      WHERE id NOT IN (
        SELECT MAX(id) FROM book_pages GROUP BY book_id, page_number
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_book_pages_book_page
        ON book_pages(book_id, page_number);
    `)
  })
}

export function migrateReadingGroupsSchema(database: MigrationDatabase) {
  return runVersionedMigration(database, '2026-08-08-reading-groups-v1', () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS reading_groups (
        id INTEGER PRIMARY KEY,
        owner_user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(owner_user_id, name),
        FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS reading_group_members (
        id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(group_id, user_id),
        FOREIGN KEY(group_id) REFERENCES reading_groups(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS reading_group_books (
        id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        added_by_user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(group_id, book_id),
        FOREIGN KEY(group_id) REFERENCES reading_groups(id) ON DELETE CASCADE,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY(added_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS reading_group_annotations (
        id INTEGER PRIMARY KEY,
        group_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        author_user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '{}',
        page INTEGER NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'group' CHECK(visibility IN ('group', 'private')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(group_id) REFERENCES reading_groups(id) ON DELETE CASCADE,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
        FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS reading_group_annotation_replies (
        id INTEGER PRIMARY KEY,
        annotation_id INTEGER NOT NULL,
        author_user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(annotation_id) REFERENCES reading_group_annotations(id) ON DELETE CASCADE,
        FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_reading_group_members_user
        ON reading_group_members(user_id, group_id);
      CREATE INDEX IF NOT EXISTS idx_reading_group_books_group
        ON reading_group_books(group_id, book_id);
      CREATE INDEX IF NOT EXISTS idx_reading_group_annotations_group_book
        ON reading_group_annotations(group_id, book_id, page, id);
      CREATE INDEX IF NOT EXISTS idx_reading_group_replies_annotation
        ON reading_group_annotation_replies(annotation_id, id);
    `)
  })
}

export function migrateResearchNotebooksSchema(database: MigrationDatabase) {
  return runVersionedMigration(database, '2026-08-09-research-notebooks-v1', () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS research_notebooks (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS research_notebook_items (
        id INTEGER PRIMARY KEY,
        notebook_id INTEGER NOT NULL,
        annotation_id INTEGER NOT NULL,
        source_index INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        heading TEXT NOT NULL DEFAULT '',
        commentary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(notebook_id, annotation_id, source_index),
        FOREIGN KEY(notebook_id) REFERENCES research_notebooks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_research_notebooks_user_updated
        ON research_notebooks(user_id, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_research_notebook_items_notebook_position
        ON research_notebook_items(notebook_id, position, id);
      CREATE INDEX IF NOT EXISTS idx_research_notebook_items_annotation
        ON research_notebook_items(annotation_id);
    `)
  })
}

export function migrateAudioNotesSchema(database: MigrationDatabase) {
  return runVersionedMigration(database, '2026-08-09-audio-notes-v1', () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS audio_note_sessions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        file_path TEXT,
        mime_type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'recording', 'paused', 'completed', 'failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audio_note_markers (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL,
        annotation_id INTEGER,
        page INTEGER NOT NULL DEFAULT 1,
        timestamp_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(session_id) REFERENCES audio_note_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(annotation_id) REFERENCES annotations(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audio_note_sessions_user_book
        ON audio_note_sessions(user_id, book_id, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_audio_note_markers_session_time
        ON audio_note_markers(session_id, timestamp_ms, id);
      CREATE INDEX IF NOT EXISTS idx_audio_note_markers_annotation
        ON audio_note_markers(annotation_id);
    `)
  })
}
