import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { permanentlyDeleteTrashItem } from '@/lib/trash'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const trashId = Number((await params).id)
  if (!Number.isInteger(trashId) || trashId < 1) return NextResponse.json({ error: 'Invalid trash ID' }, { status: 400 })
  try {
    const deleted = await permanentlyDeleteTrashItem(user.id, trashId)
    return deleted
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) {
    console.error('[trash DELETE]', error)
    return NextResponse.json({ error: 'Permanent deletion failed' }, { status: 500 })
  }
}
