'use client'

import { useEffect, useMemo, useState } from 'react'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { getLibraryThemeStyle, LIBRARY_THEME } from '@/lib/libraryTheme'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import CitedAnswer from '@/components/CitedAnswer'
import type { Citation } from '@/lib/citedMultiDocumentAi'

interface Book { id: number; title: string; author?: string; is_encrypted?: number }
export default function ResearchPage() {
  const theme = useLibraryTheme()
  const [books, setBooks] = useState<Book[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [citations, setCitations] = useState<Citation[]>([])
  const [sourceNotFound, setSourceNotFound] = useState(false)
  const [citationFallback, setCitationFallback] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  useEffect(() => {
    fetch('/api/books').then(res => res.ok ? res.json() : []).then(data => setBooks(Array.isArray(data) ? data : [])).catch(() => setError('Kitaplar yüklenemedi.'))
  }, [])

  const th = LIBRARY_THEME[theme]
  const selectedBooks = useMemo(() => books.filter(book => selected.includes(book.id)), [books, selected])
  const toggleBook = (id: number) => setSelected(current => current.includes(id) ? current.filter(bookId => bookId !== id) : current.length >= 10 ? current : [...current, id])

  async function ask() {
    setError(''); setAnswer(''); setCitations([]); setSourceNotFound(false); setCitationFallback(false); setSavedMessage('')
    if (selected.length < 2) { setError('En az iki kitap seçin.'); return }
    if (!question.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/ask-ai/multi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookIds: selected, question }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'AI isteği başarısız oldu.'); return }
      setAnswer(data.answer || data.text || '')
      setCitations(Array.isArray(data.citations) ? data.citations : [])
      setSourceNotFound(Boolean(data.sourceNotFound))
      setCitationFallback(Boolean(data.citationFallback))
    } catch { setError('AI servisine ulaşılamadı.') } finally { setLoading(false) }
  }

  async function saveAsNote() {
    const source = citations[0]
    if (!answer.trim() || !source) return
    setSavingNote(true)
    setSavedMessage('')
    try {
      const sourceList = citations.filter(citation => citation.bookId === source.bookId).map(citation => ({ page: citation.page, text: citation.excerpt.slice(0, 300) }))
      const response = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_id: source.bookId,
          type: 'note',
          page: source.page,
          content: {
            schemaVersion: 2,
            note: answer.slice(0, 6000),
            source: 'Kaynaklı çoklu belge AI',
            sources: sourceList,
          },
        }),
      })
      if (!response.ok) throw new Error('save failed')
      setSavedMessage('Kitap notu kaydedildi.')
    } catch {
      setSavedMessage('Not kaydedilemedi.')
    } finally {
      setSavingNote(false)
    }
  }

  function saveAsDraft() {
    if (!answer.trim()) return
    try {
      const key = 'research-notebook-drafts:v1'
      const existing = JSON.parse(localStorage.getItem(key) || '[]') as unknown[]
      const draft = { id: crypto.randomUUID(), question, answer, citations, selectedBookIds: selected, createdAt: new Date().toISOString() }
      localStorage.setItem(key, JSON.stringify([draft, ...existing].slice(0, 50)))
      setSavedMessage('Araştırma taslağı kaydedildi.')
    } catch {
      setSavedMessage('Taslak kaydedilemedi.')
    }
  }

  return (
    <LibraryPageShell title="Kaynaklı çoklu belge AI" subtitle="Sadece sahip olduğunuz, şifresiz kitaplardan bounded kaynaklı yanıtlar" backHref="/" libraryTheme={theme} active="research">
      <div style={getLibraryThemeStyle(theme) as React.CSSProperties} className="space-y-4">
        <section className={`rounded-2xl border p-4 ${th.card}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className={`font-black ${th.title}`}>Araştırma seti</h2><p className={`text-xs ${th.subtitle}`}>2–10 kitap seçin · {selected.length}/10</p></div>
            <span className={`text-xs ${th.subtitle}`}>Şifreli kitaplar buluta gönderilmez</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {books.map(book => <label key={book.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${selected.includes(book.id) ? 'border-[var(--lib-accent)] bg-[var(--lib-accent-surface)]' : th.filterInactive}`}>
              <input type="checkbox" checked={selected.includes(book.id)} onChange={() => toggleBook(book.id)} disabled={Boolean(book.is_encrypted) || (!selected.includes(book.id) && selected.length >= 10)} className="accent-[var(--lib-accent)]" />
              <span className="min-w-0"><span className={`block truncate font-semibold ${th.cardText}`}>{book.title}</span><span className={`block truncate text-xs ${th.cardSub}`}>{book.author || 'Bilinmeyen yazar'}{book.is_encrypted ? ' · Şifreli' : ''}</span></span>
            </label>)}
          </div>
        </section>
        <section className={`rounded-2xl border p-4 ${th.card}`}>
          <p className={`mb-2 text-sm font-bold ${th.title}`}>{selectedBooks.length ? `${selectedBooks.length} kaynak seçildi` : 'Kaynak seçin'}</p>
          <textarea value={question} onChange={event => setQuestion(event.target.value.slice(0, 2000))} placeholder="Örneğin: Bu iki kitapta özgürlük kavramı nasıl farklı ele alınıyor?" className={`min-h-28 w-full rounded-xl border p-3 text-sm outline-none ${th.input}`} />
          <button type="button" onClick={ask} disabled={loading || selected.length < 2 || !question.trim()} className="mt-3 rounded-xl bg-[var(--lib-accent)] px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">{loading ? 'Yanıt hazırlanıyor…' : 'Kaynaklı yanıt al'}</button>
          {error && <p role="alert" className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        </section>
        {answer && <section className={`rounded-2xl border p-4 ${th.card}`}><h2 className={`mb-3 font-black ${th.title}`}>Yanıt</h2><div className={th.cardText}><CitedAnswer answer={answer} citations={citations} sourceNotFound={sourceNotFound} citationFallback={citationFallback} savingNote={savingNote} savedMessage={savedMessage} onSaveNote={saveAsNote} onSaveDraft={saveAsDraft} /></div></section>}
      </div>
    </LibraryPageShell>
  )
}
