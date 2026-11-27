import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getCurrentUser, type AuthUser } from '@/lib/auth'
import {
  backupCapabilities,
  isBackupRunning,
  readBackupStatus,
  refreshArchiveIndex,
} from '@/lib/backupAdmin'

function isOwner(user: AuthUser | null) {
  return Boolean(user && user.username === 'owner' && user.role === 'admin')
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!isOwner(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = refreshArchiveIndex(readBackupStatus())
  const running = status.running || isBackupRunning()
  const logPath = path.join(process.cwd(), 'data', 'backup.log')
  let logTail = ''
  if (fs.existsSync(logPath)) {
    const raw = fs.readFileSync(logPath, 'utf8')
    logTail = raw.split('\n').slice(-40).join('\n').trim()
  }

  return NextResponse.json({
    status: { ...status, running },
    capabilities: backupCapabilities(),
    cron: {
      expected: '0 * * * * docker compose exec -T app node scripts/safe-backup.js',
      logTail,
    },
  })
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!isOwner(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (isBackupRunning()) {
    return NextResponse.json({ error: 'backup_already_running' }, { status: 409 })
  }

  const script = path.join(process.cwd(), 'scripts', 'safe-backup.js')
  if (!fs.existsSync(script)) {
    return NextResponse.json({ error: 'backup_script_missing' }, { status: 500 })
  }

  const logPath = path.join(process.cwd(), 'data', 'backup.log')
  const logStream = fs.openSync(logPath, 'a')
  const child = spawn(process.execPath, [script, '--manual'], {
    cwd: process.cwd(),
    env: { ...process.env, BACKUP_TRIGGER: 'manual' },
    detached: true,
    stdio: ['ignore', logStream, logStream],
  })
  child.unref()

  return NextResponse.json({ started: true, pid: child.pid })
}
