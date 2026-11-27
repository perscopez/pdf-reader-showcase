/* eslint-disable @typescript-eslint/no-require-imports */
// Creates a local user in the SQLite database with a generated password.
// Usage: node scripts/create-user.js <username> [role]
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const username = (process.argv[2] || '').trim()
const role = process.argv[3] === 'admin' ? 'admin' : 'user'
if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
  console.error('Usage: node scripts/create-user.js <username> [admin|user]')
  process.exit(1)
}

const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
let password = ''
for (let i = 0; i < 16; i++) password += chars[crypto.randomInt(chars.length)]

const salt = crypto.randomBytes(16).toString('base64url')
const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('base64url')
const passwordHash = `pbkdf2:120000:${salt}:${hash}`

const databasePath = process.env.PDF_LIBRARY_DB || path.join(process.cwd(), 'data', 'library.db')
const db = new Database(databasePath)
try {
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    console.error(`User "${username}" already exists.`)
    process.exit(1)
  }
  db.prepare('INSERT INTO users (username, password_hash, role, is_test, is_email_verified) VALUES (?, ?, ?, 0, 1)')
    .run(username, passwordHash, role)
  console.log(`Created ${role} "${username}" with password: ${password}`)
} finally {
  db.close()
}
