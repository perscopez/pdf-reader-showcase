import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  createResearchNotebookRepository,
  notebookExportFilename,
  serializeNotebookForExport,
  type ResearchNotebookExportFormat,
} from '@/lib/researchNotebooks'

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
  const rawFormat = req.nextUrl.searchParams.get('format') || 'markdown'
  if (rawFormat !== 'markdown' && rawFormat !== 'json') return NextResponse.json({ error: 'format must be markdown or json' }, { status: 400 })
  const notebook = repository.get(user.id, notebookId)
  if (!notebook) return NextResponse.json({ error: 'Notebook not found' }, { status: 404 })
  const format = rawFormat as ResearchNotebookExportFormat
  const body = serializeNotebookForExport(notebook, format)
  return new NextResponse(body, {
    headers: {
      'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${notebookExportFilename(notebook.title, format)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
