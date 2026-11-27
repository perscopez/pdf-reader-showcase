import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createResearchNotebookRepository, normalizeNotebookTitle } from '@/lib/researchNotebooks'

const repository = createResearchNotebookRepository()

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  return NextResponse.json(repository.list(user.id))
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!normalizeNotebookTitle(body.title)) return NextResponse.json({ error: 'Notebook title is required' }, { status: 400 })
  try {
    return NextResponse.json(repository.create(user.id, body.title), { status: 201 })
  } catch (error) {
    console.error('[research-notebooks POST]', error)
    return NextResponse.json({ error: 'Notebook could not be created' }, { status: 500 })
  }
}
