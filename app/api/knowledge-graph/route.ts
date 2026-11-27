import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { buildKnowledgeGraph, type KnowledgeGraphAnnotationRow, type KnowledgeGraphBookRow } from '@/lib/knowledgeGraph'

function parse(value: unknown) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return {} }
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 300)
    const limit = Number.isInteger(limitRaw) ? Math.min(300, Math.max(1, limitRaw)) : 300
    const books = db.prepare(`
      SELECT id, title, author, tags, category,
        (SELECT json_group_array(json_object('name', bc.name, 'color', bc.color))
         FROM book_category_assignments bca JOIN book_categories bc ON bc.id = bca.category_id AND bc.user_id = bca.user_id
         WHERE bca.book_id = b.id AND bca.user_id = b.user_id) AS categories
      FROM books b WHERE b.user_id = ? AND COALESCE(b.is_encrypted, 0) = 0
      ORDER BY COALESCE(b.last_opened_at, b.created_at) DESC LIMIT ?
    `).all(user.id, limit) as KnowledgeGraphBookRow[]
    const annotations = db.prepare(`
      SELECT a.id, a.book_id, b.title AS book_title, a.type, a.page, a.content, ac.name AS category_label
      FROM annotations a JOIN books b ON b.id = a.book_id AND b.user_id = a.user_id
      LEFT JOIN annotation_categories ac ON ac.id = json_extract(a.content, '$.categoryId') AND ac.user_id = a.user_id
      WHERE a.user_id = ? AND COALESCE(b.is_encrypted, 0) = 0
      ORDER BY COALESCE(a.updated_at, a.created_at) DESC, a.id DESC LIMIT ?
    `).all(user.id, Math.min(1000, limit * 4)) as KnowledgeGraphAnnotationRow[]
    return NextResponse.json(buildKnowledgeGraph(books, annotations.map(row => ({ ...row, content: parse(row.content) as Record<string, unknown> }))))
  } catch (error) {
    console.error('[knowledge-graph GET]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
