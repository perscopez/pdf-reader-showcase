import { describe, expect, it } from 'vitest'
import { buildKnowledgeGraph } from '@/lib/knowledgeGraph'

describe('knowledge graph construction', () => {
  it('connects owned books through normalized tags and exact annotation links', () => {
    const graph = buildKnowledgeGraph([
      { id: 1, title: 'Birinci', tags: '["Felsefe", " ortak "]', category: 'Deneme' },
      { id: 2, title: 'İkinci', tags: '["ORTAK"]', categories: '[{"name":"Araştırma"}]' },
    ], [{ id: 9, book_id: 1, book_title: 'Birinci', type: 'note', page: 12, content: { note: 'Bir düşünce', tags: ['Ortak'], sources: [{ page: 12 }, { page: 18 }] } }])

    expect(graph.stats).toEqual({ books: 2, concepts: 4, annotations: 1, backlinks: 1 })
    expect(graph.nodes.find(node => node.id === 'annotation:9')).toMatchObject({ href: '/reader/1?page=12&annotation=9', subtitle: 'Birinci · p. 12 · 2 sources', sourceLinks: [{ href: '/reader/1?page=12&annotation=9&source=0' }, { href: '/reader/1?page=18&annotation=9&source=1' }] })
    expect(graph.edges.some(edge => edge.kind === 'book-backlink' && edge.source === 'book:1' && edge.target === 'book:2')).toBe(true)
  })

  it('does not create annotation or backlink edges for books outside the supplied ownership scope', () => {
    const graph = buildKnowledgeGraph([{ id: 1, title: 'Mine', tags: '["same"]' }], [
      { id: 10, book_id: 2, book_title: 'Other', type: 'highlight', page: 1, content: { text: 'secret' } },
    ])
    expect(graph.stats.annotations).toBe(0)
    expect(graph.nodes.map(node => node.id)).not.toContain('annotation:10')
    expect(graph.edges.some(edge => edge.kind === 'book-backlink')).toBe(false)
  })
})
