import fs from 'fs'
import path from 'path'

export interface BackupArchiveEntry {
  name: string
  path: string
  sizeBytes: number
  sizeLabel: string
  modifiedAt: string
}

export interface BackupRunRecord {
  startedAt: string
  finishedAt: string | null
  success: boolean
  trigger: string
  local: {
    ok: boolean
    path: string | null
    sizeBytes: number
    sizeLabel: string | null
    error: string | null
    finishedAt: string | null
  }
  s3: {
    ok: boolean
    skipped: boolean
    key: string | null
    error: string | null
    finishedAt: string | null
    reason?: string
  }
}

export interface BackupStatusFile {
  version: number
  updatedAt: string | null
  running: boolean
  lastRun: BackupRunRecord | null
  history: Array<{
    finishedAt: string
    success: boolean
    trigger: string
    localSizeLabel?: string | null
    s3?: string
    error?: string
  }>
  archives: {
    local: BackupArchiveEntry[]
    host: BackupArchiveEntry[]
    s3: Array<{ key: string; modifiedAt?: string; sizeBytes?: number }>
  }
}

function formatBytes(bytes: number) {
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

function listArchives(dir: string, prefix: string): BackupArchiveEntry[] {
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

export function readBackupStatus(): BackupStatusFile {
  const file = path.join(process.cwd(), 'data', 'backup-status.json')
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
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as BackupStatusFile
    return parsed
  } catch {
    return {
      version: 1,
      updatedAt: null,
      running: false,
      lastRun: null,
      history: [],
      archives: { local: [], host: [], s3: [] },
    }
  }
}

export function refreshArchiveIndex(status: BackupStatusFile): BackupStatusFile {
  const localDir = process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), 'data', 'backup-archives')
  const hostMount = path.join(process.cwd(), 'host-backups')
  const hostDir = fs.existsSync(hostMount)
    ? hostMount
    : (process.env.BACKUP_HOST_DIR && fs.existsSync(process.env.BACKUP_HOST_DIR) ? process.env.BACKUP_HOST_DIR : null)

  return {
    ...status,
    archives: {
      local: listArchives(localDir, 'pdf-library-'),
      host: hostDir
        ? [...listArchives(hostDir, 'pre-docker-'), ...listArchives(hostDir, 'pdf-library-')]
        : [],
      s3: status.archives?.s3 || [],
    },
  }
}

export function isBackupRunning(): boolean {
  const lock = path.join(process.cwd(), 'data', '.backup-running.lock')
  if (!fs.existsSync(lock)) return false
  const age = Date.now() - fs.statSync(lock).mtimeMs
  if (age > 2 * 60 * 60 * 1000) {
    try { fs.unlinkSync(lock) } catch { /* ignore */ }
    return false
  }
  return true
}

export function backupCapabilities() {
  const s3Ready = Boolean(
    process.env.S3_ACCESS_KEY_ID
    && process.env.S3_SECRET_ACCESS_KEY
    && process.env.S3_BUCKET_NAME
    && process.env.BACKUP_ENCRYPTION_KEY,
  )
  return {
    s3Configured: s3Ready,
    localDir: process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), 'data', 'backup-archives'),
    hostDir: process.env.BACKUP_HOST_DIR || '/var/backups/pdf-library',
    s3IntervalHours: Number(process.env.S3_BACKUP_INTERVAL_HOURS || 6),
    localKeep: Number(process.env.BACKUP_LOCAL_KEEP || process.env.KEEP || 72),
    hostKeep: Number(process.env.BACKUP_HOST_KEEP || process.env.REMOTE_BACKUP_KEEP || 14),
  }
}
