import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const user = getCurrentUser(request)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const recipients = db.prepare('SELECT id, username, role FROM users WHERE id != ? ORDER BY username ASC').all(user.id) as { id: number; username: string; role: string }[]
    return NextResponse.json({ success: true, recipients })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = getCurrentUser(request)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const body = await request.json()
    const { bookIds, targetUserId, includeAnnotations } = body

    if (!Array.isArray(bookIds) || bookIds.length === 0) {
      return NextResponse.json({ error: 'Transfer edilecek kitap seçilmedi' }, { status: 400 })
    }
    if (!targetUserId || typeof targetUserId !== 'number') {
      return NextResponse.json({ error: 'Geçerli bir hedef kullanıcı seçilmedi' }, { status: 400 })
    }

    const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetUserId) as { id: number; username: string } | undefined
    if (!targetUser) {
      return NextResponse.json({ error: 'Hedef kullanıcı bulunamadı' }, { status: 404 })
    }

    const isAdmin = user.role === 'admin'
    const placeholders = bookIds.map(() => '?').join(',')
    const query = isAdmin
      ? `SELECT * FROM books WHERE id IN (${placeholders})`
      : `SELECT * FROM books WHERE id IN (${placeholders}) AND user_id = ?`
    const params = isAdmin ? bookIds : [...bookIds, user.id]

    const sourceBooks = db.prepare(query).all(...params) as {
      id: number
      user_id: number
      title: string
      author: string
      filename: string
      filepath: string
      total_pages: number
      category: string
      category_ids: string
      tags: string
      wrapped_fek: string | null
      is_encrypted: number
      thumbnail: string | null
    }[]

    if (sourceBooks.length === 0) {
      return NextResponse.json({ error: 'Transfer edilebilir kitap bulunamadı veya yetkiniz yok' }, { status: 400 })
    }

    let transferredCount = 0
    let annotationsCopied = 0

    const checkStmt = db.prepare('SELECT id FROM books WHERE user_id = ? AND (filepath = ? OR title = ?)')
    const insertBookStmt = db.prepare(`
      INSERT INTO books (
        user_id, title, author, filename, filepath, total_pages, category, category_ids, tags, wrapped_fek, is_encrypted, thumbnail, last_page, favorite, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'reading'
      )
    `)

    const getAnnotationsStmt = db.prepare('SELECT type, content, page, is_encrypted, encrypted_data FROM annotations WHERE book_id = ? AND user_id = ?')
    const insertAnnotationStmt = db.prepare(`
      INSERT INTO annotations (user_id, book_id, type, content, page, is_encrypted, encrypted_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const getBookmarksStmt = db.prepare('SELECT page, label, is_encrypted, encrypted_data FROM bookmarks WHERE book_id = ? AND user_id = ?')
    const insertBookmarkStmt = db.prepare(`
      INSERT INTO bookmarks (user_id, book_id, page, label, is_encrypted, encrypted_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    db.transaction(() => {
      for (const b of sourceBooks) {
        let targetBookId: number
        const existing = checkStmt.get(targetUserId, b.filepath, b.title) as { id: number } | undefined

        if (existing) {
          targetBookId = existing.id
        } else {
          const info = insertBookStmt.run(
            targetUserId,
            b.title,
            b.author || '',
            b.filename,
            b.filepath,
            b.total_pages || 0,
            b.category || '',
            b.category_ids || '[]',
            b.tags || '[]',
            b.wrapped_fek || null,
            b.is_encrypted || 0,
            b.thumbnail || null
          )
          targetBookId = Number(info.lastInsertRowid)
          transferredCount++
        }

        if (includeAnnotations) {
          const annos = getAnnotationsStmt.all(b.id, b.user_id) as {
            type: string
            content: string
            page: number
            is_encrypted: number
            encrypted_data: string | null
          }[]
          for (const a of annos) {
            insertAnnotationStmt.run(targetUserId, targetBookId, a.type, a.content, a.page, a.is_encrypted || 0, a.encrypted_data || null)
            annotationsCopied++
          }

          const marks = getBookmarksStmt.all(b.id, b.user_id) as {
            page: number
            label: string | null
            is_encrypted: number
            encrypted_data: string | null
          }[]
          for (const m of marks) {
            insertBookmarkStmt.run(targetUserId, targetBookId, m.page, m.label || null, m.is_encrypted || 0, m.encrypted_data || null)
          }
        }
      }
    })()

    const annoText = includeAnnotations ? ` (${annotationsCopied} not/vurgu ile birlikte)` : ' (anotasyonsuz)'
    const message = `${sourceBooks.length} kitap ${targetUser.username} kullanıcısına başarıyla gönderildi${annoText}.`

    return NextResponse.json({
      success: true,
      message,
      transferredCount,
      annotationsCopied,
    })
  } catch (e) {
    console.error('[transfer] Error transferring books:', e)
    return NextResponse.json({ error: 'Transfer sırasında bir sunucu hatası oluştu' }, { status: 500 })
  }
}
