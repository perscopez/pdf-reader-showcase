import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  createResearchNotebookRepository,
  normalizeNotebookCommentary,
  normalizeNotebookHeading,
  normalizeNotebookItemInput,
  ResearchNotebookError,
} from '@/lib/researchNotebooks'

const repository = createResearchNotebookRepository()

function parseId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function errorResponse(error: unknown) {
  if (!(error instanceof ResearchNotebookError)) return NextResponse.json({ error: 'Notebook operation failed' }, { status: 500 })
  const status = error.code === 'not_found' ? 404 : error.code === 'encrypted_source' ? 422 : error.code === 'duplicate_item' ? 409 : 400
  return NextResponse.json({ error: error.message, code: error.code }, { status })
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const notebookId = parseId((await context.params).id)
  if (!notebookId) return NextResponse.json({ error: 'Invalid notebook id' }, { status: 400 })
  let input: ReturnType<typeof normalizeNotebookItemInput>
  try { input = normalizeNotebookItemInput(await req.json()) } catch { input = null }
  if (!input) return NextResponse.json({ error: 'Invalid notebook item' }, { status: 400 })
  try {
    return NextResponse.json(repository.addItem(user.id, notebookId, input), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const notebookId = parseId((await context.params).id)
  if (!notebookId) return NextResponse.json({ error: 'Invalid notebook id' }, { status: 400 })
  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const itemId = Number(body.item_id ?? body.itemId)
  if (!Number.isInteger(itemId) || itemId <= 0) return NextResponse.json({ error: 'Invalid item id' }, { status: 400 })
  const notebook = repository.updateItem(user.id, notebookId, itemId, {
    heading: normalizeNotebookHeading(body.heading),
    commentary: normalizeNotebookCommentary(body.commentary),
  })
  return notebook ? NextResponse.json(notebook) : NextResponse.json({ error: 'Notebook item not found' }, { status: 404 })
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const notebookId = parseId((await context.params).id)
  const itemId = parseId(req.nextUrl.searchParams.get('item_id') || '')
  if (!notebookId || !itemId) return NextResponse.json({ error: 'Invalid notebook or item id' }, { status: 400 })
  return repository.deleteItem(user.id, notebookId, itemId)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Notebook item not found' }, { status: 404 })
}
