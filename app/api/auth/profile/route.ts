import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser, clearAuthCookie } from '@/lib/auth'
import { hashPassword, verifyPassword } from '@/lib/password'
import { persistDataImage } from '@/lib/media'

export async function PATCH(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const avatar = typeof body.avatar === 'string' ? body.avatar : undefined
  const username = typeof body.username === 'string' ? body.username.trim() : undefined
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  if (username !== undefined) {
    if (username.length < 3 || username.length > 30) {
      return NextResponse.json({ error: 'Kullanıcı adı 3 ila 30 karakter arasında olmalıdır' }, { status: 400 })
    }
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(username, user.id)
    if (existing) {
      return NextResponse.json({ error: 'Bu kullanıcı adı zaten alınmış' }, { status: 400 })
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, user.id)
  }

  if (avatar !== undefined) {
    if (avatar.length > 7_000_000 || (avatar && !avatar.startsWith('data:image/') && !avatar.startsWith('/uploads/avatars/'))) {
      return NextResponse.json({ error: 'Geçersiz avatar' }, { status: 400 })
    }
    try {
      const storedAvatar = await persistDataImage(avatar, 'avatars', `user-${user.id}`, user.avatar)
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(storedAvatar, user.id)
    } catch {
      return NextResponse.json({ error: 'Geçersiz avatar' }, { status: 400 })
    }
  }

  if (newPassword) {
    if (newPassword.length < 8) return NextResponse.json({ error: 'Password too short' }, { status: 400 })
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string }
    if (!verifyPassword(currentPassword, row.password_hash)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id)
  }

  const updated = db.prepare('SELECT username, role, is_test, avatar FROM users WHERE id = ?').get(user.id)
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const password = typeof body.password === 'string' ? body.password : ''

  if (!password) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string } | undefined
  if (!row || !verifyPassword(password, row.password_hash)) {
    return NextResponse.json({ error: 'Password incorrect' }, { status: 403 })
  }

  db.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = ?").run(user.id)

  const res = NextResponse.json({ success: true })
  clearAuthCookie(res)
  return res
}
