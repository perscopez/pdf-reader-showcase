-- Run this in your PostgreSQL database to set up the schema

CREATE DATABASE pdflibrary;

\c pdflibrary;

CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  cover_page INT DEFAULT 1,
  total_pages INT,
  last_page INT DEFAULT 1,
  favorite INT DEFAULT 0,
  category TEXT DEFAULT '',
  tags JSONB DEFAULT '[]',
  status TEXT DEFAULT 'reading',
  last_opened_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE annotations (
  id SERIAL PRIMARY KEY,
  book_id INT REFERENCES books(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'highlight', 'note', 'drawing'
  content JSONB NOT NULL,
  page INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE word_library (
  id SERIAL PRIMARY KEY,
  word TEXT NOT NULL,
  definition TEXT,
  context TEXT,
  source_book_id INT REFERENCES books(id) ON DELETE SET NULL,
  source_page INT,
  mastery INT DEFAULT 0,
  review_count INT DEFAULT 0,
  last_reviewed_at TIMESTAMP,
  fsrs_due TIMESTAMP,
  fsrs_state INT DEFAULT 0,
  fsrs_stability REAL DEFAULT 0,
  fsrs_difficulty REAL DEFAULT 0,
  fsrs_elapsed_days INT DEFAULT 0,
  fsrs_scheduled_days INT DEFAULT 0,
  fsrs_reps INT DEFAULT 0,
  fsrs_lapses INT DEFAULT 0,
  fsrs_learning_steps INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE bookmarks (
  id SERIAL PRIMARY KEY,
  book_id INT REFERENCES books(id) ON DELETE CASCADE,
  page INT NOT NULL,
  label TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- If upgrading an existing database (already ran schema.sql before), run just this:
-- CREATE TABLE IF NOT EXISTS bookmarks (id SERIAL PRIMARY KEY, book_id INT REFERENCES books(id) ON DELETE CASCADE, page INT NOT NULL, label TEXT, created_at TIMESTAMP DEFAULT NOW());
