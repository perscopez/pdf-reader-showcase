'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  Archive,
  BookOpen,
  Columns2,
  ChevronDown,
  Download,
  Filter,
  LogOut,
  MoreHorizontal,
  Palette,
  Play,
  Scale,
  Search,
  Sparkles,
  Star,
  UserRound,
  Upload,
  FileText,
  Shield,
  Globe,
  ExternalLink,
  ListChecks,
  Settings2,
  LayoutGrid,
  List,
  Wand2,
  Trash2,
  TabletSmartphone,
  Layers,
  Network,
  ShieldCheck,
  Send,
} from 'lucide-react'
import MetadataEditModal from '@/components/MetadataEditModal'
import TrashBinModal from '@/components/TrashBinModal'
import DeviceManagementModal from '@/components/DeviceManagementModal'
import MetadataEnrichReportModal, { EnrichReportData } from '@/components/MetadataEnrichReportModal'
import BookTransferModal from '@/components/BookTransferModal'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import LibrarySubnav from '@/components/LibrarySubnav'
import { ToastContainer, useToast } from '@/components/Toast'
import { useI18n } from '@/components/I18nProvider'
import LicensesDialog from '@/components/LicensesDialog'
import BugReportDialog from '@/components/BugReportDialog'
import SmoothOverlay from '@/components/SmoothOverlay'
import { cleanText } from '@/lib/text'
import { getLibraryThemeStyle, LIBRARY_THEME, type LibraryTheme } from '@/lib/libraryTheme'
import { THEME_STORAGE } from '@/lib/themePreferences'
import { getAssetUrl } from '@/lib/api'
import { useVault } from '@/components/VaultContext'
import { useSession } from '@/components/SessionProvider'
import { generateVaultKey, wrapKey, encryptData, unwrapKey, decryptText } from '@/lib/crypto'
import {
  initDb,
  getAllFromStore,
  getFromStore,
  getByServerId,
  putToStore,
  deleteFromStore,
  getSyncMeta,
  saveSyncMeta,
  saveBookFile,
  deleteBookFile,
  reconcileBooksWithServer,
  type LocalRecord,
} from '@/lib/indexedDb'
import { deleteEncryptedBookDerivatives } from '@/lib/encryptedReaderStore'
import { visibleBookRecords } from '@/lib/bookCache'
import { findDuplicateBooks, groupDuplicateBooks } from '@/lib/duplicateBooks'
import { formatReadingTime } from '@/lib/readingDisplay'
import AnnotationCategoryManager from '@/components/AnnotationCategoryManager'
import type { AnnotationCategory } from '@/lib/annotationCategories'
import WorkflowJobCenter, { WORKFLOW_IMPORT_COMPLETED_EVENT } from '@/components/WorkflowJobCenter'
import { fetchWithTimeout } from '@/lib/request'
import { uploadFormDataWithProgress } from '@/lib/requestResilience'
import { readWorkflowJobs, upsertWorkflowJob, workflowJobId, WORKFLOW_RETRY_EVENT, type WorkflowJob } from '@/lib/workflowJobs'

const BookThumbnail = dynamic(() => import('@/components/BookThumbnail'), { ssr: false })

interface Book {
  id: number
  title: string
  author: string
  filename: string
  filepath: string
  last_page: number
  total_pages: number
  favorite: number
  category: string
  category_ids?: number[]
  categories?: Array<{ id: number; name: string; color: string; position?: number }>
  tags: string
  status: 'reading' | 'planned' | 'finished' | 'inbox' | 'paused' | 'completed' | 'reference' | 'archived'
  created_at: string
  last_opened_at?: string
  annotation_count: number
  bookmark_count: number
  word_count: number
  total_reading_time?: number
  thumbnail?: string
  is_encrypted?: number
  wrapped_fek?: string | null
  encrypted_metadata?: string | null
  rating?: number
  description?: string
  isbn?: string
  doi?: string
  publication_year?: number
  publisher?: string
  publication?: string
  volume?: string
  issue?: string
  pages?: string
  edition?: string
  language?: string
  edition_group_id?: string
  furthest_page?: number
  rtl?: number
  margin_crop?: string
}

type SortKey = 'recent' | 'title' | 'progress'
type BookPatch = Omit<Partial<Book>, 'tags'> & { tags?: string[]; categoryIds?: number[]; added_reading_time?: number }

type LibraryPreferences = {
  search: string
  statusFilter: 'all' | Book['status'] | 'favorite'
  customFilter: 'all' | 'has_notes' | 'offline_ready' | 'missing_metadata'
  viewMode: 'grid' | 'list'
  categoryFilter: string
  sort: SortKey
}

const LIBRARY_PREFERENCES_KEY = 'pdf-library-preferences:v1'

function readLibraryPreferences(): Partial<LibraryPreferences> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(LIBRARY_PREFERENCES_KEY) || '{}') as Partial<LibraryPreferences>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

interface BookSuggestion {
  id: string
  title: string
  author: string
  category: string
  tags?: string[]
}

interface LibrarySearchPage {
  id: number
  bookId: number
  title: string
  page: number
  text: string
}

interface BookSourceResult {
  source: 'gutenberg' | 'openlibrary' | 'googlebooks'
  sourceId: string
  title: string
  author: string
  description?: string
  coverUrl?: string
  downloadUrl?: string
  formats?: { format: string; url: string }[]
  sourceUrl?: string
}

interface CurrentUser {
  username: string
  role: string
  is_test: boolean
  avatar?: string
}

function parseTags(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value.map(cleanText)
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(cleanText) : []
  } catch {
    return value.split(',').map(t => cleanText(t).trim()).filter(Boolean)
  }
}

function progress(book: Book) {
  if (!book.total_pages) return 0
  return Math.min(100, Math.round((book.last_page / book.total_pages) * 100))
}

function isPdfBook(book: Book) {
  return /\.pdf$/i.test(book.filename)
}

function isEpubBook(book: Book) {
  return /\.epub$/i.test(book.filename)
}

async function generatePdfThumbnail(url: string) {
  const { pdfjs } = await import('react-pdf')
  const { PDF_WORKER_SRC } = await import('@/lib/pdfWorker')
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC
  const pdf = await pdfjs.getDocument(url).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const scale = Math.min(0.6, 280 / viewport.width)
  const renderViewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return ''
  canvas.width = Math.floor(renderViewport.width)
  canvas.height = Math.floor(renderViewport.height)
  await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise
  return canvas.toDataURL('image/jpeg', 0.78)
}

async function readImageAsDataUrl(file: File, t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0], values?: Record<string, string | number>) => string) {
  if (!file.type.startsWith('image/')) {
    throw new Error(t('upload.thumbnailInvalid'))
  }
  const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024
  if (file.size > MAX_THUMBNAIL_SIZE) {
    throw new Error(t('upload.thumbnailTooLarge'))
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error(t('upload.thumbnailInvalid')))
    reader.readAsDataURL(file)
  })
}


