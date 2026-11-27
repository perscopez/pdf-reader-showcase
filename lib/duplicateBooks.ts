import { cleanText } from '@/lib/text'

export function normalizeBookKey(title: string, author: string): string {
  return `${cleanText(title).toLocaleLowerCase().trim()}::${cleanText(author).toLocaleLowerCase().trim()}`
}

export function findDuplicateBooks<T extends { id: number; title: string; author: string }>(
  books: T[],
  title: string,
  author: string,
): T[] {
  const key = normalizeBookKey(title, author)
  if (!key.replace(/::/g, '').trim()) return []
  return books.filter(book => normalizeBookKey(book.title, book.author) === key)
}

export function groupDuplicateBooks<T extends { id: number; title: string; author: string }>(books: T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const book of books) {
    const key = normalizeBookKey(book.title, book.author)
    if (!key.replace(/::/g, '').trim()) continue
    const current = groups.get(key) || []
    current.push(book)
    groups.set(key, current)
  }
  return Array.from(groups.values()).filter(group => group.length > 1)
}
