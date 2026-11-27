'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Columns2, ExternalLink, RotateCcw } from 'lucide-react'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { getLibraryThemeStyle, LIBRARY_THEME } from '@/lib/libraryTheme'
import { isComparablePdf, normalizeCompareSelection, type CompareBookOption } from '@/lib/compare'

const PDFReader = dynamic(() => import('@/components/PDFReader'), { ssr: false })

function ComparePane({
  book,
  label,
  libraryTheme,
  onPageChange,
}: {
  book: CompareBookOption
  label: 'A' | 'B'
  libraryTheme: ReturnType<typeof useLibraryTheme>
  onPageChange: (page: number) => void
}) {
  const [page, setPage] = useState(Math.max(1, Number(book.last_page) || 1))
  const lastPageRef = useRef(page)
  const th = LIBRARY_THEME[libraryTheme]

  const saveProgress = useCallback(async (nextPage: number) => {
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage === lastPageRef.current) return
    lastPageRef.current = nextPage
    setPage(nextPage)
    onPageChange(nextPage)
    await fetch(`/api/books/${book.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ last_page: nextPage }),
    }).catch(() => {})
  }, [book.id, onPageChange])

  if (!isComparablePdf(book)) {
    return <div className={`flex h-full items-center justify-center p-6 text-center text-sm ${th.cardText}`}>Şifreli kitaplar ve PDF dışı belgeler karşılaştırmaya gönderilmez.</div>
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="absolute left-2 top-2 z-20 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-xl border border-white/15 bg-black/60 px-2.5 py-1.5 text-xs text-white shadow-xl backdrop-blur-md">
        <span className="rounded-md bg-[var(--lib-accent)] px-1.5 py-0.5 font-black">{label}</span>
        <span className="truncate font-semibold">{book.title}</span>
        <Link href={`/reader/${book.id}?page=${page}`} className="shrink-0 rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white" title="Ayrı okuyucuda aç" aria-label="Ayrı okuyucuda aç">
          <ExternalLink size={14} />
        </Link>
      </div>
      <PDFReader
        bookId={book.id}
        fileUrl={`/api/pdf/${encodeURIComponent(book.filename || '')}`}
        rawFileUrl={`/api/pdf/${encodeURIComponent(book.filename || '')}`}
        initialPage={page}
        initialTotalPages={book.total_pages || 0}
        bookTitle={book.title}
        bookAuthor={book.author || ''}
        libraryTheme={libraryTheme}
        onBack={() => window.location.assign('/compare')}
        onPageChange={saveProgress}
        onForceRefresh={() => window.location.reload()}
      />
    </div>
  )
}

export default function CompareReader() {
  const libraryTheme = useLibraryTheme()
  const th = LIBRARY_THEME[libraryTheme]
  const [books, setBooks] = useState<CompareBookOption[]>([])
  const [activeTab, setActiveTab] = useState<'A' | 'B'>('A')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const swipeStart = useRef<number | null>(null)
  const [initialSelection] = useState<[number, number]>(() => {
    if (typeof window === 'undefined') return [0, 0]
    const params = new URLSearchParams(window.location.search)
    return normalizeCompareSelection(params.get('a'), params.get('b'))
  })
  const [firstId, setFirstId] = useState(initialSelection[0])
  const [secondId, setSecondId] = useState(initialSelection[1])

  useEffect(() => {
    fetch('/api/books')
      .then(response => response.ok ? response.json() : Promise.reject(new Error('books unavailable')))
      .then(data => {
        const nextBooks = Array.isArray(data) ? data as CompareBookOption[] : []
        const nextEligible = nextBooks.filter(isComparablePdf)
        const nextFirst = nextEligible.some(book => book.id === initialSelection[0]) ? initialSelection[0] : nextEligible[0]?.id || 0
        const nextSecond = nextEligible.some(book => book.id === initialSelection[1] && book.id !== nextFirst)
          ? initialSelection[1]
          : nextEligible.find(book => book.id !== nextFirst)?.id || 0
        setBooks(nextBooks)
        setFirstId(nextFirst)
        setSecondId(nextSecond)
      })
      .catch(() => setError('Kitaplar yüklenemedi.'))
      .finally(() => setLoading(false))
  }, [initialSelection])

  const eligibleBooks = useMemo(() => books.filter(isComparablePdf), [books])
  const firstBook = books.find(book => book.id === firstId)
  const secondBook = books.find(book => book.id === secondId)

  useEffect(() => {
    if (!firstId && !secondId) return
    const params = new URLSearchParams()
    if (firstId) params.set('a', String(firstId))
    if (secondId) params.set('b', String(secondId))
    window.history.replaceState(null, '', `/compare?${params.toString()}`)
  }, [firstId, secondId])

  const selectFirst = (value: string) => {
    const next = Number(value)
    setFirstId(next)
    if (next === secondId) setSecondId(eligibleBooks.find(book => book.id !== next)?.id || 0)
  }

  const selectSecond = (value: string) => {
    const next = Number(value)
    setSecondId(next)
    if (next === firstId) setFirstId(eligibleBooks.find(book => book.id !== next)?.id || 0)
  }

  const switchTabBySwipe = (event: React.TouchEvent) => {
    if (swipeStart.current === null) return
    const delta = event.changedTouches[0]?.clientX - swipeStart.current
    swipeStart.current = null
    if (Math.abs(delta) < 45) return
    setActiveTab(delta < 0 ? 'B' : 'A')
  }

  const pageChanged = (bookId: number, page: number) => {
    setBooks(current => current.map(book => book.id === bookId ? { ...book, last_page: page } : book))
  }

  return (
    <LibraryPageShell title="Yan yana karşılaştır" subtitle="İki şifresiz PDF'i bağımsız okuyucu panellerinde inceleyin" backHref="/" libraryTheme={libraryTheme} active="compare">
      <div style={getLibraryThemeStyle(libraryTheme) as React.CSSProperties} className="space-y-3">
        <section className={`rounded-2xl border p-3 sm:p-4 ${th.card}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Columns2 size={18} className={th.title} />
            <p className={`mr-auto text-sm font-black ${th.title}`}>Karşılaştırma çifti</p>
            <Link href="/research" className={`rounded-lg border px-3 py-2 text-xs font-bold ${th.filterInactive}`}>Kaynaklı AI&apos;a geç</Link>
            <button type="button" onClick={() => { setFirstId(0); setSecondId(0); setActiveTab('A') }} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${th.filterInactive}`}><RotateCcw size={13} /> Temizle</button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(['A', 'B'] as const).map(label => {
              const value = label === 'A' ? firstId : secondId
              const onChange = label === 'A' ? selectFirst : selectSecond
              return (
                <label key={label} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2.5 text-xs ${th.filterInactive}`}>
                  <span className="rounded-md bg-[var(--lib-accent)] px-1.5 py-0.5 font-black text-white">{label}</span>
                  <select value={value || ''} onChange={event => onChange(event.target.value)} className={`min-w-0 flex-1 bg-transparent outline-none ${th.select}`} aria-label={`${label} kitabı`}>
                    <option value="">Kitap seçin</option>
                    {books.map(book => <option key={book.id} value={book.id} disabled={!isComparablePdf(book) || book.id === (label === 'A' ? secondId : firstId)}>{book.title}{book.is_encrypted ? ' · Şifreli' : !isComparablePdf(book) ? ' · PDF değil' : ''}</option>)}
                  </select>
                </label>
              )
            })}
          </div>
          <p className={`mt-2 text-[11px] ${th.subtitle}`}>Masaüstünde paneller bağımsızdır. Telefonda A/B sekmesine dokunun veya yana kaydırın.</p>
        </section>

        {error && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        {loading && <p className={`rounded-xl border p-4 text-sm ${th.card}`}>Kitaplar yükleniyor…</p>}
        {!loading && eligibleBooks.length < 2 && <p className={`rounded-xl border p-4 text-sm ${th.card}`}>Karşılaştırma için en az iki şifresiz PDF gerekir.</p>}

        {!loading && firstBook && secondBook && (
          <section className="space-y-2">
            <div className="flex gap-2 md:hidden" role="tablist" aria-label="Karşılaştırma panelleri">
              {(['A', 'B'] as const).map(label => {
                const book = label === 'A' ? firstBook : secondBook
                return <button key={label} type="button" role="tab" aria-selected={activeTab === label} onClick={() => setActiveTab(label)} className={`min-h-11 flex-1 rounded-xl border px-3 text-left text-xs font-bold ${activeTab === label ? th.filterActive : th.filterInactive}`}><span className="mr-1 rounded bg-[var(--lib-accent)] px-1.5 py-0.5 text-white">{label}</span>{book.title}<span className={`ml-1 ${th.subtitle}`}>s. {book.last_page || 1}</span></button>
              })}
            </div>
            <div className="grid h-[calc(100vh-16rem)] min-h-[560px] gap-2 md:grid-cols-2" onTouchStart={event => { swipeStart.current = event.touches[0]?.clientX ?? null }} onTouchEnd={switchTabBySwipe}>
              <div className={`${activeTab === 'A' ? 'block' : 'hidden'} min-h-0 overflow-hidden rounded-2xl border md:block`}><ComparePane key={firstBook.id} book={firstBook} label="A" libraryTheme={libraryTheme} onPageChange={page => pageChanged(firstBook.id, page)} /></div>
              <div className={`${activeTab === 'B' ? 'block' : 'hidden'} min-h-0 overflow-hidden rounded-2xl border md:block`}><ComparePane key={secondBook.id} book={secondBook} label="B" libraryTheme={libraryTheme} onPageChange={page => pageChanged(secondBook.id, page)} /></div>
            </div>
          </section>
        )}
      </div>
    </LibraryPageShell>
  )
}
