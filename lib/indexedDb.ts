'use client'

import { planBookCacheReconciliation, type ServerBookRecord } from '@/lib/bookCache'

export const DB_NAME = 'pdflibrary_local'
export const DB_VERSION = 2

export type LocalStatus = 'synced' | 'created' | 'updated' | 'deleted'

export interface LocalRecord {
  local_id?: number
  server_id?: number | null
  local_status: LocalStatus
  updated_at: string
  [key: string]: unknown
}

let dbInstance: IDBDatabase | null = null

export function initDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB is only available in the browser'))
  }
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      
      // Syncable entity stores
      const syncStores = ['books', 'annotations', 'bookmarks', 'word_library', 'reading_sessions']
      for (const storeName of syncStores) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'local_id', autoIncrement: true })
          store.createIndex('server_id', 'server_id', { unique: false })
          store.createIndex('local_status', 'local_status', { unique: false })
          if (['annotations', 'bookmarks', 'reading_sessions'].includes(storeName)) {
            store.createIndex('book_id', 'book_id', { unique: false })
          }
        }
      }

      // Offline book files cache store (stores the encrypted file Blob)
      if (!db.objectStoreNames.contains('book_files')) {
        db.createObjectStore('book_files', { keyPath: 'book_filename' })
      }

      // Sync metadata store
      if (!db.objectStoreNames.contains('sync_meta')) {
        db.createObjectStore('sync_meta', { keyPath: 'key' })
      }

      // Decrypted derivative data for E2EE books must never enter the syncable
      // stores above. These stores are device-local and are intentionally not
      // referenced by the sync engine.
      if (!db.objectStoreNames.contains('encrypted_page_text')) {
        const store = db.createObjectStore('encrypted_page_text', { keyPath: 'key' })
        store.createIndex('book_id', 'book_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('encrypted_annotations')) {
        const store = db.createObjectStore('encrypted_annotations', { keyPath: 'key' })
        store.createIndex('book_id', 'book_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('encrypted_annotation_assets')) {
        const store = db.createObjectStore('encrypted_annotation_assets', { keyPath: 'key' })
        store.createIndex('book_id', 'book_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('encrypted_bookmarks')) {
        const store = db.createObjectStore('encrypted_bookmarks', { keyPath: 'key' })
        store.createIndex('book_id', 'book_id', { unique: false })
      }
      if (!db.objectStoreNames.contains('encrypted_words')) {
        const store = db.createObjectStore('encrypted_words', { keyPath: 'key' })
        store.createIndex('book_id', 'book_id', { unique: false })
      }
    }

    request.onsuccess = () => {
      dbInstance = request.result
      dbInstance.onversionchange = () => {
        dbInstance?.close()
        dbInstance = null
      }
      resolve(dbInstance)
    }

    request.onerror = () => {
      reject(request.error)
    }
  })
}

// Transaction Helpers
export async function getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  const db = await initDb()
  const tx = db.transaction(storeName, mode)
  return tx.objectStore(storeName)
}

export async function withStoresTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  const database = await initDb()
  const transaction = database.transaction(storeNames, mode)
  const completed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
  try {
    const result = await operation(transaction)
    await completed
    return result
  } catch (error) {
    try { transaction.abort() } catch { /* already completed */ }
    throw error
  }
}

export async function getAllFromStore<T = LocalRecord>(storeName: string): Promise<T[]> {
  const store = await getStore(storeName, 'readonly')
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
  })
}

export async function getFromStore<T = LocalRecord>(storeName: string, id: number): Promise<T | null> {
  const store = await getStore(storeName, 'readonly')
  return new Promise((resolve, reject) => {
    const request = store.get(id)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

export async function getByServerId<T = LocalRecord>(storeName: string, serverId: number): Promise<T | null> {
  const store = await getStore(storeName, 'readonly')
  const index = store.index('server_id')
  return new Promise((resolve, reject) => {
    const request = index.get(serverId)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
}

export async function getDirtyRecords<T = LocalRecord>(storeName: string): Promise<T[]> {
  const store = await getStore(storeName, 'readonly')
  const index = store.index('local_status')
  
  const statuses: LocalStatus[] = ['created', 'updated', 'deleted']
  const results: T[] = []

  for (const status of statuses) {
    const batch = await new Promise<T[]>((resolve, reject) => {
      const request = index.getAll(status)
      request.onsuccess = () => resolve(request.result as T[])
      request.onerror = () => reject(request.error)
    })
    results.push(...batch)
  }

  return results
}

export async function putToStore(storeName: string, record: Partial<LocalRecord>): Promise<number> {
  const store = await getStore(storeName, 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.put(record)
    request.onsuccess = () => resolve(request.result as number)
    request.onerror = () => reject(request.error)
  })
}

export async function deleteFromStore(storeName: string, localId: number): Promise<void> {
  const store = await getStore(storeName, 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.delete(localId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function reconcileBooksWithServer(serverBooks: ServerBookRecord[]): Promise<void> {
  const localBooks = await getAllFromStore<LocalRecord>('books')
  const plan = planBookCacheReconciliation(localBooks, serverBooks)
  for (const localId of plan.deleteLocalIds) await deleteFromStore('books', localId)
  for (const record of plan.upserts) await putToStore('books', record)
}

// Book File Cache Helpers
export async function getBookFile(filename: string): Promise<Blob | null> {
  const store = await getStore('book_files', 'readonly')
  return new Promise((resolve, reject) => {
    const request = store.get(filename)
    request.onsuccess = () => resolve(request.result?.blob || null)
    request.onerror = () => reject(request.error)
  })
}

export async function saveBookFile(filename: string, blob: Blob): Promise<void> {
  const store = await getStore('book_files', 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.put({ book_filename: filename, blob })
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export async function deleteBookFile(filename: string): Promise<void> {
  const store = await getStore('book_files', 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.delete(filename)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// Sync Metadata Helpers
export async function getSyncMeta(key: string): Promise<string | null> {
  const store = await getStore('sync_meta', 'readonly')
  return new Promise((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result?.value || null)
    request.onerror = () => reject(request.error)
  })
}

export async function saveSyncMeta(key: string, value: string): Promise<void> {
  const store = await getStore('sync_meta', 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.put({ key, value })
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}
