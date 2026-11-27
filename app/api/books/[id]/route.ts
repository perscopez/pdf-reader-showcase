import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'
import { getCurrentUser } from '@/lib/auth'
import { persistDataImage } from '@/lib/media'
import { decorateBookCategories, ensureBookCategoryByName, setBookCategoryAssignments } from '@/lib/bookCategories'
import { createBookTrashSnapshot } from '@/lib/trash'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(_req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { id } = await params
    const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(id, user.id)
    if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(decorateBookCategories(user.id, [book as Record<string, unknown>])[0])
  } catch (err) {
    console.error('[books/:id GET]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { id } = await params
    const existing = db.prepare('SELECT id, thumbnail FROM books WHERE id = ? AND user_id = ?').get(id, user.id) as { id: number; thumbnail?: string } | undefined
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const requestedCategoryIds = body.categoryIds ?? body.category_ids
    const allowed = ['title', 'author', 'last_page', 'total_pages', 'favorite', 'category', 'tags', 'status', 'last_opened_at', 'thumbnail', 'total_reading_time', 'encrypted_metadata', 'wrapped_fek', 'rating', 'description', 'isbn', 'doi', 'publication_year', 'publisher', 'publication', 'volume', 'issue', 'pages', 'edition', 'language', 'edition_group_id', 'furthest_page', 'rtl', 'margin_crop']
    const updates: string[] = []
    const values: unknown[] = []

    if (body.added_reading_time !== undefined) {
      const added = Math.max(0, Math.floor(Number(body.added_reading_time) || 0))
      if (added > 0) {
        updates.push('total_reading_time = COALESCE(total_reading_time, 0) + ?')
        values.push(added)
      }
    }

    for (const key of allowed) {
      if (key === 'category' && requestedCategoryIds !== undefined) continue
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`)
        if (key === 'tags' && Array.isArray(body[key])) {
          values.push(JSON.stringify(body[key].map(cleanText)))
        } else if (['title', 'author', 'category'].includes(key)) {
          values.push(cleanText(body[key]))
        } else if (key === 'thumbnail') {
          try {
            const thumbnail = await persistDataImage(body[key], 'thumbnails', `book-${id}`, existing.thumbnail)
            values.push(thumbnail)
          } catch {
            return NextResponse.json({ error: 'Invalid thumbnail' }, { status: 400 })
          }
        } else {
          values.push(body[key])
        }
      }
    }
    if (updates.length) {
      db.prepare(`UPDATE books SET ${updates.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`).run(...values, id, user.id)
      if (body.thumbnail !== undefined) {
        const updatedBook = db.prepare('SELECT filepath, thumbnail FROM books WHERE id = ?').get(id) as { filepath?: string; thumbnail?: string } | undefined
        if (updatedBook?.filepath && updatedBook?.thumbnail) {
          db.prepare('UPDATE books SET thumbnail = ? WHERE filepath = ?').run(updatedBook.thumbnail, updatedBook.filepath)
        }
      }
    }
    if (requestedCategoryIds !== undefined) {
      try {
        db.transaction(() => setBookCategoryAssignments(user.id, Number(id), requestedCategoryIds))()
      } catch {
        return NextResponse.json({ error: 'Invalid categories' }, { status: 400 })
      }
    } else if (body.category !== undefined) {
      try {
        const categoryId = ensureBookCategoryByName(user.id, cleanText(body.category))
        db.transaction(() => setBookCategoryAssignments(user.id, Number(id), categoryId ? [categoryId] : []))()
      } catch {
        return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
      }
    }

    const book = db.prepare('SELECT * FROM books WHERE id = ? AND user_id = ?').get(id, user.id)
    return NextResponse.json(decorateBookCategories(user.id, [book as Record<string, unknown>])[0])
  } catch (err) {
    console.error('[books/:id PATCH]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(_req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  try {
    const { id } = await params
    const result = createBookTrashSnapshot(user.id, Number(id))
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ success: true, trash_id: result.trashId })
  } catch (err) {
    console.error('[books/:id DELETE]', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