export default function Library() {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [dbError, setDbError] = useState(false)
  const [libraryTheme, setLibraryTheme] = useState<LibraryTheme>(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      return (localStorage.getItem(THEME_STORAGE.library) as LibraryTheme) || 'dark'
    } catch {
      return 'dark'
    }
  })
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [encryptUpload, setEncryptUpload] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [uploadCategoryIds, setUploadCategoryIds] = useState<number[]>([])
  const [tags, setTags] = useState('')
  const [customThumbnail, setCustomThumbnail] = useState('')
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([])
  const [search, setSearch] = useState(() => readLibraryPreferences().search || '')
  const [statusFilter, setStatusFilter] = useState<'all' | Book['status'] | 'favorite'>(() => readLibraryPreferences().statusFilter || 'all')
  const [customFilter, setCustomFilter] = useState<'all' | 'has_notes' | 'offline_ready' | 'missing_metadata'>(() => readLibraryPreferences().customFilter || 'all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => readLibraryPreferences().viewMode || 'grid')
  const [categoryFilter, setCategoryFilter] = useState(() => readLibraryPreferences().categoryFilter || 'all')
  const [bookCategories, setBookCategories] = useState<Array<AnnotationCategory & { bookCount?: number }>>([])
  const [showBookCategoryManager, setShowBookCategoryManager] = useState(false)
  const [sort, setSort] = useState<SortKey>(() => readLibraryPreferences().sort || 'recent')
  const [editing, setEditing] = useState<Book | null>(null)
  const [fullTextOpen, setFullTextOpen] = useState(false)
  const [fullTextQuery, setFullTextQuery] = useState('')
  const [fullTextIndexing, setFullTextIndexing] = useState(false)
  const [fullTextBackgroundIndexing, setFullTextBackgroundIndexing] = useState(false)
  const [fullTextProgress, setFullTextProgress] = useState('')
  const [fullTextError, setFullTextError] = useState('')
  const [fullTextResults, setFullTextResults] = useState<LibrarySearchPage[]>([])
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedBookIds, setSelectedBookIds] = useState<number[]>([])
  const [bulkCategoryId, setBulkCategoryId] = useState<number>(0)
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; confirmLabel?: string; onConfirm: () => void } | null>(null)
  const [showThemeChoices, setShowThemeChoices] = useState(false)
  const { user: sessionUser, refresh: refreshSession } = useSession()
  const currentUser: CurrentUser | null = sessionUser?.username ? {
    username: sessionUser.username,
    role: sessionUser.role,
    is_test: Boolean(sessionUser.is_test),
    avatar: sessionUser.avatar || '',
  } : null
  const [showBugReport, setShowBugReport] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showProfileSettings, setShowProfileSettings] = useState(false)
  const [showLicenses, setShowLicenses] = useState(false)
  const [showBookSearch, setShowBookSearch] = useState(false)
  const [showLibraryMenu, setShowLibraryMenu] = useState(false)
  const [showTrashBinModal, setShowTrashBinModal] = useState(false)
  const [backupBusy, setBackupBusy] = useState<'download' | 'restore' | null>(null)
  const [showDeviceModal, setShowDeviceModal] = useState(false)
  const [isEnrichingMetadata, setIsEnrichingMetadata] = useState(false)
  const [enrichReport, setEnrichReport] = useState<EnrichReportData | null>(null)

  const refreshBooksList = async () => {
    const res = await fetch('/api/books')
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data)) setBooks(data)
    }
  }

  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [transferBookIds, setTransferBookIds] = useState<number[]>([])
  const [transferBookTitles, setTransferBookTitles] = useState<string[]>([])

  const handleOpenTransferModal = (ids: number[]) => {
    const selectedBooks = books.filter(b => ids.includes(b.id))
    setTransferBookIds(ids)
    setTransferBookTitles(selectedBooks.map(b => cleanText(b.title)))
    setTransferModalOpen(true)
  }

  const enrichAllMetadata = async () => {
    setIsEnrichingMetadata(true)
    try {
      const res = await fetch('/api/books/enrich-metadata', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setEnrichReport(data)
        await refreshBooksList()
      } else {
        toast('Metaveri iyileştirmesi yapılamadı.', 'error')
      }
    } catch {
      toast('Metaveri iyileştirmesi başarısız oldu.', 'error')
    } finally {
      setIsEnrichingMetadata(false)
    }
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const thumbnailRef = useRef<HTMLInputElement>(null)
  const backupImportRef = useRef<HTMLInputElement>(null)
  const thumbnailQueueRef = useRef(new Set<number>())
  const fullTextAbortRef = useRef<AbortController | null>(null)
  const pendingBookDeletesRef = useRef(new Map<number, { timer: number; snapshot: Book & LocalRecord }>())
  const { messages, toast, remove } = useToast()
  const { t, statusLabel, locale } = useI18n()
  const { vaultKey } = useVault()
  const collator = useMemo(() => new Intl.Collator(locale, { sensitivity: 'base', numeric: true }), [locale])
  const th = LIBRARY_THEME[libraryTheme]
  const themeStyle = getLibraryThemeStyle(libraryTheme)
  const themeLabel: Record<LibraryTheme, string> = { dark: 'Dark', seoul: 'Seoul', midnight: 'Midnight', forest: 'Forest', ocean: 'Ocean', sunset: 'Sunset', sakura: 'Sakura' }
  const themeSwatch: Record<LibraryTheme, string> = { dark: '#e50914', seoul: '#4A9B8E', midnight: '#3B82F6', forest: '#65A30D', ocean: '#06B6D4', sunset: '#F97316', sakura: '#EC4899' }
  const cinematic = libraryTheme !== 'seoul'
  const uploadHoverClass = 'border-[var(--lib-border-strong)] bg-[var(--lib-surface-subtle)] text-[var(--lib-text-secondary)] hover:border-[var(--lib-accent)] hover:bg-[var(--lib-accent-surface)] hover:text-[var(--lib-text)]'

  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_PREFERENCES_KEY, JSON.stringify({
        search,
        statusFilter,
        customFilter,
        viewMode,
        categoryFilter,
        sort,
      } satisfies LibraryPreferences))
    } catch {
      // Preferences are an enhancement; storage quota/private mode must not block the library.
    }
  }, [categoryFilter, customFilter, search, sort, statusFilter, viewMode])

  useEffect(() => {
    if (!showUpload && !showBugReport && !showProfileSettings && !showLicenses && !showBookCategoryManager && !editing && !pendingConfirm) return
    const timer = window.setTimeout(() => {
      setShowThemeChoices(false)
      setShowLibraryMenu(false)
      setShowProfileMenu(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [editing, pendingConfirm, showBookCategoryManager, showBugReport, showProfileSettings, showLicenses, showUpload])

  function chooseLibraryTheme(next: LibraryTheme) {
    if (currentUser?.is_test) {
      toast(t('library.testThemeBlocked'), 'error')
      setShowThemeChoices(false)
      return
    }
    setLibraryTheme(next)
    try {
      localStorage.setItem(THEME_STORAGE.library, next)
    } catch (e) {
      console.warn(e)
    }
    setShowThemeChoices(false)
    window.dispatchEvent(new CustomEvent('library-theme-changed', { detail: next }))
  }


  async function lockLibrary() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }

  async function downloadBackup() {
    if (backupBusy) return
    setBackupBusy('download')
    try {
      const response = await fetch('/api/backup')
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'library-backup.zip'
      link.click()
      URL.revokeObjectURL(url)
      toast(t('library.backupDownloaded'))
    } catch {
      toast('Yedek indirilemedi. Bağlantıyı kontrol edip tekrar dene.', 'error')
    } finally {
      setBackupBusy(null)
    }
  }

  function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const inputEl = e.target
    setPendingConfirm({
      message: t('library.restoreConfirm'),
      confirmLabel: t('library.backupRestore'),
      onConfirm: async () => {
        setBackupBusy('restore')
        const form = new FormData()
        form.append('file', file)
        try {
          const res = await fetch('/api/backup', { method: 'POST', body: form })
          const data = await res.json().catch(() => ({}))
          inputEl.value = ''
          if (!res.ok) {
            toast(typeof data.error === 'string' ? data.error : t('library.restoreFailed'), 'error')
            return
          }
          toast(t('library.restoreDone'))
          window.location.reload()
        } catch {
          toast(t('library.restoreFailed'), 'error')
        } finally {
          setBackupBusy(null)
        }
      },
    })
    inputEl.value = ''
  }

  async function loadLocalData() {
    try {
      await initDb()
      const localBooks = await getAllFromStore('books')
      const formattedBooks = visibleBookRecords(localBooks)
        .map(b => ({ ...b, id: b.server_id || -Number(b.local_id) }))
      setBooks(formattedBooks as unknown as Book[])
    } catch (err) {
      console.error('Failed to load local data:', err)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const localLoadingTimeout = window.setTimeout(() => setLoading(false), 6000)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLocalData().finally(() => {
      window.clearTimeout(localLoadingTimeout)
      setLoading(false)
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    Promise.all([
      fetch('/api/books', { signal: controller.signal }).then(r => r.json()),
      fetch('/api/book-categories', { signal: controller.signal }).then(r => r.json()),
    ])
      .then(async ([bookData, categoryData]) => {
        if (Array.isArray(categoryData)) setBookCategories(categoryData)
        if (Array.isArray(bookData)) {
          await initDb()
          await reconcileBooksWithServer(bookData)

          await loadLocalData()
          setDbError(false)
        } else {
          setDbError(true)
        }
      })
      .catch(() => setDbError(true))
      .finally(() => {
        clearTimeout(timer)
      })

    const handleSyncCompleted = () => {
      loadLocalData()
    }
    window.addEventListener('sync-completed', handleSyncCompleted)

    return () => {
      window.clearTimeout(localLoadingTimeout)
      clearTimeout(timer)
      controller.abort()
      window.removeEventListener('sync-completed', handleSyncCompleted)
    }
  }, [])

  useEffect(() => {
    const refresh = () => { void refreshBooksList() }
    window.addEventListener(WORKFLOW_IMPORT_COMPLETED_EVENT, refresh)
    return () => window.removeEventListener(WORKFLOW_IMPORT_COMPLETED_EVENT, refresh)
  }, [])

  // ── Decrypt encrypted_metadata for E2EE books when vault key is available ──
  useEffect(() => {
    if (!vaultKey) return
    const encrypted = books.filter(b => b.is_encrypted && b.wrapped_fek && b.encrypted_metadata)
    if (encrypted.length === 0) return

    let cancelled = false
    async function decryptAll() {
      const patches: { id: number; title?: string; author?: string; thumbnail?: string }[] = []
      for (const book of encrypted) {
        try {
          const fek = await unwrapKey(book.wrapped_fek!, vaultKey!)
          const metaJson = await decryptText(book.encrypted_metadata!, fek)
          const meta = JSON.parse(metaJson) as { title?: string; author?: string; thumbnail?: string }
          patches.push({ id: book.id, ...meta })
        } catch {
          // Non-fatal — vault key mismatch or old format; leave raw fields
        }
      }
      if (!cancelled && patches.length > 0) {
        setBooks(prev => prev.map(b => {
          const patch = patches.find(p => p.id === b.id)
          return patch ? { ...b, ...patch } : b
        }))
      }
    }
    decryptAll()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books.length, vaultKey])

  useEffect(() => {
    const resume = (event: Event) => {
      const job = (event as CustomEvent<WorkflowJob>).detail
      if (job?.kind !== 'upload') return
      setShowUpload(true)
      setUploadError('Devam etmek için aynı dosyayı yeniden seçip Kitapları Ekle düğmesine basın. Tamamlanan diğer işler tekrarlanmaz.')
    }
    window.addEventListener(WORKFLOW_RETRY_EVENT, resume)
    return () => window.removeEventListener(WORKFLOW_RETRY_EVENT, resume)
  }, [])

  useEffect(() => {
    if (loading || books.length === 0) return
    let cancelled = false
    const missing = books.filter(book => /\.pdf$/i.test(book.filename) && !book.thumbnail && !thumbnailQueueRef.current.has(book.id)).slice(0, 3)
    if (missing.length === 0) return

    async function run() {
      for (const book of missing) {
        thumbnailQueueRef.current.add(book.id)
        try {
          const thumbnail = await generatePdfThumbnail(`/api/pdf/${encodeURIComponent(book.filename)}`)
          if (!thumbnail || cancelled) continue
          await fetch(`/api/books/${book.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thumbnail }),
          })
          if (!cancelled) {
            setBooks(prev => prev.map(item => item.id === book.id ? { ...item, thumbnail } : item))
          }
        } catch {}
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [books, loading])

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    const files = Array.from(fileRef.current?.files || [])
    if (files.length === 0) return
    setUploadError('')
    setUploading(true)
    try {
      const uploadedBooks: Book[] = []
      const shouldEncrypt = encryptUpload && Boolean(vaultKey)

      await initDb()

      for (let index = 0; index < files.length; index++) {
        const file = files[index]
        const uploadJobId = workflowJobId('upload', `${file.name}:${file.size}:${file.lastModified}`)
        const existingJob = readWorkflowJobs().find(job => job.id === uploadJobId)
        if (existingJob?.status === 'completed') continue
        upsertWorkflowJob({
          id: uploadJobId,
          kind: 'upload',
          title: file.name,
          status: 'running',
          progress: 1,
          attempts: (existingJob?.attempts || 0) + 1,
          message: `${index + 1}/${files.length} hazırlanıyor`,
          payload: { fileName: file.name, size: file.size, lastModified: file.lastModified },
        })
        if (files.length > 1) setUploadError(`${index + 1}/${files.length} yükleniyor: ${file.name}`)
        const form = new FormData()
        const bookTitle = files.length === 1 ? cleanText(title).trim() : ''
        const bookAuthor = cleanText(author).trim()
        const duplicateTitle = bookTitle || file.name.replace(/\.[^.]+$/, '')
        const duplicates = findDuplicateBooks(books, duplicateTitle, bookAuthor)
        if (duplicates.length > 0) {
          const proceed = window.confirm(t('library.duplicate.uploadConfirm', { title: cleanText(duplicates[0].title) }))
          if (!proceed) {
            upsertWorkflowJob({
              id: uploadJobId,
              kind: 'upload',
              title: file.name,
              status: 'paused',
              progress: 0,
              message: 'Olası kopya nedeniyle atlandı. İsterseniz yeniden deneyin.',
            })
            continue
          }
        }

        let wrappedFek: string | null = null
        let encryptedMetadata: string | null = null

        if (shouldEncrypt && vaultKey) {
          // ── Client-side encryption ──────────────────────────────────────
          const fek = await generateVaultKey()

          const fileBytes = new Uint8Array(await file.arrayBuffer())
          const { ciphertextHex, ivHex } = await encryptData(fileBytes, fek)

          const metaJson = JSON.stringify({ title: bookTitle || file.name, author: bookAuthor })
          const encMeta = await encryptData(metaJson, fek)
          encryptedMetadata = JSON.stringify(encMeta)

          wrappedFek = await wrapKey(fek, vaultKey)

          const ivBytes = new Uint8Array(ivHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
          const cipherBytes = new Uint8Array(ciphertextHex.match(/.{2}/g)!.map(h => parseInt(h, 16)))
          const combined = new Uint8Array(ivBytes.length + cipherBytes.length)
          combined.set(ivBytes)
          combined.set(cipherBytes, ivBytes.length)
          const encryptedBlob = new Blob([combined], { type: 'application/octet-stream' })
          const encryptedFile = new File([encryptedBlob], file.name + '.enc', { type: 'application/octet-stream' })

          form.append('file', encryptedFile)
          form.append('title', bookTitle)
          form.append('author', bookAuthor)
          form.append('isEncrypted', '1')
          form.append('wrappedFek', wrappedFek)
          form.append('encryptedMetadata', encryptedMetadata)
        } else {
          form.append('file', file)
          form.append('title', bookTitle)
          form.append('author', bookAuthor)
        }

        let bookData: Book
        try {
          bookData = await uploadFormDataWithProgress<Book>('/api/upload', form, progress => {
            upsertWorkflowJob({
              id: uploadJobId,
              kind: 'upload',
              title: file.name,
              status: 'running',
              progress,
              message: progress < 100 ? 'Sunucuya aktarılıyor' : 'İşleniyor',
            })
          })
        } catch (err) {
          const isNetworkError = err instanceof TypeError || (err instanceof Error && /bağlantı|network|timeout|zaman aşımı/i.test(err.message))
          if (isNetworkError) {
            // eslint-disable-next-line react-hooks/purity
            const tempFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
            bookData = {
              id: 0,
              title: bookTitle || file.name,
              author: bookAuthor,
              filename: tempFilename,
              filepath: `/api/pdf/${tempFilename}`,
              last_page: 1,
              total_pages: 0,
              favorite: 0,
              category: '',
              category_ids: [],
              categories: [],
              tags: '[]',
              status: 'reading',
              created_at: new Date().toISOString(),
              is_encrypted: shouldEncrypt ? 1 : 0,
              wrapped_fek: shouldEncrypt ? wrappedFek : null,
              encrypted_metadata: shouldEncrypt ? encryptedMetadata : null,
              annotation_count: 0,
              bookmark_count: 0,
              word_count: 0,
            }
            await saveBookFile(tempFilename, file)
            upsertWorkflowJob({ id: uploadJobId, kind: 'upload', title: file.name, status: 'paused', progress: 100, message: 'Cihazda saklandı; bağlantı gelince eşitlenecek.' })
          } else {
            upsertWorkflowJob({ id: uploadJobId, kind: 'upload', title: file.name, status: 'failed', message: err instanceof Error ? err.message : t('library.uploadFailed') })
            throw err
          }
        }
        if (bookData.id > 0) {
          upsertWorkflowJob({ id: uploadJobId, kind: 'upload', title: file.name, status: 'completed', progress: 100, message: 'Kütüphaneye eklendi.' })
        }
        uploadedBooks.push(bookData)
      }

      const patchBody = {
        categoryIds: uploadCategoryIds,
        tags: parseTags(tags),
        status: 'reading',
        ...(customThumbnail && uploadedBooks.length === 1 ? { thumbnail: customThumbnail } : {}),
      }

      await Promise.all(uploadedBooks.map(async (book: Book) => {
        const parsedTags = parseTags(tags)
        const tagsString = JSON.stringify(parsedTags)
        const thumbnail = uploadedBooks.length === 1 ? customThumbnail || book.thumbnail : book.thumbnail

        const finalBook = {
          ...book,
          category: bookCategories.find(item => item.id === uploadCategoryIds[0])?.name || '',
          category_ids: uploadCategoryIds,
          categories: bookCategories.filter(item => uploadCategoryIds.includes(item.id)),
          tags: tagsString,
          status: 'reading' as const,
          thumbnail,
        }

        if (book.id > 0) {
          try {
            await fetch(`/api/books/${book.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patchBody),
            })
            await putToStore('books', {
              ...finalBook,
              server_id: book.id,
              local_status: 'synced' as const,
              updated_at: new Date().toISOString(),
            })
          } catch {
            await putToStore('books', {
              ...finalBook,
              server_id: book.id,
              local_status: 'updated' as const,
              updated_at: new Date().toISOString(),
            })
          }
        } else {
          await putToStore('books', {
            ...finalBook,
            server_id: null,
            local_status: 'created' as const,
            updated_at: new Date().toISOString(),
          })
        }
      }))

      await loadLocalData()

      setShowUpload(false)
      setTitle('')
      setAuthor('')
      setUploadCategoryIds([])
      setTags('')
      setCustomThumbnail('')
      setSelectedUploadFiles([])
      setEncryptUpload(false)
      if (fileRef.current) fileRef.current.value = ''
      if (thumbnailRef.current) thumbnailRef.current.value = ''
      setUploadError('')
      toast(uploadedBooks.length > 1 ? t('library.booksAdded', { count: uploadedBooks.length }) : t('library.bookAdded'))
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('library.uploadConnectionFailed'))
    }
    setUploading(false)
  }

  async function handleThumbnailInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await readImageAsDataUrl(file, t)
      setCustomThumbnail(dataUrl)
      setUploadError('')
    } catch (error) {
      setCustomThumbnail('')
      setUploadError(error instanceof Error ? error.message : t('upload.thumbnailInvalid'))
    }
  }

  async function patchBook(id: number, body: BookPatch, silent = false) {
    await initDb()
    const localBook = (id > 0
      ? await getByServerId('books', id)
      : await getFromStore('books', Math.abs(id))) as unknown as Book & LocalRecord
    if (!localBook) return

    const selectedCategories = body.categoryIds
      ? bookCategories.filter(item => body.categoryIds?.includes(item.id))
      : undefined
    const updatedFields = {
      ...localBook,
      ...body,
      ...(selectedCategories ? {
        category_ids: selectedCategories.map(item => item.id),
        categories: selectedCategories,
        category: selectedCategories[0]?.name || '',
      } : {}),
      tags: body.tags ? JSON.stringify(body.tags) : localBook.tags,
      local_status: localBook.local_status === 'created' ? 'created' as const : 'updated' as const,
      updated_at: new Date().toISOString()
    }

    await putToStore('books', updatedFields)
    await loadLocalData()

    if (localBook.server_id) {
      try {
        const res = await fetch(`/api/books/${localBook.server_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) {
          const updated = await res.json()
          await putToStore('books', {
            ...updatedFields,
            ...updated,
            local_status: 'synced' as const
          })
          await loadLocalData()
        }
      } catch {
        // Silently ignore network failures, sync will handle it
      }
    }
  }

  function toggleBookSelection(id: number) {
    setSelectedBookIds(current => (
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    ))
  }

  async function runBulkAction(action: 'delete' | 'favorite' | 'reading' | 'planned' | 'finished') {
    if (!selectedBookIds.length) return
    if (action === 'delete') {
      setPendingConfirm({
        message: t('library.bulk.selected', { count: selectedBookIds.length }),
        confirmLabel: t('library.bulk.delete'),
        onConfirm: async () => {
          for (const id of selectedBookIds) {
            await scheduleBookDelete(id)
          }
          setSelectedBookIds([])
          setBulkMode(false)
          toast('Kitaplar silinmek üzere. Son işlemi geri almak için bildirime dokun.', 'info')
        },
      })
      return
    }

    const patch: BookPatch = action === 'favorite'
      ? { favorite: 1 }
      : { status: action }

    await Promise.all(selectedBookIds.map(id => patchBook(id, patch, true)))
    setSelectedBookIds([])
    toast(t('library.bulk.selected', { count: selectedBookIds.length }), 'info')
  }

  async function runBulkCategory(action: 'add' | 'remove') {
    if (!selectedBookIds.length || !bulkCategoryId) return
    await Promise.all(selectedBookIds.map(id => {
      const book = books.find(item => item.id === id)
      const current = book?.category_ids || book?.categories?.map(item => item.id) || []
      const categoryIds = action === 'add'
        ? [...new Set([...current, bulkCategoryId])]
        : current.filter(categoryId => categoryId !== bulkCategoryId)
      return patchBook(id, { categoryIds }, true)
    }))
    setSelectedBookIds([])
    toast(t('library.bulk.selected', { count: selectedBookIds.length }), 'info')
  }

  async function deleteBookNow(id: number) {
    await initDb()
    const localBook = (id > 0
      ? await getByServerId('books', id)
      : await getFromStore('books', Math.abs(id))) as unknown as Book & LocalRecord
    if (!localBook) return
    const localId = Number(localBook.local_id)

    if (!localBook.server_id) {
      await deleteFromStore('books', localId)
      if (localBook.filename) {
        await deleteBookFile(localBook.filename)
      }
      await loadLocalData()
      return
    }

    const deletedRecord = {
      ...localBook,
      local_status: 'deleted' as const,
      updated_at: new Date().toISOString(),
    }
    await putToStore('books', deletedRecord)
    await loadLocalData()

    try {
      const res = await fetch(`/api/books/${localBook.server_id}`, { method: 'DELETE' })
      if (res.ok) {
        await deleteFromStore('books', localId)
        if (localBook.filename) {
          await deleteBookFile(localBook.filename)
        }
        if (localBook.is_encrypted && localBook.server_id) {
          await deleteEncryptedBookDerivatives(Number(localBook.server_id)).catch(() => {})
        }
        await loadLocalData()
      }
    } catch {
      // offline delete stays queued for sync
    }
  }

  async function undoBookDelete(id: number) {
    const pending = pendingBookDeletesRef.current.get(id)
    if (!pending) return
    window.clearTimeout(pending.timer)
    pendingBookDeletesRef.current.delete(id)
    await putToStore('books', pending.snapshot)
    await loadLocalData()
    toast('Kitap silme işlemi geri alındı.', 'success')
  }

  async function scheduleBookDelete(id: number) {
    await initDb()
    const localBook = (id > 0
      ? await getByServerId('books', id)
      : await getFromStore('books', Math.abs(id))) as unknown as Book & LocalRecord
    if (!localBook) return

    const previous = pendingBookDeletesRef.current.get(id)
    if (previous) window.clearTimeout(previous.timer)
    const snapshot = { ...localBook }
    await putToStore('books', {
      ...localBook,
      local_status: 'deleted' as const,
      updated_at: new Date().toISOString(),
    })
    await loadLocalData()

    const timer = window.setTimeout(() => {
      pendingBookDeletesRef.current.delete(id)
      void deleteBookNow(id)
    }, 5000)
    pendingBookDeletesRef.current.set(id, { timer, snapshot })
    toast('Kitap silinmek üzere. 5 saniye içinde geri alabilirsin.', 'info', {
      label: 'Geri al',
      onClick: () => { void undoBookDelete(id) },
    })
  }

  function deleteBook(id: number) {
    setPendingConfirm({
      message: t('library.deleteConfirm'),
      confirmLabel: t('common.delete'),
      onConfirm: async () => {
        await scheduleBookDelete(id)
      },
    })
  }

  async function runFullTextSearch(query = fullTextQuery) {
    const q = cleanText(query).trim()
    setFullTextQuery(query)
    fullTextAbortRef.current?.abort()
    if (q.length < 2) {
      setFullTextResults([])
      setFullTextProgress('')
      setFullTextError('')
      setFullTextIndexing(false)
      setFullTextBackgroundIndexing(false)
      return
    }
    const controller = new AbortController()
    fullTextAbortRef.current = controller
    setFullTextIndexing(true)
    setFullTextError('')
    setFullTextProgress('Arama hazırlanıyor…')
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      if (!res.ok) throw new Error('Arama yapılamadı')
      const data = await res.json() as { results?: LibrarySearchPage[]; indexing?: boolean } | LibrarySearchPage[]
      const results = Array.isArray(data) ? data : data.results || []
      setFullTextResults(results)
      setFullTextBackgroundIndexing(!Array.isArray(data) && Boolean(data.indexing))
      setFullTextProgress(!Array.isArray(data) && data.indexing ? 'Kitap metinleri arka planda hazırlanıyor…' : '')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.error('Search failed:', err)
      setFullTextError('Arama sırasında bağlantı kurulamadı. Tekrar dene.')
    } finally {
      if (!controller.signal.aborted) setFullTextIndexing(false)
    }
  }

  useEffect(() => {
    if (!fullTextOpen) return
    const timer = window.setTimeout(() => { void runFullTextSearch(fullTextQuery) }, 280)
    return () => window.clearTimeout(timer)
    // Search input is intentionally debounced to avoid one request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullTextOpen, fullTextQuery])

  useEffect(() => {
    if (!fullTextOpen || !fullTextBackgroundIndexing || fullTextQuery.trim().length < 2) return
    const timer = window.setTimeout(() => { void runFullTextSearch(fullTextQuery) }, 1500)
    return () => window.clearTimeout(timer)
    // Poll only while the server reports background indexing, then stop automatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullTextBackgroundIndexing, fullTextOpen, fullTextQuery])

  const categories = useMemo(() => {
    return Array.from(new Set([...bookCategories.map(item => item.name), ...books.flatMap(book => book.categories?.map(item => item.name) || (book.category ? [book.category] : []))])).sort()
  }, [bookCategories, books])

  const stats = useMemo(() => {
    const totalPages = books.reduce((sum, b) => sum + (b.total_pages || 0), 0)
    const readPages = books.reduce((sum, b) => sum + Math.min(b.last_page || 0, b.total_pages || b.last_page || 0), 0)
    return {
      books: books.length,
      reading: books.filter(b => b.status === 'reading').length,
      finished: books.filter(b => b.status === 'finished').length,
      notes: books.reduce((sum, b) => sum + Number(b.annotation_count || 0), 0),
      words: books.reduce((sum, b) => sum + Number(b.word_count || 0), 0),
      progress: totalPages ? Math.round((readPages / totalPages) * 100) : 0,
      readingTime: books.reduce((sum, b) => sum + Number(b.total_reading_time || 0), 0),
    }
  }, [books])

  const filtered = useMemo(() => {
    const q = cleanText(search).toLocaleLowerCase(locale).trim()
    return books
      .filter(b => {
        const tagText = parseTags(b.tags).join(' ')
        const categoryText = b.categories?.map(item => item.name).join(' ') || b.category
        const matchesSearch = !q || cleanText(`${b.title} ${b.author} ${categoryText} ${tagText} ${b.isbn || ''} ${b.description || ''}`).toLocaleLowerCase(locale).includes(q)
        const matchesStatus = statusFilter === 'all' || (statusFilter === 'favorite' ? b.favorite : b.status === statusFilter)
        const matchesCategory = categoryFilter === 'all' || b.categories?.some(item => item.name === categoryFilter) || b.category === categoryFilter
        let matchesCustom = true
        if (customFilter === 'has_notes') {
          matchesCustom = Number(b.annotation_count || 0) > 0
        } else if (customFilter === 'offline_ready') {
          matchesCustom = true
        } else if (customFilter === 'missing_metadata') {
          matchesCustom = !b.author || !b.isbn || !b.description
        }
        return matchesSearch && matchesStatus && matchesCategory && matchesCustom
      })
      .sort((a, b) => {
        if (sort === 'title') return collator.compare(cleanText(a.title), cleanText(b.title))
        if (sort === 'progress') return progress(b) - progress(a)
        return new Date(b.last_opened_at || b.created_at).getTime() - new Date(a.last_opened_at || a.created_at).getTime()
      })
  }, [books, categoryFilter, collator, customFilter, locale, search, statusFilter, sort])

  const heroBook = useMemo(() => {
    return [...books].sort((a, b) => {
      const aTime = new Date(a.last_opened_at || a.created_at).getTime()
      const bTime = new Date(b.last_opened_at || b.created_at).getTime()
      const aScore = (a.status === 'reading' ? 2000000000000 : 0) + (a.last_page ? 1000000000000 : 0) + aTime
      const bScore = (b.status === 'reading' ? 2000000000000 : 0) + (b.last_page ? 1000000000000 : 0) + bTime
      return bScore - aScore
    })[0] || null
  }, [books])

  const duplicateGroups = useMemo(() => groupDuplicateBooks(books), [books])

  const discoveryShelves = useMemo(() => {
    const seen = new Set<number>()
    const unique = (list: Book[], limit = 10) => {
      const result: Book[] = []
      for (const book of list) {
        if (seen.has(book.id)) continue
        seen.add(book.id)
        result.push(book)
        if (result.length >= limit) break
      }
      return result
    }

    const rows: { key: string; books: Book[] }[] = []
    const continueList = books
      .filter(book => book.status === 'reading' && progress(book) > 0)
      .sort((a, b) => new Date(b.last_opened_at || b.created_at).getTime() - new Date(a.last_opened_at || a.created_at).getTime())
    const continueShelf = unique(continueList)
    if (continueShelf.length) {
      rows.push({ key: 'currentlyReading', books: continueShelf })
    } else {
      const fallback = unique(
        [...books].sort((a, b) => new Date(b.last_opened_at || b.created_at).getTime() - new Date(a.last_opened_at || a.created_at).getTime()),
        1,
      )
      if (fallback.length) rows.push({ key: 'currentlyReading', books: fallback })
    }

    const queueShelf = unique(
      books
        .filter(book => book.status === 'planned')
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      12,
    )
    if (queueShelf.length) rows.push({ key: 'readingQueue', books: queueShelf })

    const favoriteShelf = unique(
      books
        .filter(book => book.favorite)
        .sort((a, b) => new Date(b.last_opened_at || b.created_at).getTime() - new Date(a.last_opened_at || a.created_at).getTime()),
    )
    if (favoriteShelf.length) rows.push({ key: 'favorites', books: favoriteShelf })

    const almostDoneShelf = unique(
      books
        .filter(book => progress(book) >= 55 && progress(book) < 100)
        .sort((a, b) => progress(b) - progress(a)),
    )
    if (almostDoneShelf.length) rows.push({ key: 'almostDone', books: almostDoneShelf })

    const recentShelf = unique(
      [...books].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    )
    if (recentShelf.length) rows.push({ key: 'recentlyAdded', books: recentShelf })

    return { rows, shelfBookIds: seen }
  }, [books])

  const showDiscoveryShelves = !loading && !dbError && !search.trim() && statusFilter === 'all' && categoryFilter === 'all' && books.length > 1

  const shelfTitle = (key: string) => {
    const map: Record<string, Parameters<typeof t>[0]> = {
      currentlyReading: 'library.shelf.currentlyReading',
      readingQueue: 'library.shelf.readingQueue',
      favorites: 'library.shelf.favorites',
      almostDone: 'library.shelf.almostDone',
      recentlyAdded: 'library.shelf.recentlyAdded',
    }
    return t(map[key] || 'library.allBooks')
  }

  return (
    <div style={themeStyle as React.CSSProperties} className={`library-page relative min-h-screen overflow-x-clip text-[var(--lib-text)] transition-colors duration-300 ${th.bg}`}>
      {cinematic && (
        <div className="library-cinematic-bg pointer-events-none fixed inset-0" aria-hidden>
          <div className="library-mesh absolute inset-0" />
          <div className="library-vignette absolute inset-0" />
          <div className="library-noise absolute inset-0 opacity-[0.035]" />
        </div>
      )}
      <header className={`library-header sticky top-0 z-30 border-b px-3 py-2 sm:px-4 sm:py-3 liquid-glass-bar ${th.headerBorder}`}>
        <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 items-center gap-2 pr-1">
            <div className="min-w-0 flex-1">
              <h1 className={`library-page-title truncate text-base font-black tracking-tight sm:text-xl ${th.title}`}>{t('library.title')}</h1>
              <p className={`hidden text-xs sm:block ${th.subtitle}`}>{t('library.subtitle')}</p>
            </div>
            <button
              onClick={() => { setShowUpload(true); setUploadError('') }}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:hidden ${th.addBtn}`}
              title={t('library.addPdf')}
              aria-label={t('library.addPdf')}
            >
              <Upload size={17} />
            </button>
            <button
              onClick={() => setShowBookSearch(true)}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:hidden ${th.navBtn}`}
              title={t('sourceSearch.noBooksSearch')}
              aria-label={t('sourceSearch.noBooksSearch')}
            >
              <Globe size={17} />
            </button>
          </div>
          <div className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-1 overflow-visible px-1 pb-1 sm:mx-0 sm:w-auto sm:justify-start sm:gap-2 sm:p-0">
            <SyncStatusBadge compact className="shrink-0 sm:hidden" />
            <WorkflowJobCenter libraryTheme={libraryTheme} />
            <LanguageSwitcher compact className="shrink-0" buttonClass={th.languageButton} panelClass={th.languagePanel} />
            <div className="relative shrink-0">
              <button
                onClick={() => { setShowLibraryMenu(false); setShowProfileMenu(false); setShowThemeChoices(value => !value) }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition-all hover:brightness-110 sm:px-3 ${th.navBtn}`}
                title={t('library.theme')}
              >
                <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: themeSwatch[libraryTheme] }} />
                {themeLabel[libraryTheme]}
                <ChevronDown size={13} className={`transition-transform ${showThemeChoices ? 'rotate-180' : ''}`} />
              </button>
              {showThemeChoices && (
                <div className={`fixed inset-x-3 z-[200] rounded-2xl border p-1.5 shadow-2xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-44 ${th.languagePanel}`}>
                  <div className="transition-all duration-150 scale-100 opacity-100">
                    {(Object.keys(themeLabel) as LibraryTheme[]).map(item => (
                      <button
                        key={item}
                        onClick={() => {
                          chooseLibraryTheme(item)
                          setShowThemeChoices(false)
                        }}
                        className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-colors ${libraryTheme === item ? th.menuActive : th.menuItem}`}
                      >
                        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-2 ${libraryTheme === item ? 'ring-white' : 'ring-transparent'}`} style={{ backgroundColor: themeSwatch[item] }}>
                          {libraryTheme === item && <span className="text-[10px] text-white">✓</span>}
                        </span>
                        <span className="flex-1">{themeLabel[item]}</span>
                        {libraryTheme === item && <span className="text-[11px] opacity-60">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Link href="/words" className={`shrink-0 rounded-lg px-2.5 py-2 text-sm sm:px-3 ${th.navBtn}`}>
              {t('common.words')}
            </Link>
            <SyncStatusBadge className="hidden shrink-0 sm:inline-flex" />
            <input ref={backupImportRef} type="file" accept=".zip" className="hidden" onChange={importBackup} />
            <div className="relative shrink-0">
              <button onClick={() => { setShowThemeChoices(false); setShowProfileMenu(false); setShowLibraryMenu(value => !value) }} className={`flex h-9 w-9 items-center justify-center rounded-lg ${th.navBtn}`} title={t('library.backupDownload')}>
                <MoreHorizontal size={17} />
              </button>
              {showLibraryMenu && (
                <div className={`library-floating-menu fixed inset-x-3 z-[200] grid gap-1 rounded-lg border p-1.5 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-48 ${th.languagePanel}`}>
                  <button disabled={backupBusy !== null} onClick={() => { void downloadBackup(); setShowLibraryMenu(false) }} aria-label={t('library.backupDownload')} className={`rounded-md px-3 py-2 text-left text-xs font-semibold disabled:opacity-50 ${th.navBtn}`}>{backupBusy === 'download' ? 'Yedek hazırlanıyor…' : t('library.backupDownload')}</button>
                  <button disabled={backupBusy !== null} onClick={() => { backupImportRef.current?.click(); setShowLibraryMenu(false) }} aria-label={t('library.backupRestore')} className={`rounded-md px-3 py-2 text-left text-xs font-semibold disabled:opacity-50 ${th.navBtn}`}>{backupBusy === 'restore' ? 'Geri yükleniyor…' : t('library.backupRestore')}</button>
                  <Link href="/stats" onClick={() => setShowLibraryMenu(false)} className={`rounded-md px-3 py-2 text-left text-xs font-semibold ${th.navBtn}`}>{t('library.nav.stats')}</Link>
                  {currentUser?.role === 'admin' && (
                    <Link href="/bugs" onClick={() => setShowLibraryMenu(false)} className={`rounded-md px-3 py-2 text-left text-xs font-semibold ${th.navBtn}`}>{t('bug.inboxTitle')}</Link>
                  )}
                  <button onClick={() => { setShowBugReport(true); setShowLibraryMenu(false) }} aria-label={t('bug.title')} className={`rounded-md px-3 py-2 text-left text-xs font-semibold ${th.navBtn}`}>{t('bug.title')}</button>
                  <button onClick={() => { setShowProfileSettings(true); setShowLibraryMenu(false) }} aria-label={t('profile.settings')} className={`rounded-md px-3 py-2 text-left text-xs font-semibold sm:hidden ${th.navBtn}`}>{t('profile.settings')}</button>
                  <button onClick={lockLibrary} aria-label={t('profile.logout')} className="rounded-md px-3 py-2 text-left text-xs font-semibold text-red-300 hover:bg-red-500/10 sm:hidden">{t('profile.logout')}</button>
                </div>
              )}
            </div>
            <button
              onClick={() => { setShowUpload(true); setUploadError('') }}
              className={`hidden shrink-0 rounded-lg px-3 py-2 text-sm font-medium sm:block sm:px-4 ${th.addBtn}`}
            >
              {t('library.addPdf')}
            </button>
            <button
              onClick={() => setShowBookSearch(true)}
              className={`hidden shrink-0 rounded-lg px-3 py-2 text-sm font-medium sm:block sm:px-4 ${th.navBtn}`}
              title={t('sourceSearch.noBooksSearch')}
            >
              <Globe size={17} className="inline-block align-text-top mr-1" />
              {t('sourceSearch.noBooksSearch')}
            </button>
            <div className="relative hidden shrink-0 sm:block">
              <button
                title={currentUser?.username || 'owner'}
                onClick={() => { setShowThemeChoices(false); setShowLibraryMenu(false); setShowProfileMenu(value => !value) }}
                className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border text-xs font-black uppercase ${th.languageButton}`}
              >
                {currentUser?.avatar ? <img src={getAssetUrl(currentUser.avatar)} alt="" className="h-full w-full object-cover" /> : (currentUser?.username || 'O').slice(0, 1)}
              </button>
              {showProfileMenu && (
                <div className={`absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border p-2 shadow-2xl ${th.languagePanel}`}>
                  <div className={`mb-2 border-b px-2 pb-2 ${th.headerBorder}`}>
                    <p className={`truncate text-sm font-bold ${th.title}`}>{currentUser?.username}</p>
                  </div>
                  {currentUser?.role === 'admin' && (
                    <Link href="/admin" onClick={() => setShowProfileMenu(false)} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-bold text-amber-400 hover:bg-amber-400/10 ${th.navBtn}`}>
                      <ShieldCheck size={15} /> Yönetim Paneli
                    </Link>
                  )}
                  <button onClick={() => { setShowProfileSettings(true); setShowProfileMenu(false) }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold ${th.navBtn}`}>
                    <UserRound size={15} /> {t('profile.settings')}
                  </button>
                  <button onClick={() => { setShowLicenses(true); setShowProfileMenu(false) }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold ${th.navBtn}`}>
                    <Scale size={15} /> Açık Kaynak Lisansları
                  </button>
                  <Link href="/terms" onClick={() => setShowProfileMenu(false)} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold ${th.navBtn}`}>
                    <FileText size={15} /> Kullanım Koşulları
                  </Link>
                  <Link href="/privacy" onClick={() => setShowProfileMenu(false)} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold ${th.navBtn}`}>
                    <Shield size={15} /> Gizlilik Politikası
                  </Link>
                  <Link href="/dmca" onClick={() => setShowProfileMenu(false)} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold ${th.navBtn}`}>
                    <Scale size={15} /> Telif Bildirimi (DMCA)
                  </Link>
                  <button onClick={lockLibrary} className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-red-300 hover:bg-red-500/10">
                    <LogOut size={15} /> {t('profile.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {libraryTheme === 'seoul' && (
          <div className="mx-auto max-w-7xl overflow-hidden rounded-b-lg">
            <img src="/themes/seoul/banner.png" alt="Seoul" className="h-20 w-full object-cover object-center opacity-90 sm:h-28" />
          </div>
        )}
        <div className="mx-auto max-w-7xl px-3 pt-2 sm:px-4">
          <LibrarySubnav
            active="home"
            libraryTheme={libraryTheme}
            showAdmin={currentUser?.role === 'admin'}
            showBugs={currentUser?.role === 'admin'}
            showBackups={currentUser?.username === 'owner' && currentUser?.role === 'admin'}
          />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl p-3 sm:p-4">
        {dbError && (
          <div className="mb-4 rounded-lg border border-red-700 bg-red-950/50 p-4 text-sm text-red-200">
            <p className="font-semibold">{t('library.dbTitle')}</p>
            <p className="mt-1 text-red-300">{t('library.dbBody')}</p>
          </div>
        )}

        {loading && (
          <section className={`relative mb-4 overflow-hidden rounded-2xl border ${th.heroPanel}`}>
            <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_320px] lg:p-7">
              <div className="flex min-w-0 flex-col justify-end space-y-4 py-2">
                <div className={`h-5 w-28 rounded ${th.skelLine} skeleton-shimmer`} />
                <div className={`h-10 w-4/5 max-w-md rounded ${th.skelLine} skeleton-shimmer`} />
                <div className={`h-5 w-1/2 max-w-xs rounded ${th.skelLine} skeleton-shimmer`} />
                <div className={`h-2.5 w-full max-w-xl rounded-full ${th.skelLine} skeleton-shimmer`} />
                <div className="flex gap-3">
                  <div className={`h-11 w-36 rounded-xl ${th.skelLine} skeleton-shimmer`} />
                  <div className={`h-11 w-32 rounded-xl ${th.skelLine} skeleton-shimmer`} />
                </div>
              </div>
              <div className="hidden lg:block">
                <div className={`mx-auto aspect-[3/4] w-full max-w-[260px] rounded-lg ${th.skelImg} skeleton-shimmer`} />
              </div>
            </div>
          </section>
        )}

        {!loading && heroBook && (
            <section className={`fade-in-up library-hero-canvas library-card-reveal relative mb-4 overflow-hidden rounded-2xl border ${th.heroPanel}`}>
            {heroBook.thumbnail && (
              <img loading="lazy" decoding="async" src={getAssetUrl(heroBook.thumbnail)} alt="" className="library-hero-ambient pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.18] blur-xl" draggable={false} />
            )}
            <div className={`absolute inset-0 ${th.heroOverlay}`} />
            <div className="relative grid gap-4 p-4 sm:gap-5 sm:p-5 lg:grid-cols-[1fr_320px] lg:p-7">
              <div className="order-2 flex min-w-0 flex-col justify-end py-2 lg:order-1">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${th.heroBadge}`}>{t('reader.whereLeft')}</span>
                  <span className={`rounded px-2 py-1 text-xs ${heroBook.status === 'finished' ? th.statusFinished : heroBook.status === 'planned' ? th.statusPlanned : th.statusReading}`}>
                    {statusLabel(heroBook.status)}
                  </span>
                  {isEpubBook(heroBook) && <span className={`rounded px-2 py-1 text-xs ${th.bookTag}`}>EPUB</span>}
                </div>
                 <h2 className={`max-w-3xl text-3xl font-black leading-tight tracking-tight sm:text-5xl ${th.title}`}>{cleanText(heroBook.title)}</h2>
                {heroBook.author && <p className={`mt-2 text-lg font-semibold ${th.bookAuthor}`}>{cleanText(heroBook.author)}</p>}
                <div className="mt-6 max-w-xl">
                  <div className={`mb-2 flex items-center justify-between text-xs font-semibold ${th.bookMeta}`}>
                    <span>{t('common.pageShort')} {heroBook.last_page || 1} / {heroBook.total_pages || '?'}</span>
                    <span>{progress(heroBook)}%</span>
                  </div>
                  <div className="liquid-glass-progress-bg h-2.5 overflow-hidden rounded-full">
                    <div className="liquid-glass-progress-fill" style={{ width: `${progress(heroBook)}%`, '--progress-color': th.progressColor, '--progress-glow': th.progressGlow } as React.CSSProperties} />
                  </div>
                  <p className={`mt-2 text-xs font-semibold ${th.bookMeta}`}>
                    {t('library.totalReadTime')}: {formatReadingTime(heroBook.total_reading_time || 0, t)}
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link
                    href={`/reader/${heroBook.id}`}
                    prefetch
                    onClick={() => patchBook(heroBook.id, { last_opened_at: new Date().toISOString() }, true)}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-3 text-sm font-black shadow-lg transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0.5 active:scale-[0.98] ${th.addBtn}`}
                  >
                    <Play size={17} fill="currentColor" />
                    {t('library.hero.continueBtn')}
                  </Link>
                  <button onClick={() => setShowUpload(true)} aria-label="Dosya yükle" className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-5 py-3 text-sm font-bold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0.5 active:scale-[0.98] ${th.heroSecondary}`}>
                    <Upload size={17} />
                    {t('library.addBook')}
                  </button>
                </div>
              </div>
              <div className="order-1 mx-auto w-full max-w-[132px] sm:max-w-[180px] lg:order-2 lg:max-w-[260px]">
                {heroBook.thumbnail && (
                  <div className="absolute inset-0 -z-10 translate-x-[-8%] translate-y-[4%] scale-[1.08] opacity-40 blur-[5px] select-none pointer-events-none lg:translate-x-[-12%] lg:scale-[1.06] lg:opacity-45">
                    <img 
                      src={getAssetUrl(heroBook.thumbnail)} 
                      alt="" 
                      className="h-full w-full object-cover rounded-xl" 
                      draggable={false} 
                      fetchPriority="high"
                    />
                  </div>
                )}
                <div className="library-shine relative mx-auto overflow-hidden rounded-lg border border-[var(--lib-border)] bg-[var(--lib-surface-strong)] p-2 shadow-[0_24px_60px_var(--lib-shadow)] sm:p-3">
                  <BookThumbnail
                    filepath={`/api/pdf/${encodeURIComponent(heroBook.filename)}`}
                    title={cleanText(heroBook.title)}
                    thumbnail={heroBook.thumbnail}
                    placeholderImage={libraryTheme === 'seoul' ? '/themes/seoul/placeholder.png' : undefined}
                    light={libraryTheme === 'seoul'}
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3 ${th.statCard}`}>
                  <div className={`h-3 w-16 rounded ${th.skelLine} skeleton-shimmer`} />
                  <div className={`mt-2 h-7 w-12 rounded ${th.skelLine} skeleton-shimmer`} />
                </div>
              ))
            : [
            [t('library.stat.books'), stats.books],
            [t('library.stat.reading'), stats.reading],
            [t('library.stat.finished'), stats.finished],
            [t('library.stat.notes'), stats.notes],
            [t('library.stat.words'), stats.words],
            [t('library.stat.time'), formatReadingTime(stats.readingTime, t)],
          ].map(([label, value]) => (
            <div key={label} className={`library-stat-chip rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg active:scale-98 ${th.statCard}`}>
              <p className={`text-xs uppercase tracking-wide ${th.statLabel}`}>{label}</p>
              <p className={`mt-1 text-xl font-semibold sm:text-2xl ${th.statValue}`}>{value}</p>
            </div>
          ))}
        </section>

        <section className={`library-search-panel mt-4 rounded-xl border p-3 shadow-sm backdrop-blur-xl ${th.searchSection}`}>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${th.bookMeta}`} size={17} />
              <input
                type="text"
                placeholder={t('library.searchPlaceholder')}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className={`w-full rounded-xl py-2.5 pl-9 pr-3 text-sm outline-none transition-all duration-200 liquid-glass-input ${th.input}`}
                style={{
                  '--focus-color': th.progressColor,
                  '--focus-glow': th.progressGlow,
                } as React.CSSProperties}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('grid')}
                aria-label="Izgara görünümü"
                aria-pressed={viewMode === 'grid'}
                className={`p-2 rounded-lg border transition-all ${viewMode === 'grid' ? th.filterActive : th.filterInactive}`}
                title="Izgara Görünümü"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                aria-label="Liste görünümü"
                aria-pressed={viewMode === 'list'}
                className={`p-2 rounded-lg border transition-all ${viewMode === 'list' ? th.filterActive : th.filterInactive}`}
                title="Liste Görünümü"
              >
                <List size={16} />
              </button>
              <button
                onClick={enrichAllMetadata}
                disabled={isEnrichingMetadata}
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${th.filterInactive}`}
                title="Mevcut Kitapların Metaverilerini Otomatik İyileştir"
              >
                <Wand2 size={15} className="text-amber-400" />
                <span className="hidden md:inline">{isEnrichingMetadata ? 'İyileştiriliyor...' : 'Metaveri İyileştir'}</span>
              </button>
              <Link
                href="/workspace"
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${th.filterInactive}`}
                title="Görsel Çalışma Alanı (Visual Canvas)"
              >
                <Layers size={15} className="text-[var(--lib-accent)]" />
                <span className="hidden md:inline">Tuval</span>
              </Link>
              <Link
                href="/knowledge-graph"
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold ${th.filterInactive}`}
                title={t('graph.title')}
              >
                <Network size={15} className="text-[var(--lib-accent)]" />
                <span className="hidden md:inline">{t('graph.nav')}</span>
              </Link>
              <button
                onClick={() => setShowTrashBinModal(true)}
                className={`p-2.5 rounded-xl border transition-all ${th.filterInactive}`}
                title="Çöp Kutusu & Geri Yükleme"
              >
                <Trash2 size={16} className="text-red-400" />
              </button>
              <button
                onClick={() => setShowDeviceModal(true)}
                className={`p-2.5 rounded-xl border transition-all ${th.filterInactive}`}
                title="Bağlı Cihazlar & Senkronizasyon"
              >
                <TabletSmartphone size={16} className="text-blue-400" />
              </button>
              <button
                onClick={() => {
                  setBulkMode(value => !value)
                  setSelectedBookIds([])
                }}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold ${bulkMode ? th.filterActive : th.filterInactive}`}
              >
                <ListChecks size={16} />
                {bulkMode ? t('library.bulk.exit') : t('library.bulk.mode')}
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2 overflow-x-auto pb-0.5">
              {(['all', 'reading', 'planned', 'finished', 'inbox', 'paused', 'completed', 'reference', 'archived', 'favorite'] as const).map(item => (
                <button
                  key={item}
                  onClick={() => setStatusFilter(item)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium ${statusFilter === item ? th.filterActive : th.filterInactive}`}
                >
                  {statusLabel(item)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={customFilter}
                onChange={e => setCustomFilter(e.target.value as typeof customFilter)}
                className={`rounded-lg border px-3 py-2 text-xs outline-none ${th.select}`}
              >
                <option value="all">Tüm Kitaplar</option>
                <option value="has_notes">Not İçerenler</option>
                <option value="offline_ready">Çevrimdışı Hazır</option>
                <option value="missing_metadata">Metaverisi Eksikler</option>
              </select>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                className={`w-full shrink-0 rounded-lg border px-3 py-2 text-sm outline-none sm:w-auto ${th.select}`}
              >
                <option value="recent">{t('sort.recent')}</option>
                <option value="title">{t('sort.title')}</option>
                <option value="progress">{t('sort.progress')}</option>
              </select>
            </div>
          </div>

          <div className={`mt-3 border-t pt-3 ${th.separator}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                onClick={() => setFullTextOpen(value => !value)}
                aria-expanded={fullTextOpen}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${fullTextOpen ? th.filterActive : th.searchBtn}`}
              >
                <FileText size={15} />
                {t('library.search.fullText')}
              </button>
              {fullTextOpen && (
                <>
                  <input
                    value={fullTextQuery}
                    onChange={e => setFullTextQuery(e.target.value)}
                    placeholder={t('library.search.placeholder')}
                    className={`min-h-10 flex-1 rounded-lg border px-3 py-2 text-sm outline-none ${th.searchInput}`}
                  />
                  <button onClick={() => runFullTextSearch()} disabled={fullTextIndexing} className={`min-h-10 rounded-lg px-3 py-2 text-sm font-medium ${th.searchRunBtn}`}>
                    {fullTextIndexing ? t('library.search.indexing') : t('library.search.run')}
                  </button>
                </>
              )}
            </div>
            {fullTextOpen && (
              <div className="mt-3">
                {(fullTextIndexing || fullTextBackgroundIndexing) && <p className={`text-xs ${th.bookMeta}`}>{t('library.search.indexing')}: {fullTextProgress || t('library.title')}</p>}
                {fullTextError && <p role="alert" className="text-xs text-red-300">{fullTextError}</p>}
                {!fullTextIndexing && !fullTextBackgroundIndexing && !fullTextError && fullTextQuery.trim().length >= 2 && fullTextResults.length === 0 && <p className={`text-xs ${th.bookMeta}`}>{t('library.search.noResults')}</p>}
                {fullTextResults.length > 0 && (
                  <div className="grid gap-2 md:grid-cols-2">
                    {fullTextResults.map(result => {
                      const q = cleanText(fullTextQuery).toLocaleLowerCase(locale)
                      const pos = result.text.toLocaleLowerCase(locale).indexOf(q)
                      const snippet = cleanText(result.text.slice(Math.max(0, pos - 70), pos > -1 ? pos + q.length + 150 : 220))
                      return (
                        <Link
                          key={`${result.bookId}-${result.page}-${result.id}`}
                          href={`/reader/${result.bookId}`}
                          onClick={() => patchBook(result.bookId, { last_page: result.page }, true)}
                          className={`rounded-lg border p-3 ${th.searchResultCard}`}
                        >
                          <p className={`text-sm font-semibold ${th.searchResultTitle}`}>{result.title}</p>
                          <p className={`mt-1 text-xs ${th.searchResultPage}`}>Sayfa {result.page}</p>
                          <p className={`mt-2 line-clamp-3 text-xs leading-relaxed ${th.searchResultSnippet}`}>{snippet}</p>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label={t('library.categories')}>
            <button type="button" onClick={() => setShowBookCategoryManager(true)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${th.filterInactive}`}>
              <Settings2 size={13} />
              {t('library.manageCategories')}
            </button>
          {categories.length > 0 && (
            <>
            <button onClick={() => setCategoryFilter('all')} className={`rounded-full px-3 py-1 text-xs ${categoryFilter === 'all' ? th.filterActive : th.catPill}`}>
              {t('common.all')}
            </button>
            {categories.map(item => (
              <button key={item} onClick={() => setCategoryFilter(item)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${categoryFilter === item ? th.filterActive : th.catPill}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bookCategories.find(category => category.name === item)?.color || '#94a3b8' }} />
                {item}
              </button>
            ))}
            </>
          )}
        </div>

        {bulkMode && (
          <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl border p-3 ${th.card}`}>
            <span className={`text-sm font-semibold ${th.title}`}>{t('library.bulk.selected', { count: selectedBookIds.length })}</span>
            <button onClick={() => runBulkAction('favorite')} disabled={!selectedBookIds.length} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${th.filterInactive}`}>{t('library.bulk.favorite')}</button>
            <button onClick={() => runBulkAction('reading')} disabled={!selectedBookIds.length} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${th.filterInactive}`}>{t('library.bulk.statusReading')}</button>
            <button onClick={() => runBulkAction('planned')} disabled={!selectedBookIds.length} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${th.filterInactive}`}>{t('library.bulk.statusPlanned')}</button>
            <button onClick={() => runBulkAction('finished')} disabled={!selectedBookIds.length} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${th.filterInactive}`}>{t('library.bulk.statusFinished')}</button>
            <select value={bulkCategoryId || ''} onChange={event => setBulkCategoryId(Number(event.target.value))} className={`min-h-9 rounded-lg border px-2 text-xs ${th.select}`}>
              <option value="">{t('library.manageCategories')}</option>
              {bookCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <button onClick={() => runBulkCategory('add')} disabled={!selectedBookIds.length || !bulkCategoryId} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${th.filterInactive}`}>{t('library.bulk.addCategory')}</button>
            <button onClick={() => runBulkCategory('remove')} disabled={!selectedBookIds.length || !bulkCategoryId} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${th.filterInactive}`}>{t('library.bulk.removeCategory')}</button>
            <button onClick={() => handleOpenTransferModal(selectedBookIds)} disabled={!selectedBookIds.length} className="flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-400/20 px-3 py-1.5 text-xs font-bold text-amber-400 hover:bg-amber-400/30 disabled:opacity-40"><Send size={13} /> Transfer Et / Gönder</button>
            <button onClick={() => runBulkAction('delete')} disabled={!selectedBookIds.length} className="rounded-lg bg-red-600/90 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{t('library.bulk.delete')}</button>
          </div>
        )}

        {duplicateGroups.length > 0 && (
          <div className={`mt-3 rounded-xl border px-4 py-3 text-sm ${cinematic ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            {t('library.duplicate.groups', { count: duplicateGroups.length })}
            <div className="mt-2 space-y-1 text-xs opacity-90">
              {duplicateGroups.slice(0, 3).map(group => (
                <p key={group.map(book => book.id).join('-')}>{t('library.duplicate.warning', { title: cleanText(group[0].title) })}</p>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={th.skelCard}>
                <div className={`${th.skelImg} skeleton-shimmer`} />
                <div className="space-y-2 p-3">
                  <div className={`h-3 w-3/4 rounded ${th.skelLine} skeleton-shimmer`} />
                  <div className={`h-3 w-1/2 rounded ${th.skelLine} skeleton-shimmer`} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !dbError && books.length === 0 && (
          <div className="py-16 text-center">
            {th.emptyImg && (
              <img loading="lazy" decoding="async" src={th.emptyImg} alt="Empty library" className="mx-auto mb-6 h-56 w-56 object-contain opacity-90" />
            )}
            <p className={`text-xl font-semibold tracking-tight ${th.emptyTitle}`}>{t('library.noBooksTitle')}</p>
            <p className={`mt-2 text-sm leading-relaxed mx-auto max-w-sm ${th.emptyBody}`}>{t('library.noBooksBody')}</p>
            <button
              onClick={() => setShowBookSearch(true)}
              className={`mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${th.addBtn}`}
            >
              <Globe size={18} />
              {t('sourceSearch.noBooksSearch')}
            </button>
          </div>
        )}

        {!loading && !dbError && books.length > 0 && filtered.length === 0 && (
          <div className={`mt-5 rounded-2xl border px-6 py-12 text-center ${th.emptyPanel}`}>
            <Filter className={`mx-auto mb-3 ${th.bookPageLabel}`} size={26} />
            <p className={`text-lg font-semibold ${th.title}`}>Bu filtrelerle eşleşen kitap yok</p>
            <p className={`mx-auto mt-2 max-w-md text-sm ${th.emptyBody}`}>Arama veya filtreleri temizleyerek tüm kitaplarını tekrar görebilirsin.</p>
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
                setCustomFilter('all')
                setCategoryFilter('all')
              }}
              className={`mt-5 rounded-xl px-4 py-2.5 text-sm font-semibold ${th.filterActive}`}
            >
              Filtreleri temizle
            </button>
          </div>
        )}

        {!loading && books.length > 0 && filtered.length > 0 && (
          <section className="mt-5">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className={`text-xs font-black uppercase tracking-[0.18em] ${th.bookPageLabel}`}>{t('library.allBooksLabel')}</p>
                <h2 className={`text-2xl font-black ${th.title}`}>{t('library.allBooks')}</h2>
              </div>
              <p className={`text-sm ${th.bookMeta}`}>{t('library.results', { count: filtered.length })}</p>
            </div>
            <div className={viewMode === 'grid' ? "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" : "space-y-2"}>
              {filtered.map((book, bookIndex) => {
                const tags = parseTags(book.tags)
                const isEpub = isEpubBook(book)
                if (viewMode === 'list') {
                  return (
                    <div
                      key={book.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${selectedBookIds.includes(book.id) ? 'ring-2 ring-[var(--lib-accent)]' : ''} ${th.bookCard}`}
                    >
                      {bulkMode && (
                        <button
                          type="button"
                          onClick={() => toggleBookSelection(book.id)}
                          className={`rounded-md border px-2 py-1 text-xs font-bold ${selectedBookIds.includes(book.id) ? 'border-[var(--lib-accent)] bg-[var(--lib-accent)] text-white' : 'border-[var(--lib-border)] bg-[var(--lib-surface-muted)] text-[var(--lib-text)]'}`}
                        >
                          {selectedBookIds.includes(book.id) ? '✓' : '+'}
                        </button>
                      )}
                      <Link
                        href={bulkMode ? '#' : `/reader/${book.id}`}
                        onClick={e => {
                          if (bulkMode) {
                            e.preventDefault()
                            toggleBookSelection(book.id)
                          } else {
                            patchBook(book.id, { last_opened_at: new Date().toISOString() }, true)
                          }
                        }}
                        className="relative block h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--lib-surface-muted)]"
                      >
                        <BookThumbnail
                          filepath={isEpub ? '' : `/api/pdf/${encodeURIComponent(book.filename)}`}
                          title={cleanText(book.title)}
                          thumbnail={book.thumbnail}
                        />
                      </Link>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/reader/${book.id}`}
                            onClick={() => patchBook(book.id, { last_opened_at: new Date().toISOString() }, true)}
                            className={`truncate text-sm font-bold transition-colors hover:text-[var(--lib-accent-soft)] ${th.bookTitle}`}
                          >
                            {cleanText(book.title)}
                          </Link>
                          {book.rating ? (
                            <span className="flex items-center text-amber-400 text-xs font-semibold">
                              <Star className="w-3 h-3 fill-amber-400 mr-0.5" />
                              {book.rating}
                            </span>
                          ) : null}
                        </div>

                        <div className={`mt-0.5 flex flex-wrap items-center gap-2 text-xs ${th.bookAuthor}`}>
                          {book.author && <span>{cleanText(book.author)}</span>}
                          {book.isbn && <span className={`rounded px-1.5 py-0.5 text-[10px] ${th.cardBadge}`}>ISBN: {book.isbn}</span>}
                          {book.language && <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${th.cardBadge}`}>{book.language}</span>}
                          <span className={th.bookMeta}>• Sayfa {book.last_page || 1} / {book.total_pages || '?'} ({progress(book)}%)</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => patchBook(book.id, { favorite: book.favorite ? 0 : 1 })}
                          className={`rounded-lg p-1.5 text-xs font-semibold ${book.favorite ? th.touchFavOn : th.touchFavOff}`}
                          title="Favori"
                        >
                          <Star className={`w-4 h-4 ${book.favorite ? 'fill-amber-400' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleOpenTransferModal([book.id])}
                          className="flex items-center gap-1 rounded-lg bg-amber-400/20 px-2.5 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-400/30"
                          title="Kitap Transfer Et / Gönder"
                        >
                          <Send size={12} />
                          Transfer
                        </button>
                        {!book.is_encrypted && !isEpub && (
                          <Link href={`/compare?a=${book.id}`} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${th.desktopActBg}`} title="Karşılaştırmaya ekle">
                            <Columns2 size={12} /> Karşılaştır
                          </Link>
                        )}
                        <button
                          onClick={() => setEditing(book)}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${th.touchEdit}`}
                        >
                          Düzenle
                        </button>
                        <button
                          onClick={() => deleteBook(book.id)}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${th.touchDel}`}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  )
                }

                return (
                   <div key={book.id} className={`library-book-card stagger-reveal group relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-300 ease-out shadow-[0_2px_12px_-4px_var(--lib-shadow)] motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.015] ${selectedBookIds.includes(book.id) ? 'ring-2 ring-[var(--lib-accent)]' : ''} ${th.bookCard}`} style={{ '--card-accent': th.progressColor, '--stagger-i': bookIndex } as React.CSSProperties}>
                    {bulkMode && (
                      <button
                        type="button"
                        onClick={() => toggleBookSelection(book.id)}
                        className={`absolute left-2 top-2 z-20 rounded-md border px-2 py-1 text-[10px] font-bold ${selectedBookIds.includes(book.id) ? 'border-[var(--lib-accent)] bg-[var(--lib-accent)] text-white' : 'border-[var(--lib-border)] bg-[var(--lib-surface-muted)] text-[var(--lib-text)]'}`}
                      >
                        {selectedBookIds.includes(book.id) ? '✓' : '+'}
                      </button>
                    )}
                    <Link
                      href={bulkMode ? '#' : `/reader/${book.id}`}
                      prefetch={!bulkMode}
                      onClick={event => {
                        if (bulkMode) {
                          event.preventDefault()
                          toggleBookSelection(book.id)
                          return
                        }
                        patchBook(book.id, { last_opened_at: new Date().toISOString() }, true)
                      }}
                      className="block"
                    >
                      <div className="library-shine relative overflow-hidden">
                        <BookThumbnail
                          filepath={isEpub ? '' : `/api/pdf/${encodeURIComponent(book.filename)}`}
                          title={cleanText(book.title)}
                          thumbnail={book.thumbnail}
                          placeholderImage={libraryTheme === 'seoul' ? '/themes/seoul/placeholder.png' : undefined}
                          light={libraryTheme === 'seoul'}
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                        <div className="absolute bottom-0 left-0 h-1.5 w-full liquid-glass-progress-bg">
                          <div className="liquid-glass-progress-fill" style={{ width: `${progress(book)}%`, '--progress-color': th.progressColor, '--progress-glow': th.progressGlow } as React.CSSProperties} />
                        </div>
                      </div>
                    </Link>
                    <div className="p-3">
                      <Link
                        href={`/reader/${book.id}`}
                        prefetch
                        onClick={() => patchBook(book.id, { last_opened_at: new Date().toISOString() }, true)}
                        className={`line-clamp-2 text-sm font-bold leading-snug ${th.bookTitle} hover:text-[var(--lib-accent-soft)]`}
                      >
                        {cleanText(book.title)}
                      </Link>
                      <p className={`mt-1 truncate text-xs ${th.bookAuthor}`}>{cleanText(book.author || book.category || '')}</p>
                      {!!book.categories?.length && (
                        <div className="mt-2 flex max-h-11 flex-wrap gap-1 overflow-hidden">
                          {book.categories.slice(0, 4).map(category => (
                            <span key={category.id} className="rounded-full border px-2 py-0.5 text-[9px] font-semibold" style={{ borderColor: `${category.color}66`, color: category.color, backgroundColor: `${category.color}12` }}>{category.name}</span>
                          ))}
                        </div>
                      )}
                      <div className={`mt-2 flex items-center justify-between text-[11px] ${th.bookMeta}`}>
                        <span>{progress(book)}%</span>
                        {isEpub && <span>EPUB</span>}
                      </div>
                      <BookReadingMeta book={book} th={th} t={t} />
                      <div className="mt-2 grid grid-cols-4 gap-1 lg:hidden">
                        <button onClick={() => patchBook(book.id, { favorite: book.favorite ? 0 : 1 })} aria-label="Favorilere ekle/kaldir" className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${book.favorite ? th.touchFavOn : th.touchFavOff}`}>
                          {book.favorite ? t('library.unstar') : t('library.star')}
                        </button>
                        <button onClick={() => setEditing(book)} aria-label="Kitabi düzenle" className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${th.touchEdit}`}>{t('common.edit')}</button>
                        <button onClick={() => deleteBook(book.id)} className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${th.touchDel}`}>{t('common.delete')}</button>
                        {!book.is_encrypted && !isEpub && <Link href={`/compare?a=${book.id}`} className={`inline-flex items-center justify-center rounded-lg px-2 py-2 text-[11px] font-semibold ${th.filterInactive}`}>Karşılaştır</Link>}
                      </div>
                    </div>
                    <div className="absolute right-3 top-3 z-10 hidden items-center gap-1 rounded-xl border border-[var(--lib-border)] bg-[var(--lib-surface-strong)] p-1 opacity-0 shadow-xl backdrop-blur-md transition-all duration-300 group-hover:opacity-100 group-focus-within:opacity-100 lg:flex">
                      <button onClick={() => handleOpenTransferModal([book.id])} title="Kitap Transfer Et / Gönder" className={`rounded-lg px-2 py-1 text-xs font-semibold ${th.desktopActBg} text-amber-400 flex items-center gap-1`}>
                        <Send size={12} />
                        Transfer
                      </button>
                      {!book.is_encrypted && !isEpub && <Link href={`/compare?a=${book.id}`} title="Karşılaştırmaya ekle" className={`rounded-lg px-2 py-1 text-xs font-semibold ${th.desktopActBg} flex items-center gap-1`}><Columns2 size={12} /> Karşılaştır</Link>}
                      <button onClick={() => patchBook(book.id, { favorite: book.favorite ? 0 : 1 })} aria-label="Favorilere ekle/kaldir" className={`rounded-lg px-2 py-1 text-xs font-semibold ${th.desktopActBg} ${th.favLabel}`}>
                        {book.favorite ? t('library.unstar') : t('library.star')}
                      </button>
                      <button onClick={() => setEditing(book)} aria-label="Kitabi düzenle" className={`rounded-lg px-2 py-1 text-xs font-semibold ${th.desktopActBg} ${th.bookTitle}`}>{t('common.edit')}</button>
                      <button onClick={() => deleteBook(book.id)} aria-label="Kitabi sil" className="rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500">{t('common.delete')}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {showDiscoveryShelves && discoveryShelves.rows.length > 0 && (
          <div className={`fade-in-up mt-8 space-y-5 border-t pt-5 ${th.separator}`}>
            {discoveryShelves.rows.map(row => (
              <LibraryShelf
                key={row.key}
                title={shelfTitle(row.key)}
                books={row.books}
                libraryTheme={libraryTheme}
                th={th}
                t={t}
                patchBook={patchBook}
                setEditing={setEditing}
                deleteBook={deleteBook}
              />
            ))}
          </div>
        )}
      </main>

      <SmoothOverlay open={showUpload} onClose={() => {
        setShowUpload(false)
        setCustomThumbnail('')
        setSelectedUploadFiles([])
        if (fileRef.current) fileRef.current.value = ''
        if (thumbnailRef.current) thumbnailRef.current.value = ''
      }} panelClassName={`max-w-lg rounded-xl border p-4 shadow-2xl sm:p-5 ${cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'}`}>
            <h2 className={`mb-4 text-base font-bold sm:text-lg ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>{t('upload.title')}</h2>
            <form onSubmit={handleUpload} className="flex flex-col gap-3">
              <label className={`cursor-pointer rounded-xl border border-dashed p-4 text-center text-sm transition ${cinematic ? 'border-white/18 bg-white/[0.04] text-slate-300 hover:bg-white/[0.07]' : 'border-[#DDD9D0] bg-white text-[#5A5245] hover:bg-[#EDE9E1]'}`}>
                <Upload className={`mx-auto mb-2 h-5 w-5 ${cinematic ? 'text-slate-400' : 'text-[#7A7060]'}`} />
                <span className={`font-semibold ${cinematic ? 'text-slate-100' : 'text-[#1C1A17]'}`}>{t('library.addPdf')}</span>
                <span className={`mt-1 block text-xs ${cinematic ? 'text-slate-500' : 'text-[#7A7060]'}`}>PDF veya EPUB</span>
                <input
                  type="file"
                  accept=".pdf,.epub,application/pdf,application/epub+zip"
                  multiple
                  ref={fileRef}
                  required
                  onChange={event => {
                    const files = Array.from(event.target.files || [])
                    setSelectedUploadFiles(files)
                    setUploadError('')
                    if (files.length > 1) {
                      setTitle('')
                      setCustomThumbnail('')
                      if (thumbnailRef.current) thumbnailRef.current.value = ''
                    }
                  }}
                  className="sr-only"
                />
              </label>
              {selectedUploadFiles.length > 0 && (
                <div className={`max-h-24 overflow-y-auto rounded-lg border px-3 py-2 text-xs ${cinematic ? 'border-slate-800 bg-slate-950/60 text-slate-300' : 'border-[#DDD9D0] bg-[#FAF8F3] text-[#5A5245]'}`}>
                  <p className={`mb-1 font-medium ${cinematic ? 'text-slate-100' : 'text-[#1C1A17]'}`}>{t('library.upload.filesSelected', { count: selectedUploadFiles.length })}</p>
                  {selectedUploadFiles.slice(0, 6).map(file => (
                    <p key={`${file.name}-${file.size}`} className="truncate">{file.name}</p>
                  ))}
                  {selectedUploadFiles.length > 6 && <p className={cinematic ? 'text-slate-500' : 'text-[#7A7060]'}>{t('library.upload.moreFiles', { count: selectedUploadFiles.length - 6 })}</p>}
                </div>
              )}
              <input type="text" placeholder={selectedUploadFiles.length > 1 ? t('library.upload.bulkTitleHint') : t('upload.bookTitle')} value={title} onChange={e => setTitle(e.target.value)} disabled={selectedUploadFiles.length > 1} className={`rounded-lg border px-3 py-2.5 text-sm outline-none disabled:opacity-50 ${th.input}`} />
              {selectedUploadFiles.length <= 1 && (
                <MetadataAutocomplete title={title} libraryTheme={libraryTheme} onSelect={suggestion => {
                  setTitle(suggestion.title)
                  setAuthor(suggestion.author)
                  const matchedCategory = bookCategories.find(item => item.name.toLocaleLowerCase() === suggestion.category.toLocaleLowerCase())
                  setUploadCategoryIds(matchedCategory ? [matchedCategory.id] : [])
                  setTags(suggestion.tags?.join(', ') || '')
                }} />
              )}
              <input type="text" placeholder={t('upload.author')} value={author} onChange={e => setAuthor(e.target.value)} className={`rounded-lg border px-3 py-2.5 text-sm outline-none ${th.input}`} />
              <BookCategoryMultiSelect
                categories={bookCategories}
                selected={uploadCategoryIds}
                onChange={setUploadCategoryIds}
                label={t('library.manageCategories')}
                buttonClass={th.catPill}
              />
              <input type="text" placeholder={t('upload.tags')} value={tags} onChange={e => setTags(e.target.value)} className={`rounded-lg border px-3 py-2.5 text-sm outline-none ${th.input}`} />

              {/* E2EE encryption toggle — only shown when vault key is active */}
              {vaultKey && (
                <button
                  type="button"
                  onClick={() => setEncryptUpload(v => !v)}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-all ${
                    encryptUpload
                      ? cinematic
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-[#4A9B8E]/40 bg-[#4A9B8E]/10 text-[#2D6B62]'
                      : cinematic
                        ? 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.07]'
                        : 'border-[#DDD9D0] bg-white text-[#7A7060] hover:bg-[#EDE9E1]'
                  }`}
                >
                  <Shield size={15} className={encryptUpload ? 'text-emerald-400' : ''} />
                  <span className="flex-1 text-left">
                    {encryptUpload ? t('upload.encryptActive') : t('upload.e2ee')}
                  </span>
                  <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                    encryptUpload
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : cinematic ? 'bg-white/[0.07] text-slate-500' : 'bg-[#EDE9E1] text-[#7A7060]'
                  }`}>
                    {encryptUpload ? t('upload.on') : t('upload.off')}
                  </span>
                </button>
              )}
              {encryptUpload && (
                <p className={`-mt-1 text-[11px] px-1 ${cinematic ? 'text-emerald-400/80' : 'text-[#4A9B8E]'}`}>
                  {t('upload.e2eeHint')}
                </p>
              )}


              <div className={`rounded-lg border p-3 ${th.card} ${selectedUploadFiles.length > 1 ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-sm font-semibold ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>{t('upload.thumbnail')}</p>
                    <p className={`mt-1 text-xs ${cinematic ? 'text-[#8d8986]' : 'text-[#7A7060]'}`}>{t('upload.thumbnailHint')}</p>
                  </div>
                  {customThumbnail && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomThumbnail('')
                        if (thumbnailRef.current) thumbnailRef.current.value = ''
                      }}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${cinematic ? 'bg-white/[0.08] text-[#d6d3d1] hover:bg-white/[0.14] hover:text-white' : 'bg-[#EDE9E1] text-[#5A5245] hover:bg-[#E4E0D7]'}`}
                    >
                      {t('upload.thumbnailRemove')}
                    </button>
                  )}
                </div>
                <div className={`mt-3 grid gap-3 ${customThumbnail ? 'grid-cols-[5.5rem_minmax(0,1fr)] items-center' : ''}`}>
                  {customThumbnail && (
                    <div className={`overflow-hidden rounded-md border ${cinematic ? 'border-white/10 bg-black' : 'border-[#DDD9D0] bg-white'}`}>
                      <BookThumbnail filepath="" title={cleanText(title).trim() || t('upload.bookTitle')} thumbnail={customThumbnail} light={!cinematic} />
                    </div>
                  )}
                  <label className={`flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-center text-xs font-semibold transition ${selectedUploadFiles.length > 1 ? 'cursor-not-allowed' : ''} ${uploadHoverClass}`}>
                    <Upload size={16} className="text-[var(--lib-accent)]" />
                    <span>{t('upload.thumbnail')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      ref={thumbnailRef}
                      onChange={handleThumbnailInputChange}
                      disabled={selectedUploadFiles.length > 1}
                      className="sr-only"
                    />
                  </label>
                  </div>
              </div>
              {uploadError && <p className="rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-300">{uploadError}</p>}
              <div className="mt-1 flex gap-3">
                <button type="button" onClick={() => {
                  setShowUpload(false)
                  setCustomThumbnail('')
                  setSelectedUploadFiles([])
                  if (fileRef.current) fileRef.current.value = ''
                  if (thumbnailRef.current) thumbnailRef.current.value = ''
                }} className={`flex-1 rounded-lg py-2.5 text-sm transition ${cinematic ? 'bg-white/10 text-white hover:bg-white/15' : 'border border-[#DDD9D0] bg-white text-[#5A5245] hover:bg-[#EDE9E1]'}`}>{t('common.cancel')}</button>
                <button type="submit" disabled={uploading} className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition disabled:opacity-50 ${libraryTheme === 'dark' ? 'bg-[#e50914] text-white hover:bg-[#f6121d]' : libraryTheme === 'seoul' ? 'bg-[#4A9B8E] text-white hover:bg-[#3D8A7E]' : th.addBtn}`}>{uploading ? t('upload.uploading') : selectedUploadFiles.length > 1 ? t('library.upload.addBooks') : t('library.addPdf')}</button>
              </div>
            </form>
      </SmoothOverlay>

      {showBookSearch && <BookSourceSearch
        libraryTheme={libraryTheme}
        th={th}
        cinematic={cinematic}
        t={t}
        toast={toast}
        onClose={() => setShowBookSearch(false)}
        onImported={() => {
          setShowBookSearch(false)
          window.location.reload()
        }}
      />}

      {editing && (
        <MetadataEditModal
          initialData={{
            id: editing.id,
            title: editing.title,
            author: editing.author,
            isbn: editing.isbn || '',
            doi: editing.doi || '',
            publication_year: editing.publication_year || undefined,
            publisher: editing.publisher || '',
            publication: editing.publication || '',
            volume: editing.volume || '',
            issue: editing.issue || '',
            pages: editing.pages || '',
            edition: editing.edition || '',
            language: editing.language || 'tr',
            total_pages: editing.total_pages || 0,
            rating: editing.rating || 0,
            description: editing.description || '',
            status: editing.status || 'reading',
            rtl: editing.rtl || 0,
            thumbnail: editing.thumbnail,
          }}
          categories={bookCategories}
          onClose={() => setEditing(null)}
          onSave={async data => {
            await patchBook(editing.id, data as BookPatch)
            setEditing(null)
            toast(t('library.bookUpdated'))
          }}
        />
      )}

      {showBookCategoryManager && (
        <AnnotationCategoryManager
          endpoint="/api/book-categories"
          categories={bookCategories}
          books={books}
          themeStyle={{
            panel: cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]',
            button: cinematic ? 'border-white/10 bg-white/[0.06] text-white' : 'border-[#DDD9D0] bg-white text-[#5A5245]',
            active: th.filterActive,
            subtle: cinematic ? 'text-[#b3b3b3]' : th.bookMeta,
            text: cinematic ? 'text-white' : th.title,
          }}
          title={t('library.manageCategories')}
          help={t('library.categoryHelp')}
          addLabel={t('library.addCategory')}
          errorMessage={t('library.categoryOperationFailed')}
          deleteConfirm={t('library.categoryDeleteConfirm')}
          mergeConfirm={t('library.categoryMergeConfirm')}
          onChange={next => {
            setBookCategories(next)
            fetch('/api/books').then(res => res.json()).then(data => {
              if (Array.isArray(data)) setBooks(data)
            }).catch(() => {})
            if (categoryFilter !== 'all' && !next.some(item => item.name === categoryFilter)) setCategoryFilter('all')
          }}
          onBooksChanged={async () => {
            const res = await fetch('/api/books')
            const data = await res.json()
            if (Array.isArray(data)) setBooks(data)
          }}
          onClose={() => setShowBookCategoryManager(false)}
        />
      )}

      <TrashBinModal
        isOpen={showTrashBinModal}
        onClose={() => setShowTrashBinModal(false)}
        onRestored={refreshBooksList}
      />

      <DeviceManagementModal
        isOpen={showDeviceModal}
        onClose={() => setShowDeviceModal(false)}
      />

      <MetadataEnrichReportModal
        isOpen={!!enrichReport}
        report={enrichReport}
        libraryTheme={libraryTheme}
        cinematic={cinematic}
        t={t}
        onClose={() => setEnrichReport(null)}
        onEditBook={book => setEditing(book)}
        allBooks={books}
      />

      {showBugReport && (
        <BugReportDialog
          libraryTheme={libraryTheme}
          onClose={() => setShowBugReport(false)}
          onSent={() => {
            setShowBugReport(false)
            toast(t('bug.sent'))
          }}
        />
      )}

      {showProfileSettings && currentUser && (
        <ProfileSettingsDialog
          libraryTheme={libraryTheme}
          th={th}
          user={currentUser}
          onClose={() => setShowProfileSettings(false)}
          onUpdated={() => {
            void refreshSession()
            setShowProfileSettings(false)
            toast(t('profile.updated'))
          }}
        />
      )}

      {showLicenses && (
        <LicensesDialog
          libraryTheme={libraryTheme}
          onClose={() => setShowLicenses(false)}
        />
      )}

      {pendingConfirm && (
        <ConfirmDialog
          libraryTheme={libraryTheme}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel || t('common.delete')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => { pendingConfirm.onConfirm(); setPendingConfirm(null) }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      <BookTransferModal
        isOpen={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        bookIds={transferBookIds}
        bookTitles={transferBookTitles}
        onSuccess={msg => {
          toast(msg, 'success')
          void refreshBooksList()
        }}
        onError={err => toast(err, 'error')}
      />

      <ToastContainer messages={messages} onRemove={remove} />
    </div>
  )
}

function LibraryShelf({ title, books, libraryTheme, th, t, patchBook, setEditing, deleteBook }: {
  title: string
  books: Book[]
  libraryTheme: LibraryTheme
  th: (typeof LIBRARY_THEME)[LibraryTheme]
  t: ReturnType<typeof useI18n>['t']
  patchBook: (id: number, body: BookPatch, silent?: boolean) => Promise<void>
  setEditing: (book: Book) => void
  deleteBook: (id: number) => void
}) {
  if (books.length === 0) return null

  return (
    <section className="library-card-reveal">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className={`text-xl font-black ${th.title}`}>{title}</h2>
        <span className={`text-xs ${th.bookMeta}`}>{t('library.shelfBooks', { count: books.length })}</span>
      </div>
      <div className="library-shelf-scroll flex snap-x gap-3 overflow-x-auto pb-4 sm:gap-4">
        {books.map(book => {
          const isEpub = isEpubBook(book)
          return (
            <article key={`${title}-${book.id}`} className={`group relative w-[142px] flex-none snap-start sm:w-[172px] lg:w-[190px]`}>
               <div className={`overflow-hidden rounded-2xl border transition duration-300 ease-out shadow-[0_2px_12px_-4px_var(--lib-shadow)] motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.03] ${th.bookCard}`} style={{ '--card-accent': th.progressColor } as React.CSSProperties}>
                <Link
                  href={`/reader/${book.id}`}
                  prefetch
                  onClick={() => patchBook(book.id, { last_opened_at: new Date().toISOString() }, true)}
                  className="block"
                >
                  <div className="library-shine relative overflow-hidden">
                    <BookThumbnail
                      filepath={isEpub ? '' : `/api/pdf/${encodeURIComponent(book.filename)}`}
                      title={cleanText(book.title)}
                      thumbnail={book.thumbnail}
                      placeholderImage={libraryTheme === 'seoul' ? '/themes/seoul/placeholder.png' : undefined}
                      light={libraryTheme === 'seoul'}
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                    <div className="absolute bottom-0 left-0 h-1.5 w-full liquid-glass-progress-bg">
                      <div className="liquid-glass-progress-fill" style={{ width: `${progress(book)}%`, '--progress-color': th.progressColor, '--progress-glow': th.progressGlow } as React.CSSProperties} />
                    </div>
                  </div>
                </Link>
                <div className="p-3">
                  <Link
                    href={`/reader/${book.id}`}
                    prefetch
                    onClick={() => patchBook(book.id, { last_opened_at: new Date().toISOString() }, true)}
                    className={`line-clamp-2 text-sm font-bold leading-snug ${th.bookTitle} hover:text-[var(--lib-accent-soft)]`}
                  >
                    {cleanText(book.title)}
                  </Link>
                  <p className={`mt-1 truncate text-xs ${th.bookAuthor}`}>{cleanText(book.author || book.category || '')}</p>
                  {!!book.categories?.length && (
                    <div className="mt-2 flex max-h-10 flex-wrap gap-1 overflow-hidden">
                      {book.categories.slice(0, 3).map(category => (
                        <span key={category.id} className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold" style={{ borderColor: `${category.color}66`, color: category.color }}>{category.name}</span>
                      ))}
                    </div>
                  )}
                  <div className={`mt-2 flex items-center justify-between text-[11px] ${th.bookMeta}`}>
                    <span>{progress(book)}%</span>
                    {isEpub && <span>EPUB</span>}
                  </div>
                  <BookReadingMeta book={book} th={th} t={t} />
                  <div className="mt-2 grid grid-cols-3 gap-1 lg:hidden">
                    <button onClick={() => patchBook(book.id, { favorite: book.favorite ? 0 : 1 })} aria-label="Favorilere ekle/kaldir" className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${book.favorite ? th.touchFavOn : th.touchFavOff}`}>
                      {book.favorite ? t('library.unstar') : t('library.star')}
                    </button>
                    <button onClick={() => setEditing(book)} aria-label="Kitabi düzenle" className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${th.touchEdit}`}>{t('common.edit')}</button>
                    <button onClick={() => deleteBook(book.id)} className={`rounded-lg px-2 py-2 text-[11px] font-semibold ${th.touchDel}`}>{t('common.delete')}</button>
                  </div>
                </div>
                <div className="absolute right-2 top-2 hidden gap-1 opacity-0 transition-all duration-300 group-hover:opacity-100 group-focus-within:opacity-100 lg:flex">
                  <button onClick={() => patchBook(book.id, { favorite: book.favorite ? 0 : 1 })} aria-label="Favorilere ekle/kaldir" className={`rounded-lg px-2 py-1 text-xs ${th.desktopActBg} ${th.favLabel}`}>
                    {book.favorite ? t('library.unstar') : t('library.star')}
                  </button>
                  <button onClick={() => setEditing(book)} aria-label="Kitabi düzenle" className={`rounded-lg px-2 py-1 text-xs ${th.desktopActBg} ${th.bookTitle}`}>{t('common.edit')}</button>
                  <button onClick={() => deleteBook(book.id)} aria-label="Kitabi sil" className="rounded-lg bg-red-600/90 px-2 py-1 text-xs text-white">{t('common.delete')}</button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function BookReadingMeta({ book, th, t }: {
  book: Book
  th: (typeof LIBRARY_THEME)[LibraryTheme]
  t: ReturnType<typeof useI18n>['t']
}) {
  const seconds = Number(book.total_reading_time || 0)
  if (seconds <= 0) return null

  return (
    <p className={`mt-1 truncate text-[11px] font-semibold ${th.bookMeta}`}>
      {t('library.totalReadTime')}: {formatReadingTime(seconds, t)}
    </p>
  )
}

function MetadataAutocomplete({ title, libraryTheme, onSelect }: {
  title: string
  libraryTheme: LibraryTheme
  onSelect: (suggestion: BookSuggestion) => void
}) {
  const [suggestions, setSuggestions] = useState<BookSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [touched, setTouched] = useState(false)
  const { t } = useI18n()
  const th = LIBRARY_THEME[libraryTheme]

  useEffect(() => {
    const query = cleanText(title).trim()
    if (query.length < 3) {
      const resetTimer = window.setTimeout(() => {
        setSuggestions([])
        setLoading(false)
        setTouched(false)
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setTouched(true)
      try {
        // Open Library: free, no API key, works globally
        const res = await fetch(
          `https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=8&fields=key,title,author_name,subject,subject_facet,place_facet,time_facet`,
          { signal: controller.signal }
        )
        type OLDoc = { key: string; title?: string; author_name?: string[]; subject?: string[]; subject_facet?: string[]; place_facet?: string[]; time_facet?: string[] }
        const data = await res.json() as { docs?: OLDoc[] }

        // Filter out Open Library's administrative/technical subject tags
        const SKIP_SUBJECT = /accessible|protected|daisy|open library|in library|staff pick|overdrive|noad|internet archive|large.?print|e-?book|^digital$|^fiction in|^noad$|^public domain/i
        function cleanSubjects(subjects: string[] = []) {
          return subjects.filter(s => s.length >= 2 && s.length <= 50 && !SKIP_SUBJECT.test(s))
        }

        const next = (data.docs || [])
          .map((item, i) => {
            // Merge subject_facet (normalized) + subject (raw), deduplicated
            const facets = cleanSubjects(item.subject_facet)
            const raw = cleanSubjects(item.subject)
            const seen = new Set(facets.map(s => s.toLowerCase()))
            const merged = [...facets, ...raw.filter(s => !seen.has(s.toLowerCase()))]
            return {
              id: item.key || String(i),
              title: cleanText(item.title || ''),
              author: cleanText((item.author_name || []).slice(0, 2).join(', ')),
              category: cleanText(merged[0] || ''),
              tags: merged.slice(1, 6).map(cleanText),
            }
          })
          .filter(item => item.title)
          .slice(0, 6)
        setSuggestions(next)
      } catch {
        if (!controller.signal.aborted) setSuggestions([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 500)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [title])

  if (!loading && suggestions.length === 0 && !touched) return null

  return (
    <div className={`overflow-hidden rounded-lg border text-xs shadow-xl ${th.card}`}>
      {loading && <p className={`px-3 py-2 ${th.bookMeta}`}>{t('library.metadataLoading')}</p>}
      {!loading && suggestions.length === 0 && touched && <p className={`px-3 py-2 ${th.bookMeta}`}>{t('library.metadataEmpty')}</p>}
      {!loading && suggestions.map(suggestion => (
        <button
          key={suggestion.id}
          type="button"
          onClick={() => {
            onSelect(suggestion)
            setTouched(false)
            setSuggestions([])
          }}
          onFocus={() => setTouched(true)}
          className={`block w-full border-t px-3 py-2 text-left transition first:border-t-0 ${th.separator} hover:bg-[var(--lib-surface-subtle)]`}
        >
          <span className={`block font-medium ${th.bookTitle}`}>{suggestion.title}</span>
          <span className={`block truncate ${th.bookAuthor}`}>{[suggestion.author, suggestion.category].filter(Boolean).join(' - ')}</span>
        </button>
      ))}
    </div>
  )
}

function BookCategoryMultiSelect({
  categories,
  selected,
  onChange,
  label,
  buttonClass,
}: {
  categories: Array<AnnotationCategory & { bookCount?: number }>
  selected: number[]
  onChange: (ids: number[]) => void
  label: string
  buttonClass: string
}) {
  return (
    <fieldset className="rounded-xl border border-white/10 p-3">
      <legend className="px-1 text-xs font-semibold opacity-70">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {categories.map(category => {
          const active = selected.includes(category.id)
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? selected.filter(id => id !== category.id) : [...selected, category.id])}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${active ? 'border-current bg-white/10' : buttonClass}`}
              style={active ? { color: category.color, borderColor: `${category.color}88`, backgroundColor: `${category.color}18` } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} />
              {category.name}
              {active && <span aria-hidden="true">✓</span>}
            </button>
          )
        })}
        {!categories.length && <span className="text-xs opacity-60">—</span>}
      </div>
    </fieldset>
  )
}

function BookEditor({ libraryTheme, book, categories, onClose, onSave }: {
  libraryTheme: LibraryTheme
  book: Book
  categories: Array<AnnotationCategory & { bookCount?: number }>
  onClose: () => void
  onSave: (data: BookPatch) => void
}) {
  const { t, statusLabel } = useI18n()
  const cinematic = libraryTheme !== 'seoul'
  const th = LIBRARY_THEME[libraryTheme]
  const [title, setTitle] = useState(cleanText(book.title))
  const [author, setAuthor] = useState(cleanText(book.author || ''))
  const [categoryIds, setCategoryIds] = useState<number[]>(book.category_ids || book.categories?.map(item => item.id) || [])
  const [tags, setTags] = useState(parseTags(book.tags).join(', '))
  const [status, setStatus] = useState<Book['status']>(book.status || 'reading')
  const [thumbnail, setThumbnail] = useState(book.thumbnail || '')
  const [thumbnailError, setThumbnailError] = useState('')
  const thumbnailRef = useRef<HTMLInputElement>(null)

  async function handleThumbnailChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await readImageAsDataUrl(file, t)
      setThumbnail(dataUrl)
      setThumbnailError('')
    } catch (error) {
      setThumbnailError(error instanceof Error ? error.message : t('upload.thumbnailInvalid'))
    }
  }

  return (
    <SmoothOverlay open onClose={onClose} panelClassName={`max-w-md rounded-xl border p-5 shadow-[0_24px_90px_rgba(0,0,0,0.65)] ${cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'}`}>
        <h2 className={`mb-4 text-lg font-bold ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>{t('edit.title')}</h2>
        <div className="flex flex-col gap-3">
          <input value={title} onChange={e => setTitle(e.target.value)} className={`rounded-lg border px-3 py-2.5 text-sm outline-none ${th.input}`} />
          <MetadataAutocomplete title={title} libraryTheme={libraryTheme} onSelect={suggestion => {
            setTitle(suggestion.title)
            setAuthor(suggestion.author)
            const matchedCategory = categories.find(item => item.name.toLocaleLowerCase() === suggestion.category.toLocaleLowerCase())
            if (matchedCategory) setCategoryIds(current => [...new Set([...current, matchedCategory.id])])
            setTags(suggestion.tags?.join(', ') || '')
          }} />
          <input value={author} onChange={e => setAuthor(e.target.value)} placeholder={t('upload.author')} className={`rounded-lg border px-3 py-2.5 text-sm outline-none ${th.input}`} />
          <BookCategoryMultiSelect categories={categories} selected={categoryIds} onChange={setCategoryIds} label={t('library.manageCategories')} buttonClass={th.catPill} />
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder={t('upload.tags')} className={`rounded-lg border px-3 py-2.5 text-sm outline-none ${th.input}`} />
          <div className={`rounded-lg border p-3 ${th.card}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-sm font-medium ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>{t('upload.thumbnail')}</p>
                <p className={`mt-1 text-xs ${cinematic ? 'text-slate-500' : 'text-[#7A7060]'}`}>{t('upload.thumbnailHint')}</p>
              </div>
              {thumbnail && (
                <button
                  type="button"
                  onClick={() => {
                    setThumbnail('')
                    setThumbnailError('')
                    if (thumbnailRef.current) thumbnailRef.current.value = ''
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs transition ${th.catPill}`}
                >
                  {t('upload.thumbnailRemove')}
                </button>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              ref={thumbnailRef}
              onChange={handleThumbnailChange}
              className={`mt-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-2 ${cinematic ? 'text-slate-300 file:bg-white/10 file:hover:bg-white/15 file:text-white' : 'text-[#7A7060] file:bg-[#EDE9E1] file:text-[#2C2A26] file:hover:bg-[#E4E0D7]'}`}
            />
            {thumbnail && (
              <div className={`mt-3 overflow-hidden rounded-xl border p-2 ${th.card}`}>
                <BookThumbnail filepath="" title={cleanText(title) || 'DOC'} thumbnail={thumbnail} light={!cinematic} />
              </div>
            )}
            {thumbnailError && (
              <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${
                cinematic
                  ? 'bg-red-950/50 text-red-300'
                  : 'bg-red-50 text-red-600 border border-red-200'
              }`}>
                {thumbnailError}
              </p>
            )}
          </div>
          <select value={status} onChange={e => setStatus(e.target.value as Book['status'])} className={`rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--lib-accent)]/70 ${th.select}`}>
            <option value="planned">{statusLabel('planned')}</option>
            <option value="reading">{statusLabel('reading')}</option>
            <option value="finished">{statusLabel('finished')}</option>
          </select>
          <div className="mt-1 flex gap-3">
            <button onClick={onClose} className={`flex-1 rounded-lg py-2.5 text-sm transition ${cinematic ? 'bg-white/10 text-white hover:bg-white/15' : 'border border-[#DDD9D0] bg-white text-[#5A5245] hover:bg-[#EDE9E1]'}`}>{t('common.cancel')}</button>
            <button onClick={() => onSave({ title: cleanText(title), author: cleanText(author), categoryIds, tags: parseTags(tags), status, thumbnail })} className={`flex-1 rounded-lg py-2.5 text-sm font-bold text-white transition ${libraryTheme === 'dark' ? 'bg-[#e50914] hover:bg-[#f6121d]' : libraryTheme === 'seoul' ? 'bg-[#4A9B8E] hover:bg-[#3D8A7E]' : th.addBtn}`}>{t('common.save')}</button>
          </div>
        </div>
    </SmoothOverlay>
  )
}

function ConfirmDialog({ libraryTheme, message, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  libraryTheme: LibraryTheme
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cinematic = libraryTheme !== 'seoul'
  return (
    <SmoothOverlay open onClose={onCancel} zIndex={60} className="items-center p-4" panelClassName={`max-w-sm rounded-lg border p-5 shadow-2xl ${cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'}`}>
        <p className={`mb-5 text-sm leading-relaxed ${cinematic ? 'text-slate-200' : 'text-[#2C2A26]'}`}>{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className={`flex-1 rounded-lg py-2.5 text-sm transition ${cinematic ? 'bg-white/10 text-white hover:bg-white/15' : 'border border-[#DDD9D0] bg-white text-[#5A5245] hover:bg-[#EDE9E1]'}`}>{cancelLabel}</button>
          <button onClick={onConfirm} className={`flex-1 rounded-lg py-2.5 text-sm font-bold text-white transition ${cinematic ? 'bg-red-600 hover:bg-red-700' : 'bg-red-500 hover:bg-red-600'}`}>{confirmLabel}</button>
        </div>
    </SmoothOverlay>
  )
}

function ProfileSettingsDialog({ libraryTheme, th, user, onClose, onUpdated }: {
  libraryTheme: LibraryTheme
  th: (typeof LIBRARY_THEME)[LibraryTheme]
  user: CurrentUser
  onClose: () => void
  onUpdated: (user: CurrentUser) => void
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [avatar, setAvatar] = useState(user.avatar || '')
  const [username, setUsername] = useState(user.username)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const cinematic = libraryTheme !== 'seoul'

  const [exporting, setExporting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function save() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar, username: username.trim(), currentPassword, newPassword }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || t('profile.failed'))
      }
      onUpdated({ username: data.username, role: data.role || user.role, is_test: Boolean(data.is_test), avatar: data.avatar || '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.failed'))
    } finally {
      setSaving(false)
    }
  }

  async function exportData() {
    setExporting(true)
    setError('')
    try {
      const response = await fetch('/api/backup')
      if (!response.ok) throw new Error()
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      link.download = `kisisel-kutuphane-export-${stamp}.zip`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(t('profile.failed'))
    } finally {
      setExporting(false)
    }
  }

  async function deleteAccount() {
    setDeleting(true)
    setError('')
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || t('profile.failed'))
      }
      toast(t('profile.deleteAccountSuccess'))
      window.location.href = '/login?deleted=true'
    } catch (err) {
      setError(err instanceof Error ? err.message : t('profile.failed'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SmoothOverlay open onClose={onClose} zIndex={70} panelClassName={`max-w-md rounded-xl border p-5 shadow-[0_24px_90px_rgba(0,0,0,0.65)] ${cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'}`}>
        <h2 className={`text-lg font-black ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>{t('profile.settings')}</h2>
        
        <div className="mt-4 flex flex-col gap-1.5">
          <label className={`block text-xs font-bold uppercase tracking-wide ${cinematic ? 'text-[#b3b3b3]' : 'text-[#7A7060]'}`}>{t('login.username')}</label>
          <input
            type="text"
            value={username}
            onChange={event => setUsername(event.target.value)}
            placeholder="Kullanıcı Adı"
            className={`w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--lib-accent)]/70 ${
              cinematic
                ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500'
                : 'border-[#DDD9D0] bg-white text-[#1C1A17] placeholder:text-[#9A9080]'
            }`}
          />
        </div>

        <label className={`mt-4 block text-xs font-bold uppercase tracking-wide ${cinematic ? 'text-[#b3b3b3]' : 'text-[#7A7060]'}`}>{t('profile.avatar')}</label>
        <div className="mt-2 flex items-center gap-3">
          <div className={`flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xl font-black ${cinematic ? 'border-white/15 bg-white/[0.06]' : 'border-[#DDD9D0] bg-[#FAF8F3]'}`}>
            {avatar ? <img loading="lazy" decoding="async" src={getAssetUrl(avatar)} alt="" className="h-full w-full object-cover" /> : username.slice(0, 1).toUpperCase()}
          </div>
          <input type="file" accept="image/*" className={`min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:px-3 file:py-2 ${cinematic ? 'text-[#b3b3b3] file:bg-white/10 file:text-white' : 'text-[#7A7060] file:bg-[#EDE9E1] file:text-[#2C2A26]'}`} onChange={async event => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              setAvatar(await readImageAsDataUrl(file, t))
            } catch {
              setError(t('profile.failed'))
            }
          }} />
        </div>
        
        <div className={`mt-5 border-t pt-4 ${cinematic ? 'border-white/10' : 'border-[#DDD9D0]'}`}>
          <p className={`text-xs font-bold uppercase tracking-wide ${cinematic ? 'text-[#b3b3b3]' : 'text-[#7A7060]'}`}>{t('profile.password')}</p>
          <input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} placeholder={t('profile.currentPassword')} className={`mt-3 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--lib-accent)]/70 ${cinematic ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500' : 'border-[#DDD9D0] bg-white text-[#1C1A17] placeholder:text-[#9A9080]'}`} />
          <input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder={t('profile.newPassword')} className={`mt-2 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--lib-accent)]/70 ${cinematic ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500' : 'border-[#DDD9D0] bg-white text-[#1C1A17] placeholder:text-[#9A9080]'}`} />
        </div>

        <div className={`mt-5 border-t pt-4 ${cinematic ? 'border-white/10' : 'border-[#DDD9D0]'}`}>
          <p className={`text-xs font-bold uppercase tracking-wide ${cinematic ? 'text-[#b3b3b3]' : 'text-[#7A7060]'}`}>{t('profile.exportData')}</p>
          <button
            onClick={exportData}
            disabled={exporting}
            className={`mt-2 w-full rounded-lg border py-2 text-xs font-bold transition ${
              cinematic
                ? 'border-white/10 bg-white/5 hover:bg-white/10 text-white'
                : 'border-[#DDD9D0] bg-[#FAF8F3] hover:bg-[#EDE9E1] text-[#2C2A26]'
            }`}
          >
            {exporting ? t('common.loading') : t('profile.exportData')}
          </button>
        </div>

        <div className={`mt-5 border-t pt-4 ${cinematic ? 'border-white/10' : 'border-[#DDD9D0]'}`}>
          <p className="text-xs font-bold uppercase tracking-wide text-red-500">{t('profile.deleteAccount')}</p>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="mt-2 w-full rounded-lg border border-red-500/30 bg-red-500/5 py-2 text-xs font-bold text-red-400 transition hover:bg-red-500/10"
            >
              {t('profile.deleteAccount')}
            </button>
          ) : (
            <div className="mt-3 space-y-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-xs font-bold text-red-200">{t('profile.deleteAccountConfirmTitle')}</p>
              <p className="text-[11px] leading-relaxed text-[#d6d3d1]/80">{t('profile.deleteAccountConfirmBody')}</p>
              <input
                type="password"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                placeholder={t('profile.currentPassword')}
                className={`w-full rounded-lg border px-3 py-2 text-xs outline-none focus:border-red-500/70 ${
                  cinematic
                    ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500'
                    : 'border-[#DDD9D0] bg-white text-[#1C1A17] placeholder:text-[#9A9080]'
                }`}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeletePassword('')
                  }}
                  className={`flex-1 rounded-lg border py-2 text-xs transition ${
                    cinematic
                      ? 'border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.12]'
                      : 'border-[#DDD9D0] bg-white text-[#5A5245] hover:bg-[#EDE9E1]'
                  }`}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={deleteAccount}
                  disabled={deleting || !deletePassword}
                  className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? t('common.loading') : t('profile.deleteAccountConfirmBtn')}
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className={`mt-3 text-xs font-semibold ${cinematic ? 'text-red-300' : 'text-red-600'}`}>
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className={`flex-1 rounded-lg border py-2.5 text-sm transition ${cinematic ? 'border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.12]' : 'border-[#DDD9D0] bg-white text-[#5A5245] hover:bg-[#EDE9E1]'}`}>{t('common.cancel')}</button>
          <button onClick={save} disabled={saving} className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition disabled:opacity-50 ${th.addBtn}`}>{saving ? t('common.loading') : t('common.save')}</button>
        </div>
    </SmoothOverlay>
  )
}

function BookSourceSearch({ libraryTheme, th, cinematic, t, toast, onClose, onImported }: {
  libraryTheme: LibraryTheme
  th: (typeof LIBRARY_THEME)[LibraryTheme]
  cinematic: boolean
  t: ReturnType<typeof useI18n>['t']
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
  onClose: () => void
  onImported: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BookSourceResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function doSearch() {
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    setError('')
    setSearched(true)
    try {
      const res = await fetch(`/api/books/search-source?q=${encodeURIComponent(q)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Search failed')
      }
      const data = await res.json()
      setResults(data.results || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sourceSearch.error'))
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  async function importBook(result: BookSourceResult) {
    const downloadUrl = result.downloadUrl
    if (!downloadUrl) return
    const key = `${result.source}-${result.sourceId}`
    const jobId = workflowJobId('import', key)
    const payload = {
      downloadUrl,
      title: result.title,
      author: result.author,
      source: result.source,
      sourceId: result.sourceId,
    }
    setImporting(key)
    upsertWorkflowJob({ id: jobId, kind: 'import', title: result.title, status: 'running', progress: 10, attempts: 1, message: 'Kaynak indiriliyor', payload })
    try {
      const res = await fetchWithTimeout('/api/books/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 180_000)
      if (res.status === 409) {
        const data = await res.json()
        upsertWorkflowJob({ id: jobId, kind: 'import', title: result.title, status: 'failed', progress: 10, message: data.error || t('sourceSearch.importFailed'), payload })
        toast(data.error || t('sourceSearch.importFailed'), 'error')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || t('sourceSearch.importFailed'))
      }
      upsertWorkflowJob({ id: jobId, kind: 'import', title: result.title, status: 'completed', progress: 100, message: 'Kütüphaneye eklendi.', payload })
      toast(t('sourceSearch.imported'), 'success')
      setTimeout(onImported, 1000)
    } catch (err) {
      upsertWorkflowJob({ id: jobId, kind: 'import', title: result.title, status: 'failed', message: err instanceof Error ? err.message : t('sourceSearch.importFailed'), payload })
      toast(err instanceof Error ? err.message : t('sourceSearch.importFailed'), 'error')
    } finally {
      setImporting(null)
    }
  }

  const sourceLabel: Record<string, string> = {
    gutenberg: t('sourceSearch.gutenberg'),
    openlibrary: t('sourceSearch.openlibrary'),
    googlebooks: t('sourceSearch.googlebooks'),
  }

  const sourceColor: Record<string, string> = {
    gutenberg: cinematic ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-800',
    openlibrary: cinematic ? 'bg-sky-500/15 text-sky-300' : 'bg-sky-100 text-sky-800',
    googlebooks: cinematic ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-100 text-blue-800',
  }

  return (
    <SmoothOverlay open onClose={onClose} panelClassName={`max-w-2xl rounded-xl border p-4 shadow-2xl sm:p-5 ${cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className={`text-base font-bold sm:text-lg ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>
            <Globe size={18} className="inline-block align-text-top mr-2" />
            {t('sourceSearch.title')}
          </h2>
          <button onClick={onClose} className={`rounded-lg px-2.5 py-1.5 text-xs transition ${cinematic ? 'bg-white/10 text-slate-300 hover:bg-white/15' : 'bg-[#EDE9E1] text-[#5A5245] hover:bg-[#E4E0D7]'}`}>{t('common.close')}</button>
        </div>

        <p className={`mb-4 text-xs leading-relaxed ${cinematic ? 'text-slate-400' : 'text-[#7A7060]'}`}>{t('sourceSearch.searchHint')}</p>

        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doSearch() }}
            placeholder={t('sourceSearch.placeholder')}
            className={`flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none ${cinematic ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500' : 'border-[#DDD9D0] bg-white text-[#1C1A17] placeholder:text-[#9A9080]'}`}
          />
          <button
            onClick={doSearch}
            disabled={searching || query.trim().length < 2}
            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition disabled:opacity-50 ${cinematic ? 'bg-[#e50914] text-white hover:bg-[#f6121d]' : 'bg-[#4A9B8E] text-white hover:bg-[#3D8A7E]'}`}
          >
            {searching ? t('sourceSearch.searching') : t('sourceSearch.search')}
          </button>
        </div>

        {error && (
          <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${cinematic ? 'bg-red-950/50 text-red-300' : 'bg-red-50 text-red-600'}`}>{error}</p>
        )}

        {searched && !searching && results.length === 0 && !error && (
          <div className="py-12 text-center">
            <p className={`text-sm ${cinematic ? 'text-slate-400' : 'text-[#7A7060]'}`}>{t('sourceSearch.noResults')}</p>
          </div>
        )}

        {searching && (
          <div className="py-12 text-center">
            <p className={`text-sm ${cinematic ? 'text-slate-400' : 'text-[#7A7060]'}`}>{t('sourceSearch.searching')}</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {results.map((result, i) => {
              const key = `${result.source}-${result.sourceId}-${i}`
              const importingKey = `${result.source}-${result.sourceId}`
              const isImporting = importing === importingKey
              const hasDownload = !!result.downloadUrl
              return (
                <div key={key} className={`rounded-xl border p-3 transition ${cinematic ? 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]' : 'border-[#DDD9D0] bg-[#FAF8F3] hover:bg-white'}`}>
                  <div className="flex gap-3">
                    {result.coverUrl && (
                      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10">
                        <img src={result.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`line-clamp-2 text-sm font-bold leading-snug ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>{result.title}</p>
                      {result.author && (
                        <p className={`mt-0.5 truncate text-xs ${cinematic ? 'text-slate-400' : 'text-[#7A7060]'}`}>{result.author}</p>
                      )}
                      <span className={`mt-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sourceColor[result.source] || ''}`}>
                        {sourceLabel[result.source] || result.source}
                      </span>
                      {result.description && (
                        <p className={`mt-1 line-clamp-2 text-[11px] leading-relaxed ${cinematic ? 'text-slate-500' : 'text-[#9A9080]'}`}>{result.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {hasDownload && (
                      <button
                        onClick={() => importBook(result)}
                        disabled={isImporting}
                        className={`flex-1 rounded-lg py-2 text-xs font-bold transition disabled:opacity-50 ${cinematic ? 'bg-[#e50914] text-white hover:bg-[#f6121d]' : 'bg-[#4A9B8E] text-white hover:bg-[#3D8A7E]'}`}
                      >
                        {isImporting ? t('sourceSearch.importing') : t('sourceSearch.import')}
                      </button>
                    )}
                    {result.sourceUrl && (
                      <a
                        href={result.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${cinematic ? 'bg-white/10 text-slate-300 hover:bg-white/15' : 'bg-[#EDE9E1] text-[#5A5245] hover:bg-[#E4E0D7]'}`}
                      >
                        <ExternalLink size={12} />
                        {t('sourceSearch.openSource')}
                      </a>
                    )}
                    {!hasDownload && (
                      <span className={`inline-flex items-center px-2 py-2 text-[10px] font-semibold ${cinematic ? 'text-slate-500' : 'text-[#8A8173]'}`}>
                        {t('sourceSearch.catalogOnly')}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
    </SmoothOverlay>
  )
}
