import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import path from 'path'
import db from '@/lib/db'

export async function GET() {
  try {
    const dbOk = Boolean(db.prepare('SELECT 1 AS ok').get())
    const uploadsOk = existsSync(path.join(process.cwd(), 'public', 'uploads'))
    const dataOk = existsSync(path.join(process.cwd(), 'data'))

    return NextResponse.json({
      ok: dbOk && uploadsOk && dataOk,
      checks: {
        database: dbOk,
        uploads: uploadsOk,
        data: dataOk,
      },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[health GET]', err)
    return NextResponse.json({
      ok: false,
      checks: {
        database: false,
        uploads: false,
        data: false,
      },
      timestamp: new Date().toISOString(),
    }, { status: 503 })
  }
}
