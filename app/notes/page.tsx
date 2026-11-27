'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckSquare, ExternalLink, FileText, Search, StickyNote, Trash2 } from 'lucide-react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { buildAnnotationDeepLink, normalizeAnnotationTags } from '@/lib/annotations'
import { LIBRARY_THEME } from '@/lib/libraryTheme'

type NoteRow = {
  id: number
  book_id: number
  page: number
  type: 'note' | 'highlight' | 'drawing'
  created_at: string
  updated_at?: string
  book_title?: string
  content: {
    note?: string
    text?: string
    tags?: string[]
    pageNote?: boolean
    sources?: Array<{ page: number; text?: string }>
  }
}

function noteText(note: NoteRow) {
  return note.content.note || note.content.text || note.content.sources?.map(source => source.text || '').join(' ') || 'İçerik yok'
}

export default function NotesPage() {
  const libraryTheme = useLibraryTheme()
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'note' | 'highlight'>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const th = LIBRARY_THEME[libraryTheme]

  const loadNotes = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/annotations?all=1&limit=500')
      if (!response.ok) throw new Error('Notlar yüklenemedi.')
      const data = await response.json()
      setNotes(Array.isArray(data) ? data as NoteRow[] : [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Notlar yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => { void loadNotes() }, 0)
    return () => window.clearTimeout(id)
  }, [loadNotes])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr')
    return notes.filter(note => {
      if (kind !== 'all' && note.type !== kind) return false
      if (!normalized) return true
      return `${note.book_title || ''} ${noteText(note)} ${normalizeAnnotationTags(note.content.tags).join(' ')}`.toLocaleLowerCase('tr').includes(normalized)
    })
  }, [kind, notes, query])

  function toggle(id: number) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    await Promise.all([...selected].map(id => fetch(`/api/annotations?id=${id}`, { method: 'DELETE' })))
    setNotes(current => current.filter(note => !selected.has(note.id)))
    setSelected(new Set())
  }

  return (
    <LibraryPageShell title="Notlarım" subtitle="Kitaplarındaki not, vurgu ve kaynakları tek yerde yönet" libraryTheme={libraryTheme} active="notes">
      <div className="mb-4 flex items-center justify-end gap-2"><SyncStatusBadge compact={false} /><LanguageSwitcher compact /></div>
      <div className={`rounded-2xl border p-4 shadow-[0_24px_80px_var(--lib-shadow)] sm:p-5 ${th.card}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--lib-text-muted)]" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Not, kitap veya etiket ara" className={`min-h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none ${th.input}`} /></label>
          <select value={kind} onChange={event => setKind(event.target.value as typeof kind)} className={`min-h-11 rounded-xl border px-3 text-sm ${th.select}`}><option value="all">Tüm türler</option><option value="note">Notlar</option><option value="highlight">Vurgular</option></select>
          <button type="button" onClick={() => void deleteSelected()} disabled={selected.size === 0} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold disabled:opacity-40 ${th.actionDel}`}><Trash2 size={14} /> Seçilenleri sil ({selected.size})</button>
        </div>

        {loading ? <p className="py-16 text-center text-sm text-[var(--lib-text-muted)]">Yükleniyor…</p> : error ? <div className="mt-5 rounded-xl border border-red-400/25 bg-red-400/10 p-4 text-sm text-red-200">{error}<button type="button" onClick={() => void loadNotes()} className="ml-3 underline">Tekrar dene</button></div> : filtered.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-[var(--lib-border)] p-12 text-center text-sm text-[var(--lib-text-muted)]"><StickyNote className="mx-auto mb-3 opacity-60" size={24} />Not bulunamadı.</div> : (
          <div className="mt-5 grid gap-3">
            {filtered.map(note => {
              const text = noteText(note)
              const link = buildAnnotationDeepLink(note.book_id, note.page, note.id)
              const tags = normalizeAnnotationTags(note.content.tags)
              return <article key={note.id} className={`rounded-xl border p-4 transition ${selected.has(note.id) ? 'border-[var(--lib-accent-border)] bg-[var(--lib-accent-surface)]' : `${th.card} hover:border-[var(--lib-border-strong)]`}`}>
                <div className="flex items-start gap-3">
                  <button type="button" onClick={() => toggle(note.id)} aria-label={selected.has(note.id) ? 'Seçimi kaldır' : 'Notu seç'} className={`mt-0.5 rounded-md border p-1.5 ${selected.has(note.id) ? 'border-[var(--lib-accent-border)] text-[var(--lib-accent-soft)]' : 'border-[var(--lib-border)] text-[var(--lib-text-muted)]'}`}>{selected.has(note.id) ? <CheckSquare size={15} /> : <FileText size={15} />}</button>
                  <div className="min-w-0 flex-1"><p className={`truncate text-sm font-bold ${th.cardText}`}>{note.book_title || `Kitap #${note.book_id}`}</p><p className={`mt-0.5 text-[11px] ${th.cardMuted}`}>Sayfa {note.page} · {note.type === 'highlight' ? 'Vurgu' : note.content.pageNote ? 'Sayfa notu' : 'Not'}</p><p className={`mt-3 whitespace-pre-wrap text-sm leading-relaxed ${th.cardSub}`}>{text}</p>{tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{tags.map(tag => <span key={tag} className={`rounded-full border px-2 py-0.5 text-[10px] ${th.cardBadge}`}>#{tag}</span>)}</div>}</div>
                  <Link href={link} className={`shrink-0 rounded-lg border p-2 ${th.navBtn}`} title="Kitapta aç" aria-label="Kitapta aç"><ExternalLink size={15} /></Link>
                </div>
              </article>
            })}
          </div>
        )}
      </div>
    </LibraryPageShell>
  )
}
