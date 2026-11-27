#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  loadEnv,
  readStatus,
  writeStatus,
  acquireLock,
  releaseLock,
  createLocalArchive,
  appendHistory,
  collectArchiveIndex,
  s3Configured,
  shouldRunS3,
  formatBytes,
} = require('./backup-lib')

loadEnv()

const trigger = process.argv.includes('--manual') ? 'manual' : (process.env.BACKUP_TRIGGER || 'cron')
const root = process.cwd()

async function runS3Backup() {
  const script = path.join(root, 'scripts', 'backup-s3.js')
  if (!fs.existsSync(script)) {
    return { ok: false, skipped: true, error: 'backup-s3.js missing' }
  }
  const result = spawnSync(process.execPath, [script, 'backup'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
  })
  if (result.status === 0) {
    const keyMatch = /pdf-library-backup-.*\.zip\.enc/.exec(`${result.stdout}\n${result.stderr}`)
    return {
      ok: true,
      skipped: false,
      key: keyMatch ? keyMatch[0] : null,
      finishedAt: new Date().toISOString(),
      log: (result.stdout || '').trim().slice(-2000),
    }
  }
  return {
    ok: false,
    skipped: false,
    error: (result.stderr || result.stdout || `exit ${result.status}`).trim().slice(-2000),
    finishedAt: new Date().toISOString(),
  }
}

async function main() {
  if (!acquireLock(root)) {
    console.error('[backup] Another backup is already running.')
    process.exitCode = 0
    return
  }

  const startedAt = new Date().toISOString()
  const status = readStatus(root)
  status.running = true
  writeStatus(status, root)

  const run = {
    startedAt,
    finishedAt: null,
    success: false,
    trigger,
    local: { ok: false, path: null, sizeBytes: 0, sizeLabel: null, error: null, finishedAt: null },
    s3: { ok: false, skipped: !s3Configured(), key: null, error: null, finishedAt: null },
  }

  try {
    console.log(`[backup] Starting (${trigger})...`)
    const local = createLocalArchive(root)
    run.local = {
      ok: true,
      path: local.archive,
      sizeBytes: local.sizeBytes,
      sizeLabel: formatBytes(local.sizeBytes),
      error: null,
      finishedAt: new Date().toISOString(),
    }
    console.log(`[backup] Local archive: ${local.archive} (${run.local.sizeLabel})`)

    if (shouldRunS3(status)) {
      console.log('[backup] Running encrypted S3 backup...')
      run.s3 = await runS3Backup()
      if (run.s3.skipped) {
        console.log('[backup] S3 skipped (not configured).')
      } else if (run.s3.ok) {
        console.log(`[backup] S3 upload OK${run.s3.key ? `: ${run.s3.key}` : ''}`)
      } else {
        console.error('[backup] S3 failed:', run.s3.error)
      }
    } else {
      run.s3 = { ok: false, skipped: true, key: null, error: null, finishedAt: null, reason: 'interval-not-due' }
      console.log('[backup] S3 skipped (interval not due or not configured).')
    }

    run.finishedAt = new Date().toISOString()
    run.success = run.local.ok && (run.s3.skipped || run.s3.ok)
    status.running = false
    status.lastRun = run
    status.archives = collectArchiveIndex(root)
    appendHistory(status, {
      finishedAt: run.finishedAt,
      success: run.success,
      trigger,
      localSizeLabel: run.local.sizeLabel,
      s3: run.s3.skipped ? 'skipped' : (run.s3.ok ? 'ok' : 'failed'),
    })
    writeStatus(status, root)
    console.log(`[backup] Done. success=${run.success}`)
    process.exitCode = run.success ? 0 : 1
  } catch (err) {
    run.finishedAt = new Date().toISOString()
    run.success = false
    run.local.error = err.message || String(err)
    status.running = false
    status.lastRun = run
    appendHistory(status, {
      finishedAt: run.finishedAt,
      success: false,
      trigger,
      error: run.local.error,
    })
    writeStatus(status, root)
    console.error('[backup] Failed:', err.message || err)
    process.exitCode = 1
  } finally {
    releaseLock(root)
  }
}

main()
