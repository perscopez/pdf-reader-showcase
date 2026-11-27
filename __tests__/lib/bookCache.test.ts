import { describe, expect, it } from 'vitest'
import { planBookCacheReconciliation, visibleBookRecords } from '@/lib/bookCache'

const synced = (local_id: number, server_id: number | null, title: string, author = 'Author') => ({
  local_id,
  server_id,
  title,
  author,
  local_status: 'synced' as const,
  updated_at: `2026-06-21T00:00:0${local_id}.000Z`,
})

describe('book cache reconciliation', () => {
  it('removes synced rows for server books that no longer exist', () => {
    const plan = planBookCacheReconciliation(
      [synced(1, 10, 'Keep'), synced(2, 11, 'Removed')],
      [{ id: 10, title: 'Keep', updated_at: '2026-06-21T01:00:00.000Z' }],
    )

    expect(plan.deleteLocalIds).toContain(2)
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].local_id).toBe(1)
  })

  it('collapses repeated local rows for the same server id', () => {
    const plan = planBookCacheReconciliation(
      [synced(1, 10, 'Book'), synced(2, 10, 'Book')],
      [{ id: 10, title: 'Book', updated_at: '2026-06-21T01:00:00.000Z' }],
    )

    expect(plan.deleteLocalIds).toEqual([1])
    expect(plan.upserts[0].local_id).toBe(2)
  })

  it('preserves dirty offline edits while deleting duplicate synced rows', () => {
    const dirty = { ...synced(3, 10, 'Offline title'), local_status: 'updated' as const }
    const plan = planBookCacheReconciliation(
      [synced(1, 10, 'Server title'), dirty],
      [{ id: 10, title: 'Server title', updated_at: '2026-06-21T01:00:00.000Z' }],
    )

    expect(plan.deleteLocalIds).toEqual([1])
    expect(plan.upserts).toEqual([])
  })

  it('hides historical synced duplicates by normalized title and author before fetch completes', () => {
    const visible = visibleBookRecords([
      synced(1, 10, ' Yeraltından   Notlar ', 'Fyodor Dostoyevski'),
      synced(2, 11, 'yeraltından notlar', 'FYODOR DOSTOYEVSKİ'),
      synced(3, 12, 'Böyle Buyurdu Zerdüşt', 'Friedrich Nietzsche'),
    ])

    expect(visible).toHaveLength(2)
    expect(visible.map(book => book.local_id)).toContain(2)
  })
})
