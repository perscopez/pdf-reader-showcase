'use client'

import type { Annotation, BookmarkRow } from '@/components/ReaderTypes'
import { isValidPageTextModel, type PageTextModel } from '@/lib/pdfTextModel'
import { getStore, withStoresTransaction } from '@/lib/indexedDb'

type StoredPageText = {
  key: string
  book_id: number
  page: number
  model: PageTextModel
  updated_at: string
}

type StoredAnnotation = {
  key: string
  book_id: number
  annotation: Annotation
  updated_at: string
}

type StoredAnnotationAsset = {
  key: string
  book_id: number
  data_url: string
  created_at: string
}

type StoredBookmark = {
  key: string
  book_id: number
  bookmark: BookmarkRow
  updated_at: string
}

export type EncryptedWordInput = {
  word: string
  definition: string
  context: string
  source_page: number
}

export type EncryptedWord = EncryptedWordInput & {
  id: number
  source_book_id: number
  book_title: null
  local_encrypted: true
  created_at: string
  updated_at: string
}

export type EncryptedAnnotationInput = Omit<Annotation, 'id' | 'created_at' | 'updated_at'> & {
  id?: number
}

function requireBookId(bookId: number) {
  if (!Number.isInteger(bookId) || bookId < 1) throw new Error('Invalid encrypted book ID')
}

function pageKey(bookId: number, page: number) {
  return `${bookId}:${page}`
}

function annotationKey(bookId: number, id: number) {
  return `${bookId}:${id}`
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function randomLocalAnnotationId() {
  const bytes = new Uint32Array(2)
  crypto.getRandomValues(bytes)
  // Negative IDs cannot collide with server-generated SQLite IDs and continue
  // to satisfy the reader's existing numeric annotation contract.
  return -Math.max(1, bytes[0] * 2_097_152 + (bytes[1] & 0x1fffff))
}

export async function getEncryptedPageText(bookId: number, page: number): Promise<PageTextModel | null> {
  requireBookId(bookId)
  if (!Number.isInteger(page) || page < 1) return null
  const store = await getStore('encrypted_page_text', 'readonly')
  const row = await requestResult(store.get(pageKey(bookId, page))) as StoredPageText | undefined
  return row?.model && isValidPageTextModel(row.model) && row.model.provenance.rotation === 0
    ? row.model
    : null
}

export async function putEncryptedPageText(bookId: number, page: number, model: PageTextModel): Promise<void> {
  requireBookId(bookId)
  if (!Number.isInteger(page) || page < 1) throw new Error('Invalid page number')
  if (!isValidPageTextModel(model) || model.provenance.rotation !== 0) {
    throw new Error('Invalid canonical page text model')
  }
  const store = await getStore('encrypted_page_text', 'readwrite')
  await requestResult(store.put({
    key: pageKey(bookId, page),
    book_id: bookId,
    page,
    model,
    updated_at: new Date().toISOString(),
  } satisfies StoredPageText))
}

export async function listEncryptedAnnotations(bookId: number): Promise<Annotation[]> {
  requireBookId(bookId)
  const store = await getStore('encrypted_annotations', 'readonly')
  const rows = await requestResult(store.index('book_id').getAll(bookId)) as StoredAnnotation[]
  return rows.map(row => row.annotation).sort((a, b) => a.page - b.page || a.id - b.id)
}

export async function saveEncryptedAnnotation(bookId: number, input: EncryptedAnnotationInput): Promise<Annotation> {
  requireBookId(bookId)
  const now = new Date().toISOString()
  const id = input.id ?? randomLocalAnnotationId()
  const key = annotationKey(bookId, id)
  const readStore = await getStore('encrypted_annotations', 'readonly')
  const current = await requestResult(readStore.get(key)) as StoredAnnotation | undefined
  const annotation: Annotation = {
    ...input,
    content: { ...current?.annotation.content, ...input.content },
    id,
    created_at: current?.annotation.created_at ?? now,
    updated_at: now,
  }
  const store = await getStore('encrypted_annotations', 'readwrite')
  await requestResult(store.put({ key, book_id: bookId, annotation, updated_at: now } satisfies StoredAnnotation))
  return annotation
}

export async function deleteEncryptedAnnotation(bookId: number, id: number): Promise<void> {
  requireBookId(bookId)
  const readStore = await getStore('encrypted_annotations', 'readonly')
  const current = await requestResult(readStore.get(annotationKey(bookId, id))) as StoredAnnotation | undefined
  const store = await getStore('encrypted_annotations', 'readwrite')
  await requestResult(store.delete(annotationKey(bookId, id)))
  if (current) {
    await Promise.all(annotationPreviewDataUrls(current.annotation).map(dataUrl =>
      deleteEncryptedAnnotationPreview(bookId, dataUrl)
    ))
  }
}

export async function putEncryptedAnnotationPreview(bookId: number, dataUrl: string): Promise<string> {
  requireBookId(bookId)
  if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new Error('Invalid encrypted annotation preview')
  }
  if (dataUrl.length > 2_800_000) throw new Error('Encrypted annotation preview is too large')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl))
  const assetId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const store = await getStore('encrypted_annotation_assets', 'readwrite')
  await requestResult(store.put({
    key: `${bookId}:${assetId}`,
    book_id: bookId,
    data_url: dataUrl,
    created_at: new Date().toISOString(),
  } satisfies StoredAnnotationAsset))
  // A data URL remains renderable after reload without creating a plaintext
  // server asset or a short-lived object URL. It stays inside IndexedDB and the
  // local annotation record only.
  return dataUrl
}

