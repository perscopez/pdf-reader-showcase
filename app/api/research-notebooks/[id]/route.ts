import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createResearchNotebookRepository, normalizeNotebookTitle } from '@/lib/researchNotebooks'

const repository = createResearchNotebookRepository()

function parseId(value: string) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const notebookId = parseId((await context.params).id)
  if (!notebookId) return NextResponse.json({ error: 'Invalid notebook id' }, { status: 400 })
  const notebook = repository.get(user.id, notebookId)
  return notebook ? NextResponse.json(notebook) : NextResponse.json({ error: 'Notebook not found' }, { status: 404 })
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const notebookId = parseId((await context.params).id)
  if (!notebookId) return NextResponse.json({ error: 'Invalid notebook id' }, { status: 400 })
  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!normalizeNotebookTitle(body.title)) return NextResponse.json({ error: 'Notebook title is required' }, { status: 400 })
  const notebook = repository.update(user.id, notebookId, body.title)
  return notebook ? NextResponse.json(notebook) : NextResponse.json({ error: 'Notebook not found' }, { status: 404 })
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const notebookId = parseId((await context.params).id)
  if (!notebookId) return NextResponse.json({ error: 'Invalid notebook id' }, { status: 400 })
  return repository.delete(user.id, notebookId)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Notebook not found' }, { status: 404 })
}
