import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createResearchNotebookRepository, normalizeNotebookOrder, ResearchNotebookError } from '@/lib/researchNotebooks'

const repository = createResearchNotebookRepository()

function parseId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const notebookId = parseId((await context.params).id)
  if (!notebookId) return NextResponse.json({ error: 'Invalid notebook id' }, { status: 400 })
  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const itemIds = normalizeNotebookOrder(body.item_ids ?? body.itemIds)
  if (!itemIds) return NextResponse.json({ error: 'Invalid item order' }, { status: 400 })
  try {
    const notebook = repository.reorder(user.id, notebookId, itemIds)
    return notebook ? NextResponse.json(notebook) : NextResponse.json({ error: 'Notebook not found' }, { status: 404 })
  } catch (error) {
    if (error instanceof ResearchNotebookError) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
    return NextResponse.json({ error: 'Notebook reorder failed' }, { status: 500 })
  }
}