export async function deleteEncryptedAnnotationPreview(bookId: number, dataUrl: string): Promise<void> {
  requireBookId(bookId)
  if (!dataUrl.startsWith('data:image/')) return
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl))
  const assetId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const store = await getStore('encrypted_annotation_assets', 'readwrite')
  await requestResult(store.delete(`${bookId}:${assetId}`))
}

function annotationPreviewDataUrls(annotation: Annotation) {
  const urls = [
    annotation.content.area?.previewUrl,
    ...(annotation.content.sources || []).map(source => source.area?.previewUrl),
  ]
  return urls.filter((url): url is string => typeof url === 'string' && url.startsWith('data:image/'))
}

export async function listEncryptedBookmarks(bookId: number): Promise<BookmarkRow[]> {
  requireBookId(bookId)
  const store = await getStore('encrypted_bookmarks', 'readonly')
  const rows = await requestResult(store.index('book_id').getAll(bookId)) as StoredBookmark[]
  return rows.map(row => row.bookmark).sort((a, b) => a.page - b.page)
}

export async function saveEncryptedBookmark(bookId: number, page: number, label = ''): Promise<BookmarkRow> {
  requireBookId(bookId)
  if (!Number.isInteger(page) || page < 1) throw new Error('Invalid bookmark page')
  const bookmark: BookmarkRow = { id: randomLocalAnnotationId(), page, label }
  const store = await getStore('encrypted_bookmarks', 'readwrite')
  await requestResult(store.put({
    key: annotationKey(bookId, bookmark.id),
    book_id: bookId,
    bookmark,
    updated_at: new Date().toISOString(),
  } satisfies StoredBookmark))
  return bookmark
}

export async function deleteEncryptedBookmark(bookId: number, id: number): Promise<void> {
  requireBookId(bookId)
  const store = await getStore('encrypted_bookmarks', 'readwrite')
  await requestResult(store.delete(annotationKey(bookId, id)))
}

export async function saveEncryptedWord(bookId: number, input: EncryptedWordInput): Promise<EncryptedWord> {
  requireBookId(bookId)
  const now = new Date().toISOString()
  const word: EncryptedWord = {
    ...input,
    id: randomLocalAnnotationId(),
    source_book_id: bookId,
    book_title: null,
    local_encrypted: true,
    created_at: now,
    updated_at: now,
  }
  const store = await getStore('encrypted_words', 'readwrite')
  await requestResult(store.put({ key: annotationKey(bookId, word.id), book_id: bookId, word }))
  return word
}

export async function listEncryptedWords(): Promise<EncryptedWord[]> {
  const store = await getStore('encrypted_words', 'readonly')
  const rows = await requestResult(store.getAll()) as { word: EncryptedWord }[]
  return rows.map(row => row.word).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function updateEncryptedWord(
  bookId: number,
  id: number,
  patch: Partial<Pick<EncryptedWord, 'word' | 'definition' | 'context'>>,
): Promise<EncryptedWord | null> {
  requireBookId(bookId)
  const key = annotationKey(bookId, id)
  const readStore = await getStore('encrypted_words', 'readonly')
  const current = await requestResult(readStore.get(key)) as { key: string; book_id: number; word: EncryptedWord } | undefined
  if (!current) return null
  const word = { ...current.word, ...patch, updated_at: new Date().toISOString() }
  const store = await getStore('encrypted_words', 'readwrite')
  await requestResult(store.put({ ...current, word }))
  return word
}

export async function deleteEncryptedWord(bookId: number, id: number): Promise<void> {
  requireBookId(bookId)
  const store = await getStore('encrypted_words', 'readwrite')
  await requestResult(store.delete(annotationKey(bookId, id)))
}

export async function deleteEncryptedBookDerivatives(bookId: number): Promise<void> {
  requireBookId(bookId)
  const storeNames = [
    'encrypted_page_text',
    'encrypted_annotations',
    'encrypted_annotation_assets',
    'encrypted_bookmarks',
    'encrypted_words',
  ]
  await withStoresTransaction(storeNames, 'readwrite', transaction => Promise.all(
    storeNames.map(storeName => deleteBookRows(transaction.objectStore(storeName), bookId))
  ))
}

async function deleteBookRows(store: IDBObjectStore, bookId: number) {
  const keys = await requestResult(store.index('book_id').getAllKeys(bookId))
  await Promise.all(keys.map(key => requestResult(store.delete(key))))
}
