import { NextRequest, NextResponse } from 'next/server'
import db, { distributeOwnerBooksToAllUsers, distributeOwnerBooksToUser } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { hashPassword } from '@/lib/password'
import fs from 'fs'
import path from 'path'

function requireAdmin(request: NextRequest) {
  const user = getCurrentUser(request)
  if (!user || user.role !== 'admin') return null
  return user
}

export async function GET(request: NextRequest) {
  const admin = requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  try {
    const rawUsers = db.prepare(`
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        u.is_test, 
        u.email, 
        u.is_email_verified, 
        u.created_at,
        COUNT(b.id) as book_count
      FROM users u
      LEFT JOIN books b ON b.user_id = u.id
      GROUP BY u.id
      ORDER BY u.id ASC
    `).all() as {
      id: number
      username: string
      role: string
      is_test: number
      email: string | null
      is_email_verified: number
      created_at: string
      book_count: number
    }[]

    const rawBooks = db.prepare(`
      SELECT 
        b.id, 
        b.user_id, 
        u.username, 
        b.title, 
        b.author, 
        b.category, 
        b.filename, 
        b.filepath, 
        b.thumbnail,
        b.total_pages, 
        b.favorite, 
        b.created_at
      FROM books b
      LEFT JOIN users u ON u.id = b.user_id
      ORDER BY b.id DESC
    `).all()

    const totalBooksCount = (db.prepare('SELECT COUNT(*) as c FROM books').get() as { c: number }).c
    const totalAnnotationsCount = (db.prepare('SELECT COUNT(*) as c FROM annotations').get() as { c: number }).c

    let dbSizeBytes = 0
    try {
      const dbPath = path.join(process.cwd(), 'data', 'library.db')
      if (fs.existsSync(dbPath)) dbSizeBytes = fs.statSync(dbPath).size
    } catch {
      // Ignore stat error
    }

    return NextResponse.json({
      success: true,
      users: rawUsers,
      books: rawBooks,
      stats: {
        totalUsers: rawUsers.length,
        totalBooks: totalBooksCount,
        totalAnnotations: totalAnnotationsCount,
        dbSizeBytes,
      },
    })
  } catch (error) {
    console.error('[admin/users GET]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const admin = requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { action, targetUserId, role, newPassword } = body

    if (!targetUserId || typeof targetUserId !== 'number') {
      return NextResponse.json({ error: 'Invalid target user ID' }, { status: 400 })
    }

    const targetUser = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetUserId) as {
      id: number
      username: string
      role: string
    } | undefined

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (action === 'change_role') {
      if (targetUser.username === 'owner' && role !== 'admin') {
        return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 })
      }
      if (role !== 'user' && role !== 'admin') {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
      }
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetUserId)
      return NextResponse.json({ success: true, message: `${targetUser.username} rolü ${role} olarak güncellendi.` })
    }

    if (action === 'reset_password') {
      if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
        return NextResponse.json({ error: 'Password must be at least 4 characters long' }, { status: 400 })
      }
      const hashed = hashPassword(newPassword.trim())
      db.prepare('UPDATE users SET password_hash = ?, is_email_verified = 1 WHERE id = ?').run(hashed, targetUserId)
      return NextResponse.json({ success: true, message: `${targetUser.username} şifresi başarıyla yenilendi ve e-posta doğrulama kilidi kaldırıldı.` })
    }

    if (action === 'toggle_verify_email') {
      const u = db.prepare('SELECT is_email_verified FROM users WHERE id = ?').get(targetUserId) as { is_email_verified: number }
      const newStatus = u?.is_email_verified ? 0 : 1
      db.prepare('UPDATE users SET is_email_verified = ? WHERE id = ?').run(newStatus, targetUserId)
      return NextResponse.json({
        success: true,
        message: `${targetUser.username} e-posta doğrulama durumu ${newStatus ? 'Doğrulanmış' : 'Doğrulanmamış'} olarak güncellendi.`,
      })
    }

    if (action === 'distribute_owner_books') {
      const res = distributeOwnerBooksToAllUsers()
      return NextResponse.json({
        success: true,
        message: `Owner kütüphanesindeki tüm kitaplar ${res.totalUsersUpdated} kullanıcıya (toplam ${res.totalBooksCloned} kopya, 0 ekstra disk alanı) başarıyla aktarıldı.`,
      })
    }

    if (action === 'distribute_to_single_user') {
      const cloned = distributeOwnerBooksToUser(targetUserId)
      return NextResponse.json({
        success: true,
        message: `${targetUser.username} kullanıcısına ${cloned} yeni kitap (0 ekstra disk alanı) başarıyla eklendi.`,
      })
    }

    if (action === 'remove_user_book') {
      const { targetBookId } = body
      if (!targetBookId || typeof targetBookId !== 'number') {
        return NextResponse.json({ error: 'Invalid target book ID' }, { status: 400 })
      }
      db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(targetBookId, targetUserId)
      return NextResponse.json({
        success: true,
        message: `Kitap ${targetUser.username} kullanıcısının kütüphanesinden kaldırıldı.`,
      })
    }

    if (action === 'delete_user') {
      if (targetUser.username === 'owner') {
        return NextResponse.json({ error: 'Cannot delete owner user' }, { status: 400 })
      }
      if (targetUser.id === admin.id) {
        return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })
      }

      const userBooks = db.prepare('SELECT filepath FROM books WHERE user_id = ?').all(targetUserId) as { filepath: string }[]
      userBooks.forEach(b => {
        try {
          const fullPath = path.join(process.cwd(), 'public', b.filepath.replace(/^\//, ''))
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
        } catch {
          // Ignore file delete error
        }
      })

      db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId)
      return NextResponse.json({ success: true, message: `${targetUser.username} hesabı ve tüm verileri silindi.` })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[admin/users POST]', error)
    return NextResponse.json({ error: 'Failed to execute admin action' }, { status: 500 })
  }
}
