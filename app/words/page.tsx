'use client'

import { useEffect, useRef, useState } from 'react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { useI18n } from '@/components/I18nProvider'
import { cleanText } from '@/lib/text'
import { LIBRARY_THEME } from '@/lib/libraryTheme'
import {
  deleteEncryptedWord,
  listEncryptedWords,
  updateEncryptedWord,
} from '@/lib/encryptedReaderStore'

interface Word {
  id: number
  word: string
  definition: string
  context: string
  source_page: number | null
  book_title: string | null
  source_book_id?: number | null
  local_encrypted?: boolean
  created_at: string
}

type TDKResult = {
  madde: string
  foundAs: string
  searchedAs: string
  definitions: { anlam: string; tur: string }[]
}

function csvCell(val: unknown) {
  return `"${String(val ?? '').replace(/"/g, '""')}"`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function WordLibrary() {
  const [words, setWords] = useState<Word[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [tdkLoading, setTdkLoading] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState({ word: '', definition: '', context: '' })
  const editRef = useRef<HTMLTextAreaElement>(null)
  const libraryTheme = useLibraryTheme()
  const th = LIBRARY_THEME[libraryTheme]
  const { locale } = useI18n()

  useEffect(() => {
    Promise.all([
      fetch('/api/words').then(r => r.json()).catch(() => []),
      listEncryptedWords().catch(() => []),
      fetch('/api/books').then(r => r.ok ? r.json() : []).catch(() => []),
    ])
      .then(([serverWords, localWords, ownedBooks]) => {
        const ownedBookTitles = new Map<number, string>(
          (Array.isArray(ownedBooks) ? ownedBooks : []).map(book => [Number(book.id), String(book.title || '')]),
        )
        const ownedLocalWords = localWords
          .filter(word => ownedBookTitles.has(word.source_book_id))
          .map(word => ({ ...word, book_title: ownedBookTitles.get(word.source_book_id) || null }))
        setWords([
          ...(Array.isArray(serverWords) ? serverWords : []),
          ...ownedLocalWords,
        ])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function fetchEnglishDefinition(word: Word) {
    if (word.local_encrypted) return
    setTdkLoading(prev => new Set(prev).add(word.id))
    try {
      const res = await fetch(`/api/dictionary?word=${encodeURIComponent(word.word)}`)
      if (!res.ok) return
      const data = await res.json()
      const definition = cleanText((data.meanings || [])
        .map((m: { partOfSpeech: string; definitions: { definition: string }[] }) => `[${m.partOfSpeech}] ${m.definitions?.[0]?.definition || ''}`)
        .filter(Boolean)
        .join('\n'))
      if (!definition) return

      await fetch('/api/words', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: word.id, definition }),
      })
      setWords(prev => prev.map(w => w.id === word.id ? { ...w, definition } : w))
    } catch {
      // silently ignore network errors
    } finally {
      setTdkLoading(prev => { const s = new Set(prev); s.delete(word.id); return s })
    }
  }

  useEffect(() => {
    if (editingId !== null) editRef.current?.focus()
  }, [editingId])

  // ── TDK lookup ────────────────────────────────────────────────────────────
  async function fetchTDK(word: Word) {
    if (word.local_encrypted) return
    setTdkLoading(prev => new Set(prev).add(word.id))
    try {
      const res = await fetch(`/api/tdk?q=${encodeURIComponent(word.word)}`)
      if (!res.ok) return // not found or server error — nothing to do
      const data = await res.json() as TDKResult[]
      if (!Array.isArray(data) || data.length === 0 || data[0].definitions.length === 0) return

      const entry = data[0]
      // Prefix with found base form if it differs from the searched word
      const header = entry.foundAs !== entry.searchedAs
        ? `[${entry.madde}]\n`
        : ''
      const definition = header + entry.definitions
        .map((d, i) => `${i + 1}. ${d.tur ? `(${d.tur}) ` : ''}${d.anlam}`)
        .join('\n')

      await fetch('/api/words', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: word.id, definition }),
      })
      setWords(prev => prev.map(w => w.id === word.id ? { ...w, definition } : w))
    } catch {
      // silently ignore network errors
    } finally {
      setTdkLoading(prev => { const s = new Set(prev); s.delete(word.id); return s })
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  async function deleteWord(id: number) {
    const word = words.find(item => item.id === id)
    if (word?.local_encrypted && word.source_book_id) {
      await deleteEncryptedWord(word.source_book_id, id)
    } else {
      await fetch(`/api/words?id=${id}`, { method: 'DELETE' })
    }
    setWords(prev => prev.filter(w => w.id !== id))
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
  }

  async function deleteSelected() {
    const selectedWords = words.filter(word => selected.has(word.id))
    const localWords = selectedWords.filter(word => word.local_encrypted && word.source_book_id)
    const serverIds = selectedWords.filter(word => !word.local_encrypted).map(word => word.id)
    await Promise.all(localWords.map(word => deleteEncryptedWord(word.source_book_id!, word.id)))
    if (serverIds.length) await fetch(`/api/words?ids=${serverIds.join(',')}`, { method: 'DELETE' })
    setWords(prev => prev.filter(w => !selected.has(w.id)))
    setSelected(new Set())
  }

  async function saveWordEdit(word: Word) {
    const payload = {
      id: word.id,
      word: editDraft.word.trim(),
      definition: editDraft.definition.trim(),
      context: editDraft.context.trim(),
    }
    if (!payload.word) return
    if (word.local_encrypted && word.source_book_id) {
      await updateEncryptedWord(word.source_book_id, word.id, payload)
    } else {
      await fetch('/api/words', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }
    setWords(prev => prev.map(w => w.id === word.id ? { ...w, ...payload } : w))
    setEditingId(null)
  }

  function startEdit(word: Word) {
    setEditingId(word.id)
    setEditDraft({
      word: word.word || '',
      definition: word.definition || '',
      context: word.context || '',
    })
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  function toggleSelect(id: number) {
    setSelected(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(w => w.id)))
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function exportWords(format: 'csv' | 'json', ids?: Set<number>) {
    const toExport = ids ? words.filter(w => ids.has(w.id)) : words
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: 'application/json' })
      downloadBlob(blob, 'kelimeler.json')
    } else {
      const header = 'Kelime,Tanım,Bağlam,Kaynak Kitap,Sayfa,Eklenme Tarihi'
      const rows = toExport.map(w =>
        [csvCell(w.word), csvCell(w.definition), csvCell(w.context),
          csvCell(w.book_title), w.source_page ?? '', w.created_at].join(',')
      )
      const bom = '﻿' // UTF-8 BOM for Excel
      const blob = new Blob([bom + header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
      downloadBlob(blob, 'kelimeler.csv')
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = (() => {
    const q = cleanText(search).toLocaleLowerCase(locale).trim()
    return words.filter(w =>
      !q || cleanText(`${w.word} ${w.definition} ${w.context} ${w.book_title ?? ''}`).toLocaleLowerCase(locale).includes(q)
    )
  })()

  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0

  return (
    <LibraryPageShell
      title="Kelime Kütüphanesi"
      subtitle={loading ? '...' : `${words.length} kelime`}
      libraryTheme={libraryTheme}
      active="words"
    >
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <SyncStatusBadge compact={false} />
        <button
          onClick={() => exportWords('csv')}
          className={`min-h-11 rounded-xl px-3 py-2 text-xs font-bold ${th.filterInactive}`}
        >
          ↓ CSV
        </button>
        <button
          onClick={() => exportWords('json')}
          className={`min-h-11 rounded-xl px-3 py-2 text-xs font-bold ${th.filterInactive}`}
        >
          ↓ JSON
        </button>
        <LanguageSwitcher compact />
      </div>

      <div>
        {/* Search + select-all */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 cursor-pointer" style={{ accentColor: th.progressColor }}
            />
            <span className={`text-xs ${th.cardMuted}`}>Tümü</span>
          </label>
          <input
            type="text"
            placeholder="Kelime ara..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm outline-none transition-all duration-200 liquid-glass-input ${th.input}`}
            style={{
              '--focus-color': th.progressColor,
              '--focus-glow': th.progressGlow,
            } as React.CSSProperties}
          />
        </div>

        {/* Batch action bar */}
        {someSelected && (
          <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3 ${th.card}`}>
            <span className={`text-sm font-medium ${th.cardText}`}>{selected.size} kelime seçili</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => exportWords('csv', selected)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium min-h-[44px] ${th.filterActive}`}
              >
                ↓ CSV indir
              </button>
              <button
                onClick={() => exportWords('json', selected)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium min-h-[44px] ${th.filterActive}`}
              >
                ↓ JSON indir
              </button>
              <button
                onClick={deleteSelected}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium min-h-[44px] ${th.actionDel}`}
              >
                Seçilenleri sil
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className={`rounded-xl border p-4 ${th.card}`}>
                <div className={`h-5 w-32 rounded skeleton-shimmer ${th.skelLine}`} />
                <div className={`mt-3 h-3 w-full rounded skeleton-shimmer ${th.skelLine}`} />
                <div className={`mt-2 h-3 w-4/5 rounded skeleton-shimmer ${th.skelLine}`} />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className={`py-20 text-center ${th.cardMuted}`}>
            <p className="text-lg">Kelime bulunamadı.</p>
            <p className={`mt-1 text-sm ${th.cardMuted}`}>PDF okurken kelimeleri kaydettiğinde burada görünür.</p>
          </div>
        )}

        {/* Word list */}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-col gap-3">
            {filtered.map(word => (
              <div
                key={word.id}
                className={`rounded-xl border p-3 shadow-sm transition-all duration-300 sm:p-4 hover:-translate-y-1 hover:shadow-lg ${th.card} ${selected.has(word.id) ? 'ring-2 ring-[var(--lib-accent)] bg-[var(--lib-accent-surface)] shadow-[0_0_15px_var(--lib-accent-surface)]' : 'hover:border-[var(--lib-border-strong)]'}`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(word.id)}
                    onChange={() => toggleSelect(word.id)}
                    className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer" style={{ accentColor: th.progressColor }}
                  />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {/* Word + TDK button */}
                    <div className="flex flex-wrap items-center gap-2">
                      {editingId === word.id ? (
                        <input
                          value={editDraft.word}
                          onChange={e => setEditDraft(prev => ({ ...prev, word: e.target.value }))}
                          className={`min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-lg font-bold outline-none ${th.input}`}
                        />
                      ) : (
                        <p title={cleanText(word.word)} className={`text-lg font-bold ${th.cardText}`}>{cleanText(word.word)}</p>
                      )}
                      {editingId !== word.id && (
                        <button
                          onClick={() => startEdit(word)}
                          className={`rounded-full px-3 py-0.5 text-[11px] font-semibold transition active:scale-95 hover:bg-[var(--lib-surface-muted)] ${th.cardBadge}`}
                        >
                          Düzenle
                        </button>
                      )}
                      <button
                        onClick={() => fetchTDK(word)}
                        disabled={tdkLoading.has(word.id) || word.local_encrypted}
                        title={word.local_encrypted ? 'Şifreli kitaplarda çevrim içi sözlük kapalıdır.' : 'TDK'}
                        className={`rounded-full px-3 py-0.5 text-[11px] font-semibold transition active:scale-95 hover:bg-[var(--lib-surface-muted)] ${th.cardBadge}`}
                      >
                        {tdkLoading.has(word.id) ? '...' : 'TDK'}
                      </button>
                      <button
                        onClick={() => fetchEnglishDefinition(word)}
                        disabled={tdkLoading.has(word.id) || word.local_encrypted}
                        title={word.local_encrypted ? 'Şifreli kitaplarda çevrim içi sözlük kapalıdır.' : 'English dictionary'}
                        className={`rounded-full px-3 py-0.5 text-[11px] font-semibold transition active:scale-95 hover:bg-[var(--lib-surface-muted)] ${th.cardBadge}`}
                      >
                        {tdkLoading.has(word.id) ? '...' : 'EN'}
                      </button>
                    </div>

                    {editingId === word.id ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <label className={`text-[11px] font-semibold uppercase tracking-wide ${th.cardMuted}`}>Tanım</label>
                        <textarea
                          ref={editRef}
                          value={editDraft.definition}
                          onChange={e => setEditDraft(prev => ({ ...prev, definition: e.target.value }))}
                          rows={4}
                          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none resize-y ${th.input}`}
                        />
                        <label className={`text-[11px] font-semibold uppercase tracking-wide ${th.cardMuted}`}>Bağlam</label>
                        <textarea
                          value={editDraft.context}
                          onChange={e => setEditDraft(prev => ({ ...prev, context: e.target.value }))}
                          rows={2}
                          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none resize-y ${th.input}`}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveWordEdit(word)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium min-h-[44px] ${th.filterActive}`}
                          >
                            Kaydet
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className={`rounded-lg px-3 py-1.5 text-xs min-h-[44px] ${th.filterInactive}`}
                          >
                            İptal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(word)}
                        className={`mt-1 block w-full text-left text-sm leading-relaxed ${th.cardSub} hover:opacity-70`}
                      >
                        {word.definition
                          ? <span className="whitespace-pre-line">{cleanText(word.definition)}</span>
                          : <span className={`italic ${th.cardMuted}`}>Tanım yok — TDK&apos;dan çek veya tıkla düzenle</span>
                        }
                      </button>
                    )}

                    {editingId !== word.id && word.context && (
                      <p title={cleanText(word.context)} className={`mt-2 text-xs italic ${th.cardItalic}`}>
                        &quot;{cleanText(word.context)}&quot;
                      </p>
                    )}

                    {/* Source */}
                    {word.book_title && (
                      <p title={cleanText(word.book_title)} className={`mt-1.5 text-xs ${th.cardSource}`}>
                        {cleanText(word.book_title)}{word.source_page ? ` — s. ${word.source_page}` : ''}
                      </p>
                    )}
                    {word.local_encrypted && (
                      <p className={`mt-1.5 text-xs ${th.cardSource}`}>Şifreli kitap · yalnızca bu cihazda</p>
                    )}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => deleteWord(word.id)}
                    className={`shrink-0 rounded-xl px-4 py-1.5 text-xs font-semibold min-h-[38px] transition active:scale-95 ${th.actionDel}`}
                  >
                    Sil
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </LibraryPageShell>
  )
}
