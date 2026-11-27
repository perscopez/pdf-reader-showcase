/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

const publicRoutes = new Set([
  'app/api/auth/login/route.ts',
  'app/api/auth/check-account/route.ts',
  'app/api/auth/register/route.ts',
  'app/api/auth/logout/route.ts',
  'app/api/auth/recover-vault/route.ts',
  'app/api/auth/resend-verification/route.ts',
  'app/api/auth/restore-account/route.ts',
  'app/api/auth/vault-salt/route.ts',
  'app/api/auth/verify-email/route.ts',
  'app/api/health/route.ts',
  'app/api/pdf-worker/route.ts',
  'app/api/dmca/route.ts',
])

const ownershipRoutes = [
  'app/api/annotations/route.ts',
  'app/api/bookmarks/route.ts',
  'app/api/books/[id]/export/route.ts',
  'app/api/books/[id]/route.ts',
  'app/api/books/[id]/sessions/route.ts',
  'app/api/pdf/[filename]/route.ts',
  'app/api/uploads/[...path]/route.ts',
]

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (entry.name === 'route.ts') files.push(full)
  }
  return files
}

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

const routeFiles = [
  ...walk(path.join(root, 'app', 'api')),
].sort((a, b) => rel(a).localeCompare(rel(b)))

const failures = []

for (const file of routeFiles) {
  const relative = rel(file)
  const source = fs.readFileSync(file, 'utf8')
  const exportsHandler = /export async function (GET|POST|PATCH|PUT|DELETE|HEAD)\b/.test(source)
  if (!exportsHandler) continue

  const isPublic = publicRoutes.has(relative)
  const hasAuth = source.includes('getCurrentUser(')
  if (!isPublic && !hasAuth) {
    failures.push(`${relative}: route must call getCurrentUser or be listed as public`)
  }

  if (ownershipRoutes.includes(relative)) {
    const hasOwnership =
      source.includes('userOwnsBook(') ||
      source.includes('user_id = ?') ||
      source.includes('user.id') && source.includes('filename = ?') ||
      source.includes('book_id = ? AND user_id = ?')
    if (!hasOwnership) {
      failures.push(`${relative}: book/file scoped route is missing an ownership check hint`)
    }
  }
}

const proxySource = fs.readFileSync(path.join(root, 'proxy.ts'), 'utf8')
if (/local-dev-session-secret|change-me/i.test(proxySource)) {
  failures.push('proxy.ts: hardcoded session secret fallback detected')
}

const dbSource = fs.readFileSync(path.join(root, 'lib/db.ts'), 'utf8')
if (!dbSource.includes("process.env.ENABLE_TEST_ACCOUNT === 'true' && configuredTestPassword")) {
  failures.push('lib/db.ts: test account must be disabled by default in production')
}
if (!dbSource.includes("DELETE FROM invitation_codes WHERE used_by_user_id IS NULL")) {
  failures.push('lib/db.ts: published default invitation codes must be removed in production')
}

const recoverySource = fs.readFileSync(path.join(root, 'app/api/auth/recover-vault/route.ts'), 'utf8')
if (!recoverySource.includes('timingSafeEqual') || !recoverySource.includes('recovery_verifier')) {
  failures.push('recover-vault: password reset must verify possession of the recovery code')
}

const nextConfigSource = fs.readFileSync(path.join(root, 'next.config.js'), 'utf8')
if (!/beforeFiles[\s\S]*source: '\/uploads\/:path\*'[\s\S]*destination: '\/api\/uploads\/:path\*'/.test(nextConfigSource)) {
  failures.push('next.config.js: /uploads must be rewritten (beforeFiles) to the guarded /api/uploads route')
}
if (fs.existsSync(path.join(root, 'app', 'uploads'))) {
  failures.push('app/uploads: uploads must be served only by app/api/uploads')
}

const dockerIgnore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8')
for (const requiredPattern of ['.env.*', 'data', 'public/uploads']) {
  if (!dockerIgnore.split(/\r?\n/).includes(requiredPattern)) {
    failures.push(`.dockerignore: missing ${requiredPattern}`)
  }
}

if (failures.length) {
  console.error('Security audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Security audit passed for ${routeFiles.length} route files.`)
