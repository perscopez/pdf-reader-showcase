#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const databasePath = process.env.PDF_LIBRARY_DB || path.join(process.cwd(), 'data', 'library.db')

if (!fs.existsSync(databasePath)) {
  console.error(`[encrypted-derivatives] Database not found: ${databasePath}`)
  process.exitCode = 1
  return
}

const db = new Database(databasePath, { readonly: true, fileMustExist: true })

function count(sql) {
  return Number(db.prepare(sql).get().count || 0)
}

try {
  const report = {
    encryptedBooks: count('SELECT COUNT(*) count FROM books WHERE COALESCE(is_encrypted, 0) = 1'),
    plaintextAnnotations: count(`
      SELECT COUNT(*) count
      FROM annotations a
      JOIN books b ON b.id = a.book_id AND b.user_id = a.user_id
      WHERE COALESCE(b.is_encrypted, 0) = 1
        AND TRIM(COALESCE(a.content, '')) NOT IN ('', '{}')
    `),
    plaintextPageModels: count(`
      SELECT COUNT(*) count
      FROM page_text_models p
      JOIN books b ON b.id = p.book_id AND b.user_id = p.user_id
      WHERE COALESCE(b.is_encrypted, 0) = 1
    `),
    plaintextIndexedPages: count(`
      SELECT COUNT(*) count
      FROM book_pages p
      JOIN books b ON b.id = p.book_id
      WHERE COALESCE(b.is_encrypted, 0) = 1
        AND TRIM(COALESCE(p.content, '')) <> ''
    `),
    plaintextBookmarks: count(`
      SELECT COUNT(*) count
      FROM bookmarks bm
      JOIN books b ON b.id = bm.book_id AND b.user_id = bm.user_id
      WHERE COALESCE(b.is_encrypted, 0) = 1
    `),
    plaintextWords: count(`
      SELECT COUNT(*) count
      FROM word_library w
      JOIN books b ON b.id = w.source_book_id AND b.user_id = w.user_id
      WHERE COALESCE(b.is_encrypted, 0) = 1
        AND (TRIM(COALESCE(w.word, '')) <> '' OR TRIM(COALESCE(w.context, '')) <> '')
    `),
  }

  console.log(JSON.stringify(report, null, 2))
  if (report.plaintextAnnotations || report.plaintextPageModels || report.plaintextIndexedPages || report.plaintextBookmarks || report.plaintextWords) {
    console.log('[encrypted-derivatives] Legacy plaintext derivatives detected.')
    console.log('[encrypted-derivatives] This command is deliberately report-only: take a verified backup, export/re-encrypt any notes that must be preserved, then purge through an explicit maintenance migration.')
  } else {
    console.log('[encrypted-derivatives] No legacy plaintext database derivatives detected.')
  }
} finally {
  db.close()
}
