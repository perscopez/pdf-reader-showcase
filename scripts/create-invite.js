/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path')
const { randomBytes } = require('crypto')
const Database = require('better-sqlite3')

const count = Math.min(100, Math.max(1, Number.parseInt(process.argv[2] || '1', 10) || 1))
const databasePath = process.env.PDF_LIBRARY_DB || path.join(process.cwd(), 'data', 'library.db')
const db = new Database(databasePath)

try {
  const insert = db.prepare('INSERT INTO invitation_codes (code) VALUES (?)')
  const codes = db.transaction(() => {
    const created = []
    for (let index = 0; index < count; index += 1) {
      const code = `BETA-${randomBytes(18).toString('base64url').toUpperCase()}`
      insert.run(code)
      created.push(code)
    }
    return created
  })()
  process.stdout.write(`${codes.join('\n')}\n`)
} finally {
  db.close()
}
