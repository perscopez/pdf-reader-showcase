'use client'

import { useCallback, useEffect, useState } from 'react'
import { LibraryTheme } from '@/lib/libraryTheme'
import { THEME_STORAGE } from '@/lib/themePreferences'
import { useRouter, useSearchParams } from 'next/navigation'
import { useVault } from '@/components/VaultContext'
import { useI18n } from '@/components/I18nProvider'
import { unwrapKey } from '@/lib/crypto'
import { fetchWithTimeout } from '@/lib/request'
import {
  initDb,
  getFromStore,
  putToStore,
  getByServerId,
  getBookFile,
  saveBookFile,
  deleteBookFile,
} from '@/lib/indexedDb'
import dynamic from 'next/dynamic'
import ReaderLoadingShell from '@/components/ReaderLoadingShell'

const PDFReader = dynamic(() => import('@/components/PDFReader'), { ssr: false })

interface Book {
  id: number
  title: string
  author: string
  filename: string
  filepath: string
  last_page: number
  total_pages: number | null
  thumbnail?: string
  is_encrypted?: number
  wrapped_fek?: string | null
}

export default function ReaderPageContent({ id }: { id: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedPage = Number(searchParams.get('page'))
  const [book, setBook] = useState<Book | null>(null)
  const [missing, setMissing] = useState(false)
  const [decryptedPdf, setDecryptedPdf] = useState<{ filename: string; url: string } | null>(null)
  const [decryptError, setDecryptError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { vaultKey } = useVault()
  const { t } = useI18n()
  const rawPdfUrl = book ? `/api/pdf/${encodeURIComponent(book.filename)}` : null
  const resolvedPdfUrl = decryptedPdf?.filename === book?.filename ? decryptedPdf?.url ?? null : null

  const [refreshKey, setRefreshKey] = useState(0)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const retryLoad = useCallback(() => {
    setMissing(false)
    setLoadError(null)
    setDecryptError(null)
    setBook(null)
    setDecryptedPdf(null)
    setLoadAttempt(attempt => attempt + 1)
  }, [])

  const handleForceRefresh = useCallback(async () => {
    if (!book) return
    await deleteBookFile(book.filename)
    setRefreshKey(k => k + 1)
  }, [book])

  const [libraryTheme, setLibraryTheme] = useState<LibraryTheme>(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      return (localStorage.getItem(THEME_STORAGE.library) as LibraryTheme) || 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleThemeChange = () => {
        try {
          const theme = localStorage.getItem(THEME_STORAGE.library) as LibraryTheme
          if (theme) setLibraryTheme(theme)
        } catch (e) {
          console.warn(e)
        }
      }
      window.addEventListener('storage', handleThemeChange)
      window.addEventListener('library-theme-changed', handleThemeChange)
      return () => {
        window.removeEventListener('storage', handleThemeChange)
        window.removeEventListener('library-theme-changed', handleThemeChange)
      }
    }
  }, [])

  // ── Fetch book metadata (IndexedDB first, fallback/sync to server) ───────────
  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function loadBook() {
      setLoadError(null)
      try {
        await initDb()
        // Try loading from local IndexedDB first
        const displayId = Number(id)
        const local = displayId > 0
          ? await getByServerId('books', displayId)
          : await getFromStore('books', Math.abs(displayId))
        if (local && !cancelled) {
          setMissing(false)
          setBook({ ...local, id: local.server_id || -Number(local.local_id) } as unknown as Book)

          // Background sync from server if it has a server_id
          if (local.server_id) {
            fetchWithTimeout(`/api/books/${local.server_id}`, {}, 10000)
              .then(res => res.ok ? res.json() : null)
              .then(async serverBook => {
                if (serverBook && !cancelled) {
                  await putToStore('books', {
                    ...local,
                    ...serverBook,
                    local_status: 'synced'
                  })
                  setBook({ ...local, ...serverBook, id: serverBook.id } as unknown as Book)
                }
              })
              .catch(() => {})
          }
          return
        }

        // Fallback: Fetch directly from server (by server_id)
        const res = await fetchWithTimeout(`/api/books/${id}`, {}, 10000)
        if (!res.ok) {
          if (!cancelled) setMissing(true)
          return
        }
        const data = await res.json()
        if (!cancelled && data) {
          // Save locally
          await putToStore('books', {
            ...data,
            server_id: data.id,
            local_status: 'synced',
            updated_at: data.updated_at || new Date().toISOString()
          })
          setMissing(false)
          setBook({ ...data, id: data.id } as Book)
        }
      } catch {
        if (!cancelled) setLoadError(t('reader.loadError'))
      }
    }

    loadBook()

    return () => {
      cancelled = true
    }
  }, [id, loadAttempt, t])

  // ── Resolve PDF URL — check cache, fetch if missing, decrypt if E2EE ─────────
  useEffect(() => {
    if (!book) return
    const currentBook = book

    let objectUrl: string | null = null
    let cancelled = false

    async function loadPdfBlob() {
      setDecryptError(null)
      setLoadError(null)

      try {
        await initDb()
        let fileBlob = await getBookFile(currentBook.filename)

        const readBlobStart = (blob: Blob, length: number): Promise<string> => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => resolve('')
            reader.readAsText(blob.slice(0, length))
          })
        }

        if (fileBlob) {
          const startText = await readBlobStart(fileBlob, 100)
          const normalized = startText.trim().toLowerCase()
          const isHtml = normalized.startsWith('<!doctype') || normalized.startsWith('<html') || normalized.startsWith('<!doc')

          let isValidPdf = true
          if (!currentBook.is_encrypted) {
            isValidPdf = startText.startsWith('%PDF-')
          }

          if (isHtml || !isValidPdf) {
            console.warn('[ReaderPageContent] Cached file is corrupted or HTML. Deleting from cache...')
            await deleteBookFile(currentBook.filename)
            fileBlob = null
          }

          // If server file size differs from cache, the file was recompressed (e.g. JPEG2000→JPEG)
          if (fileBlob && !currentBook.is_encrypted) {
            try {
              const headRes = await fetchWithTimeout(rawPdfUrl!, { method: 'HEAD' }, 10000)
              if (headRes.ok) {
                const serverSize = Number(headRes.headers.get('Content-Length'))
                if (serverSize && fileBlob.size !== serverSize) {
                  console.warn(`[ReaderPageContent] Server file size differs (cache=${fileBlob.size}, server=${serverSize}). Re-fetching...`)
                  await deleteBookFile(currentBook.filename)
                  fileBlob = null
                }
              }
            } catch {
              // HEAD failure is non-fatal; fall through with cached blob
            }
          }
        }

        if (!fileBlob) {
          // Fetch from network if not in local IndexedDB
          const response = await fetchWithTimeout(rawPdfUrl!, {}, 15000)
          if (!response.ok) throw new Error(`${t('reader.fileFetchError')} ${response.status}`)
          fileBlob = await response.blob()

          const startText = await readBlobStart(fileBlob, 100)
          const normalized = startText.trim().toLowerCase()
          const isHtml = normalized.startsWith('<!doctype') || normalized.startsWith('<html') || normalized.startsWith('<!doc')

          if (isHtml) {
            throw new Error('Received HTML login page instead of PDF. Please refresh and log in again.')
          }

          if (!currentBook.is_encrypted && !startText.startsWith('%PDF-')) {
            throw new Error('Downloaded file is not a valid PDF document.')
          }

          // Save to local cache for next time
          await saveBookFile(currentBook.filename, fileBlob)
        }

        if (cancelled) return

        let decryptedBytes: ArrayBuffer

        if (currentBook.is_encrypted) {
          if (!vaultKey) {
            setDecryptError(t('reader.encryptKeyMissing'))
            return
          }
          if (!currentBook.wrapped_fek) {
            throw new Error('E2EE key information is missing.')
          }

          // Unwrap the FEK from the vault key
          const fek = await unwrapKey(currentBook.wrapped_fek, vaultKey)
          const fileBytes = new Uint8Array(await fileBlob.arrayBuffer())

          // Split IV (first 12 bytes) and ciphertext (rest)
          const iv = fileBytes.slice(0, 12)
          const ciphertext = fileBytes.slice(12)

          // Decrypt using Web Crypto AES-GCM
          decryptedBytes = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            fek,
            ciphertext
          )
        } else {
          decryptedBytes = await fileBlob.arrayBuffer()
        }

        if (cancelled) return

        const finalBlob = new Blob([decryptedBytes], { type: 'application/pdf' })
        objectUrl = URL.createObjectURL(finalBlob)
        setDecryptedPdf({ filename: currentBook.filename, url: objectUrl })
      } catch (err) {
        console.error('[ReaderPageContent] Load/Decrypt failed:', err)
        if (currentBook.is_encrypted) setDecryptError(t('reader.decryptFailed'))
        else setLoadError(t('reader.loadError'))
      }
    }

    loadPdfBlob()

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [book, rawPdfUrl, vaultKey, refreshKey])

  const saveProgress = useCallback(async (page: number) => {
    if (!id) return
    try {
      await initDb()
      const displayId = Number(id)
      const current = displayId > 0
        ? await getByServerId('books', displayId)
        : await getFromStore('books', Math.abs(displayId))
      if (current) {
        const updated = {
          ...current,
          last_page: page,
          local_status: current.local_status === 'created' ? 'created' as const : 'updated' as const,
          updated_at: new Date().toISOString()
        }
        await putToStore('books', updated)

        if (current.server_id) {
          fetch(`/api/books/${current.server_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ last_page: page }),
          }).then(res => {
            if (res.ok) {
              putToStore('books', { ...updated, local_status: 'synced' as const })
            }
          }).catch(() => {})
        }
      }
    } catch (err) {
      console.error('[ReaderPageContent] saveProgress error:', err)
    }
  }, [id])

  useEffect(() => {
    if (!book?.title) return
    const prev = document.title
    document.title = book.title
    return () => { document.title = prev }
  }, [book?.title])

  const isSeoul = libraryTheme === 'seoul'
  const bgClass = isSeoul ? 'bg-[#FAF8F3] text-[#1C1A17]' : 'bg-[#050312] text-slate-200'
  const boxClass = isSeoul ? 'border-[#D4CFC5] bg-white text-[#1C1A17] shadow-lg' : 'border-white/10 bg-white/[0.06] text-slate-200 shadow-black/30'
  const textMutedClass = isSeoul ? 'text-[#7A7060]' : 'text-slate-400'
  const btnClass = isSeoul ? 'bg-[#4A9B8E] hover:bg-[#3D8A7E] text-white' : 'bg-violet-500 hover:bg-violet-400 text-white shadow-violet-500/20'

  if (missing) {
    return (
      <div className={`flex min-h-screen items-center justify-center px-6 ${bgClass}`}>
        <div className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl ${boxClass}`}>
          <p className="text-lg font-semibold">{t('reader.notFound')}</p>
          <p className={`mt-2 text-sm ${textMutedClass}`}>{t('reader.notFoundDesc')}</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className={`mt-5 rounded-xl px-4 py-2 text-sm font-semibold transition ${btnClass}`}
          >
            {t('common.backToLibrary')}
          </button>
        </div>
      </div>
    )
  }

  if (decryptError) {
    return (
      <div className={`flex min-h-screen items-center justify-center px-6 ${bgClass}`}>
        <div className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl ${boxClass}`}>
          <p className="text-lg font-semibold">{t('reader.decryptError')}</p>
          <p className={`mt-2 text-sm ${textMutedClass}`}>{decryptError}</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className={`mt-5 rounded-xl px-4 py-2 text-sm font-semibold transition ${btnClass}`}
          >
            {t('common.backToLibrary')}
          </button>
          <button
            type="button"
            onClick={retryLoad}
            className={`ml-2 mt-5 rounded-xl px-4 py-2 text-sm font-semibold transition ${btnClass}`}
          >
            Tekrar dene
          </button>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className={`flex min-h-screen items-center justify-center px-6 ${bgClass}`}>
        <div className={`w-full max-w-sm rounded-2xl border p-6 text-center shadow-2xl ${boxClass}`}>
          <p className="text-lg font-semibold">Kitap yüklenemedi</p>
          <p className={`mt-2 text-sm ${textMutedClass}`}>{loadError}</p>
          <button type="button" onClick={retryLoad} className={`mt-5 rounded-xl px-4 py-2 text-sm font-semibold transition ${btnClass}`}>Tekrar dene</button>
          <button type="button" onClick={() => router.push('/')} className={`ml-2 mt-5 rounded-xl border px-4 py-2 text-sm font-semibold transition ${isSeoul ? 'border-[#D4CFC5] text-[#5A5245]' : 'border-white/15 text-slate-300 hover:bg-white/10'}`}>Kütüphaneye dön</button>
        </div>
      </div>
    )
  }

  if (!book || !resolvedPdfUrl) {
    return (
      <ReaderLoadingShell
        libraryTheme={libraryTheme}
        message={
          book?.is_encrypted && !resolvedPdfUrl
            ? t('reader.decryptLoading')
            : book
              ? t('reader.loadingPdf')
              : t('common.loading')
        }
        showDecryptMessage={Boolean(book?.is_encrypted && !resolvedPdfUrl)}
        onBack={() => router.push('/')}
        onRetry={retryLoad}
      />
    )
  }

  return (
    <div className={`h-screen overflow-hidden ${bgClass}`}>
      <PDFReader
        bookId={Number(id)}
        isEncrypted={Boolean(book.is_encrypted)}
        fileUrl={resolvedPdfUrl}
        rawFileUrl={book.is_encrypted ? undefined : (rawPdfUrl ?? undefined)}
        initialPage={Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : (book.last_page || 1)}
        initialTotalPages={book.total_pages || 0}
        bookTitle={book.title}
        bookAuthor={book.author}
        bookThumbnail={book.thumbnail}
        libraryTheme={libraryTheme}
        onBack={() => router.push('/')}
        onPageChange={saveProgress}
        onForceRefresh={handleForceRefresh}
      />
    </div>
  )
}
