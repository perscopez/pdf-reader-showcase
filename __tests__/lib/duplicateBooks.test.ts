import { describe, expect, it } from 'vitest'
import { findDuplicateBooks, groupDuplicateBooks } from '@/lib/duplicateBooks'

const books = [
  { id: 1, title: 'Nutuk', author: 'Atatürk' },
  { id: 2, title: 'nutuk', author: 'atatürk' },
  { id: 3, title: 'Other', author: 'Writer' },
]

describe('duplicateBooks', () => {
  it('finds normalized title+author duplicates', () => {
    expect(findDuplicateBooks(books, 'Nutuk', 'Atatürk').map(book => book.id)).toEqual([1, 2])
  })

  it('groups duplicate books', () => {
    expect(groupDuplicateBooks(books)).toEqual([[books[0], books[1]]])
  })
})
