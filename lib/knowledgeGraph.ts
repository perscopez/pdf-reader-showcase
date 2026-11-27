import { buildAnnotationDeepLink } from '@/lib/annotations'

export type KnowledgeGraphBookRow = {
  id: number
  title: string
  author?: string | null
  tags?: string | null
  category?: string | null
  categories?: string | null
}

export type KnowledgeGraphAnnotationRow = {
  id: number
  book_id: number
  book_title: string
  type: string
  page: number
  content: string | Record<string, unknown>
  category_label?: string | null
}

export type KnowledgeGraphNode = {
  id: string
  type: 'book' | 'concept' | 'annotation'
  label: string
  subtitle?: string
  count?: number
  href?: string
  sourceLinks?: Array<{ label: string; href: string }>
  bookId?: number
  annotationId?: number
  annotationType?: string
  page?: number
}

export type KnowledgeGraphEdge = {
  id: string
  source: string
  target: string
  kind: 'book-concept' | 'book-annotation' | 'annotation-concept' | 'book-backlink'
}

export type KnowledgeGraph = {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  stats: { books: number; concepts: number; annotations: number; backlinks: number }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

function cleanLabel(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function conceptKey(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('tr-TR').trim()
}

function listValues(value: unknown): string[] {
  const parsed = parseJson(value)
  if (Array.isArray(parsed)) return parsed.map(item => item && typeof item === 'object' && 'name' in item ? cleanLabel((item as { name?: unknown }).name) : cleanLabel(item)).filter(Boolean)
  if (parsed && typeof parsed === 'object' && 'name' in parsed) return [cleanLabel((parsed as { name?: unknown }).name)].filter(Boolean)
  const label = cleanLabel(parsed)
  return label ? [label] : []
}

function addEdge(edges: KnowledgeGraphEdge[], seen: Set<string>, source: string, target: string, kind: KnowledgeGraphEdge['kind']) {
  const id = `${kind}:${source}:${target}`
  if (!seen.has(id)) { seen.add(id); edges.push({ id, source, target, kind }) }
}

export function buildKnowledgeGraph(books: KnowledgeGraphBookRow[], annotations: KnowledgeGraphAnnotationRow[]): KnowledgeGraph {
  const nodes: KnowledgeGraphNode[] = []
  const edges: KnowledgeGraphEdge[] = []
  const edgeIds = new Set<string>()
  const concepts = new Map<string, KnowledgeGraphNode>()
  const bookConcepts = new Map<number, Set<string>>()
  const bookIds = new Set(books.map(book => book.id))

  for (const book of books) {
    nodes.push({ id: `book:${book.id}`, type: 'book', label: cleanLabel(book.title) || `Book #${book.id}`, subtitle: cleanLabel(book.author), bookId: book.id, href: `/reader/${book.id}` })
    const names = [...listValues(book.tags), ...listValues(book.category), ...listValues(book.categories)]
    const keys = new Set<string>()
    for (const name of names) {
      const key = conceptKey(name)
      if (!key || keys.has(key)) continue
      keys.add(key)
      bookConcepts.set(book.id, keys)
      let concept = concepts.get(key)
      if (!concept) {
        concept = { id: `concept:${key}`, type: 'concept', label: name, count: 0 }
        concepts.set(key, concept)
        nodes.push(concept)
      }
      concept.count = (concept.count || 0) + 1
      addEdge(edges, edgeIds, `book:${book.id}`, concept.id, 'book-concept')
    }
  }

  const annotationNodes = annotations.filter(annotation => bookIds.has(annotation.book_id))
  for (const annotation of annotationNodes) {
    const content = (parseJson(annotation.content) || {}) as Record<string, unknown>
    const text = cleanLabel(content.note || content.text || content.source || '')
    const sourceCount = Array.isArray(content.sources) ? content.sources.length : 0
    const label = text || (annotation.type === 'highlight' ? 'Highlight' : 'Note')
    const node: KnowledgeGraphNode = {
      id: `annotation:${annotation.id}`, type: 'annotation', label,
      subtitle: `${annotation.book_title} · p. ${annotation.page}${sourceCount > 1 ? ` · ${sourceCount} sources` : ''}`,
      bookId: annotation.book_id, annotationId: annotation.id, annotationType: annotation.type, page: annotation.page,
      href: buildAnnotationDeepLink(annotation.book_id, annotation.page, annotation.id),
    }
    if (Array.isArray(content.sources) && content.sources.length > 0) {
      node.sourceLinks = content.sources.map((source, sourceIndex) => ({
        label: `p. ${Number(source?.page) || annotation.page}${cleanLabel(source?.text) ? ` · ${cleanLabel(source.text).slice(0, 32)}` : ''}`,
        href: buildAnnotationDeepLink(annotation.book_id, Number(source?.page) || annotation.page, annotation.id, sourceIndex),
      }))
    }
    nodes.push(node)
    addEdge(edges, edgeIds, `book:${annotation.book_id}`, node.id, 'book-annotation')

    const names = [...listValues(content.tags), ...listValues(content.categoryLabel), ...listValues(annotation.category_label)]
    for (const name of names) {
      const key = conceptKey(name)
      if (!key) continue
      let concept = concepts.get(key)
      if (!concept) {
        concept = { id: `concept:${key}`, type: 'concept', label: name, count: 0 }
        concepts.set(key, concept)
        nodes.push(concept)
      }
      concept.count = (concept.count || 0) + 1
      addEdge(edges, edgeIds, node.id, concept.id, 'annotation-concept')
    }
  }

  const conceptToBooks = new Map<string, number[]>()
  for (const [bookId, keys] of bookConcepts) for (const key of keys) conceptToBooks.set(key, [...(conceptToBooks.get(key) || []), bookId])
  let backlinks = 0
  for (const ids of conceptToBooks.values()) {
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      addEdge(edges, edgeIds, `book:${ids[i]}`, `book:${ids[j]}`, 'book-backlink')
      backlinks++
    }
  }
  return { nodes, edges, stats: { books: books.length, concepts: concepts.size, annotations: annotationNodes.length, backlinks } }
}
