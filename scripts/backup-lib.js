/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  content.split('\n').forEach(line => {
    const match = /^\s*([^#=]+)\s*=\s*(.*)$/.exec(line)
    if (!match) return
    const key = match[1].trim()
    if (process.env[key]) return
    let val = match[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  })
}

function loadEnv() {
  loadEnvFile(path.join(process.cwd(), '.env.local'))
  loadEnvFile(path.join(process.cwd(), '.env'))
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function statusPath(root = process.cwd()) {
  return path.join(root, 'data', 'backup-status.json')
}

function lockPath(root = process.cwd()) {
  return path.join(root, 'data', '.backup-running.lock')
}

function readStatus(root = process.cwd()) {
  const file = statusPath(root)
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      updatedAt: null,
      running: false,
      lastRun: null,
      history: [],
      archives: { local: [], host: [], s3: [] },
    }
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { version: 1, updatedAt: null, running: false, lastRun: null, history: [], archives: { local: [], host: [], s3: [] } }
  }
}

function writeStatus(status, root = process.cwd()) {
  const file = statusPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  status.updatedAt = new Date().toISOString()
  fs.writeFileSync(file, JSON.stringify(status, null, 2))
}

function acquireLock(root = process.cwd()) {
  const file = lockPath(root)
  if (fs.existsSync(file)) {
    const age = Date.now() - fs.statSync(file).mtimeMs
    if (age < 2 * 60 * 60 * 1000) return false
    fs.unlinkSync(file)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  return true
}

function releaseLock(root = process.cwd()) {
  const file = lockPath(root)
  if (fs.existsSync(file)) fs.unlinkSync(file)
}

function localArchiveDir(root = process.cwd()) {
  return process.env.BACKUP_LOCAL_DIR || path.join(root, 'data', 'backup-archives')
}

function hostArchiveDir() {
  return process.env.BACKUP_HOST_DIR || process.env.REMOTE_BACKUP_DIR || '/var/backups/pdf-library'
}

function hostBackupMount(root = process.cwd()) {
  const mounted = path.join(root, 'host-backups')
  if (fs.existsSync(mounted)) return mounted
  const direct = hostArchiveDir()
  if (fs.existsSync(direct)) return direct
  return null
}

function s3Configured() {
  return Boolean(
    process.env.S3_ACCESS_KEY_ID
    && process.env.S3_SECRET_ACCESS_KEY
    && process.env.S3_BUCKET_NAME
    && process.env.BACKUP_ENCRYPTION_KEY,
  )
}

function shouldRunS3(status) {
  if (!s3Configured()) return false
  const hours = Math.max(1, Number(process.env.S3_BACKUP_INTERVAL_HOURS || 6))
  const last = status?.lastRun?.s3?.finishedAt || status?.lastRun?.finishedAt
  if (!last) return true
  const elapsed = Date.now() - new Date(last).getTime()
  return elapsed >= hours * 60 * 60 * 1000
}

function listArchives(dir, prefix) {
  if (!dir || !fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => name.startsWith(prefix) && (name.endsWith('.tar.gz') || name.endsWith('.zip.enc')))
    .map(name => {
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      return {
        name,
        path: full,
        sizeBytes: stat.size,
        sizeLabel: formatBytes(stat.size),
        modifiedAt: stat.mtime.toISOString(),
      }
    })
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
}

function pruneArchives(dir, prefix, keep) {
  if (!dir || !fs.existsSync(dir)) return
  const files = listArchives(dir, prefix)
  files.slice(keep).forEach(file => {
    try {
      fs.unlinkSync(file.path)
    } catch {
      // ignore prune errors
    }
  })
}

function createLocalArchive(root = process.cwd()) {
  const stamp = new Date().toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z'
  const outDir = localArchiveDir(root)
  fs.mkdirSync(outDir, { recursive: true })
  const archive = path.join(outDir, `pdf-library-${stamp}.tar.gz`)
  const dataDir = path.join(root, 'data')
  const uploadsDir = path.join(root, 'public', 'uploads')
  if (!fs.existsSync(dataDir)) throw new Error('data/ directory missing')
  if (!fs.existsSync(uploadsDir)) throw new Error('public/uploads/ directory missing')

  const excludes = [
    'data/backup-archives',
    'data/backup.log',
    'data/.backup-running.lock',
  ].map(item => `--exclude=${shellQuote(item)}`).join(' ')

  const cmd = [
    'set -e',
    `cd ${shellQuote(root)}`,
    `tar -czf ${shellQuote(archive)} ${excludes} data public/uploads`,
    `echo ${shellQuote(archive)}`,
  ].join(' && ')
  execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  const sizeBytes = fs.statSync(archive).size
  // A full archive is roughly 250 MB on the current production dataset.
  // The production schedule is every six hours and retains six restore points.
  const keep = Math.max(1, Number(process.env.BACKUP_LOCAL_KEEP || process.env.KEEP || 6))
  pruneArchives(outDir, 'pdf-library-', keep)

  const hostMirror = (() => {
    const mounted = path.join(root, 'host-backups')
    if (fs.existsSync(mounted)) {
      try {
        fs.accessSync(mounted, fs.constants.W_OK)
        return mounted
      } catch {
        return null
      }
    }
    const hostDir = hostArchiveDir()
    if (!hostDir || hostDir === outDir) return null
    try {
      fs.mkdirSync(hostDir, { recursive: true })
      fs.accessSync(hostDir, fs.constants.W_OK)
      return hostDir
    } catch {
      return null
    }
  })()

  if (hostMirror) {
    try {
      const hostCopy = path.join(hostMirror, path.basename(archive))
      fs.copyFileSync(archive, hostCopy)
      const hostKeep = Math.max(1, Number(process.env.BACKUP_HOST_KEEP || process.env.REMOTE_BACKUP_KEEP || 14))
      pruneArchives(hostMirror, 'pdf-library-', hostKeep)
    } catch (err) {
      console.warn('[backup] Host mirror skipped:', err.message)
    }
  }

  return { archive, sizeBytes, stamp }
}

function appendHistory(status, entry) {
  const history = Array.isArray(status.history) ? status.history : []
  history.unshift(entry)
  status.history = history.slice(0, 30)
}

function collectArchiveIndex(root = process.cwd()) {
  const localDir = localArchiveDir(root)
  const hostDir = hostBackupMount(root)
  return {
    local: listArchives(localDir, 'pdf-library-'),
    host: hostDir ? listArchives(hostDir, 'pre-docker-').concat(listArchives(hostDir, 'pdf-library-')) : [],
    s3: Array.isArray(readStatus(root).archives?.s3) ? readStatus(root).archives.s3 : [],
  }
}

module.exports = {
  loadEnv,
  formatBytes,
  statusPath,
  readStatus,
  writeStatus,
  acquireLock,
  releaseLock,
  localArchiveDir,
  hostArchiveDir,
  hostBackupMount,
  s3Configured,
  shouldRunS3,
  listArchives,
  pruneArchives,
  createLocalArchive,
  appendHistory,
  collectArchiveIndex,
}
