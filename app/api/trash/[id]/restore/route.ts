import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { restoreBookTrashItem } from '@/lib/trash'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const trashId = Number((await params).id)
  if (!Number.isInteger(trashId) || trashId < 1) return NextResponse.json({ error: 'Invalid trash ID' }, { status: 400 })
  try {
    const result = await restoreBookTrashItem(user.id, trashId)
    if (result.status === 'missing') return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (result.status === 'file_missing') return NextResponse.json({ error: 'Original book file is missing' }, { status: 409 })
    if (result.status === 'conflict') return NextResponse.json({ error: 'A book with this file already exists' }, { status: 409 })
    if (result.status === 'invalid') return NextResponse.json({ error: 'Trash snapshot is invalid' }, { status: 422 })
    return NextResponse.json({ success: true, book_id: result.bookId })
  } catch (error) {
    console.error('[trash restore]', error)
    return NextResponse.json({ error: 'Restore failed' }, { status: 500 })
  }
}
