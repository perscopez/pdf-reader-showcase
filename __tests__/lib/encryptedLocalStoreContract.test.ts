import fs from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  withStoresTransaction: vi.fn(),
  deleted: [] as Array<{ store: string; key: IDBValidKey }>,
}))

function request<T>(result: T): IDBRequest<T> {
  const value = { result, error: null } as unknown as IDBRequest<T>
  queueMicrotask(() => value.onsuccess?.(new Event('success')))
  return value
}

function transactionStore(name: string, rows: Map<IDBValidKey, { book_id: number }>) {
  return {
    index: (indexName: string) => {
      expect(indexName).toBe('book_id')
      return {
        getAllKeys: (bookId: number) => request(
          [...rows].filter(([, row]) => row.book_id === bookId).map(([key]) => key),
        ),
      }
    },
    delete: (key: IDBValidKey) => {
      mocks.deleted.push({ store: name, key })
      rows.delete(key)
      return request(undefined)
    },
  } as unknown as IDBObjectStore
}

vi.mock('@/lib/indexedDb', () => ({
  getStore: (...args: unknown[]) => mocks.getStore(...args),
  withStoresTransaction: (...args: unknown[]) => mocks.withStoresTransaction(...args),
}))

import { deleteEncryptedBookDerivatives } from '@/lib/encryptedReaderStore'

describe('encrypted local derivative storage contract', () => {
  beforeEach(() => {
    mocks.deleted.length = 0
    mocks.getStore.mockReset()
    mocks.withStoresTransaction.mockReset()
  })

  it('deletes all derivatives for one book in one multi-store readwrite transaction', async () => {
    const names = [
      'encrypted_page_text',
      'encrypted_annotations',
      'encrypted_annotation_assets',
      'encrypted_bookmarks',
      'encrypted_words',
    ]
    const rows = new Map<string, Map<IDBValidKey, { book_id: number }>>()
    names.forEach(name => rows.set(name, new Map([
      [`${name}:target`, { book_id: 12 }],
      [`${name}:other`, { book_id: 99 }],
    ])))

    mocks.withStoresTransaction.mockImplementation(async (
      storeNames: string[],
      mode: IDBTransactionMode,
      operation: (transaction: IDBTransaction) => Promise<unknown>,
    ) => {
      expect(storeNames).toEqual(names)
      expect(mode).toBe('readwrite')
      const transaction = {
        objectStore: (name: string) => transactionStore(name, rows.get(name)!),
      } as unknown as IDBTransaction
      return operation(transaction)
    })

    await deleteEncryptedBookDerivatives(12)

    expect(mocks.withStoresTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.getStore).not.toHaveBeenCalled()
    expect(mocks.deleted).toHaveLength(5)
    expect(mocks.deleted.every(item => String(item.key).endsWith(':target'))).toBe(true)
    expect([...rows.values()].every(storeRows => (
      [...storeRows.values()].every(row => row.book_id === 99)
    ))).toBe(true)
  })

  it('filters device-local encrypted words against the current account owned-book snapshot', async () => {
    const source = await fs.readFile(path.join(process.cwd(), 'app/words/page.tsx'), 'utf8')

    expect(source).toContain("fetch('/api/books')")
    expect(source).toMatch(/localWords\s*\.filter\(word\s*=>\s*ownedBookTitles\.has\(word\.source_book_id\)\)/)
    expect(source).toContain('local_encrypted?: boolean')
    expect(source).toContain('if (word.local_encrypted) return')
  })
})
