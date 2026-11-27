'use client'

import { useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronUp, Merge, Plus, Search, Trash2, X } from 'lucide-react'
import { ANNOTATION_CATEGORY_COLORS, type AnnotationCategory } from '@/lib/annotationCategories'
import { useI18n } from './I18nProvider'

type Theme = { panel: string; button: string; active: string; subtle: string; text: string }
type ManagedCategory = AnnotationCategory & { bookCount?: number }
type CategoryBook = {
  id: number
  title: string
  author?: string
  category_ids?: number[]
  categories?: Array<{ id: number; name: string; color: string }>
}

export default function AnnotationCategoryManager({
  categories,
  themeStyle,
  onChange,
  onClose,
  endpoint = '/api/annotation-categories',
  title,
  help,
  addLabel,
  errorMessage,
  deleteConfirm,
  mergeConfirm,
  books,
  onBooksChanged,
}: {
  categories: ManagedCategory[]
  themeStyle: Theme
  onChange: (categories: ManagedCategory[]) => void
  onClose: () => void
  endpoint?: string
  title?: string
  help?: string
  addLabel?: string
  errorMessage?: string
  deleteConfirm?: string
  mergeConfirm?: string
  books?: CategoryBook[]
  onBooksChanged?: () => void | Promise<void>
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(ANNOTATION_CATEGORY_COLORS[0])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [mergeTarget, setMergeTarget] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [managingCategory, setManagingCategory] = useState<ManagedCategory | null>(null)
  const [bookSearch, setBookSearch] = useState('')
  const [selectedBookIds, setSelectedBookIds] = useState<number[]>([])

  function reportError(value: unknown) {
    setError(errorMessage || (value instanceof Error ? value.message : 'Category operation failed'))
  }

  async function refreshResponse(res: Response) {
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Category operation failed')
    if (Array.isArray(data)) onChange(data)
    return data
  }

  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await refreshResponse(await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }),
      }))
      onChange([...categories, created])
      setName('')
    } catch (value) {
      reportError(value)
    } finally { setBusy(false) }
  }

  async function update(category: AnnotationCategory, patch: Partial<AnnotationCategory>) {
    setBusy(true)
    setError('')
    try {
      const updated = await refreshResponse(await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...category, ...patch }),
      }))
      onChange(categories.map(item => item.id === updated.id ? updated : item))
      setEditingId(null)
    } catch (value) {
      reportError(value)
    } finally { setBusy(false) }
  }

  async function remove(category: AnnotationCategory) {
    if (!window.confirm(deleteConfirm || t('reader.categoryDeleteConfirm'))) return
    setBusy(true)
    setError('')
    try {
      await refreshResponse(await fetch(`${endpoint}?id=${category.id}&unassign=1`, { method: 'DELETE' }))
      onChange(categories.filter(item => item.id !== category.id))
    } catch (value) {
      reportError(value)
    } finally { setBusy(false) }
  }

  async function merge(category: AnnotationCategory) {
    const targetId = mergeTarget[category.id]
    if (!targetId || !window.confirm(mergeConfirm || t('reader.categoryMergeConfirm'))) return
    setBusy(true)
    setError('')
    try {
      await refreshResponse(await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', source_id: category.id, target_id: targetId }),
      }))
    } catch (value) {
      reportError(value)
    } finally { setBusy(false) }
  }

  async function move(category: AnnotationCategory, direction: -1 | 1) {
    const index = categories.findIndex(item => item.id === category.id)
    const neighbor = categories[index + direction]
    if (!neighbor || busy) return
    setBusy(true)
    setError('')
    try {
      for (const item of [
        { ...category, position: neighbor.position },
        { ...neighbor, position: category.position },
      ]) {
        await refreshResponse(await fetch(endpoint, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item),
        }))
      }
      const res = await fetch(endpoint)
      onChange(await res.json())
    } catch (value) {
      reportError(value)
    } finally { setBusy(false) }
  }

  function openBooks(category: ManagedCategory) {
    setManagingCategory(category)
    setBookSearch('')
    setSelectedBookIds((books || []).filter(book => (
      book.category_ids?.includes(category.id) || book.categories?.some(item => item.id === category.id)
    )).map(book => book.id))
    setError('')
  }

  async function saveBooks() {
    if (!managingCategory || busy) return
    setBusy(true)
    setError('')
    try {
      await refreshResponse(await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-books', category_id: managingCategory.id, book_ids: selectedBookIds }),
      }))
      await onBooksChanged?.()
      setManagingCategory(null)
    } catch (value) {
      reportError(value)
    } finally {
      setBusy(false)
    }
  }

  const filteredBooks = (books || []).filter(book => {
    const query = bookSearch.trim().toLocaleLowerCase()
    return !query || `${book.title} ${book.author || ''}`.toLocaleLowerCase().includes(query)
  })

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="category-manager-title" className={`max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border p-4 shadow-2xl sm:max-w-xl sm:rounded-2xl ${themeStyle.panel}`}>
        {managingCategory ? (
          <>
            <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 pb-3 backdrop-blur-xl">
              <button type="button" onClick={() => setManagingCategory(null)} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.back')}><ChevronLeft size={16} /></button>
              <div className="min-w-0 flex-1">
                <h2 id="category-manager-title" className={`truncate font-bold ${themeStyle.text}`}>{managingCategory.name}</h2>
                <p className={`text-xs ${themeStyle.subtle}`}>{t('library.categoryBooksSelected', { count: selectedBookIds.length })}</p>
              </div>
              <button type="button" onClick={onClose} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.close')}><X size={16} /></button>
            </div>

            <label className={`mt-1 flex items-center gap-2 rounded-xl border px-3 ${themeStyle.button}`}>
              <Search size={15} />
              <input value={bookSearch} onChange={event => setBookSearch(event.target.value)} placeholder={t('library.searchBooks')} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </label>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setSelectedBookIds(current => [...new Set([...current, ...filteredBooks.map(book => book.id)])])} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${themeStyle.button}`}>{t('library.selectAll')}</button>
              <button type="button" onClick={() => setSelectedBookIds([])} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${themeStyle.button}`}>{t('library.clearSelection')}</button>
            </div>
            <div className="mt-3 max-h-[52dvh] space-y-2 overflow-y-auto pb-2">
              {filteredBooks.map(book => {
                const checked = selectedBookIds.includes(book.id)
                return (
                  <label
                    key={book.id}
                    className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${themeStyle.button} ${checked ? 'ring-1 ring-inset' : ''}`}
                    style={checked ? { borderColor: `${managingCategory.color}88`, backgroundColor: `${managingCategory.color}16`, color: managingCategory.color } : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedBookIds(current => checked ? current.filter(id => id !== book.id) : [...current, book.id])}
                      className="h-4 w-4 accent-[#e50914]"
                    />
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06]"><BookOpen size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-semibold ${themeStyle.text}`}>{book.title}</span>
                      <span className={`block truncate text-xs ${themeStyle.subtle}`}>{book.author || t('library.unknownAuthor')}</span>
                      {!!book.categories?.length && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {book.categories.slice(0, 3).map(category => (
                            <span key={category.id} className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px]" style={{ color: category.color }}>{category.name}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
              {!filteredBooks.length && <p className={`py-8 text-center text-sm ${themeStyle.subtle}`}>{t('library.noBooksFound')}</p>}
            </div>
            {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
            <div className="sticky bottom-0 -mx-1 mt-2 flex gap-2 pt-3 backdrop-blur-xl">
              <button type="button" onClick={() => setManagingCategory(null)} className={`min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold ${themeStyle.button}`}>{t('common.cancel')}</button>
              <button type="button" onClick={saveBooks} disabled={busy} className="liquid-glass-btn-primary min-h-11 flex-1 rounded-xl px-3 text-sm font-bold text-white disabled:opacity-40">{t('common.save')}</button>
            </div>
          </>
        ) : (
          <>
        <div className="flex items-center justify-between">
          <div>
            <h2 id="category-manager-title" className={`font-bold ${themeStyle.text}`}>{title || t('reader.manageCategories')}</h2>
            <p className={`text-xs ${themeStyle.subtle}`}>{help || t('reader.categoryHelp')}</p>
          </div>
          <button onClick={onClose} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.close')}><X size={16} /></button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('reader.categoryName')} className="liquid-glass-input w-full rounded-xl px-3 py-2 text-sm outline-none" />
          <div className="mt-3 flex items-center gap-2">
            <div className="flex flex-1 flex-wrap gap-2">
              {ANNOTATION_CATEGORY_COLORS.map(item => (
                <button key={item} onClick={() => setColor(item)} aria-label={item} aria-pressed={color === item} className="h-7 w-7 rounded-full border-2" style={{ backgroundColor: item, borderColor: color === item ? 'white' : 'transparent' }} />
              ))}
            </div>
            <button onClick={create} disabled={!name.trim() || busy} className="liquid-glass-btn-primary flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold text-white disabled:opacity-40"><Plus size={14} />{addLabel || t('reader.addTag')}</button>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="mt-3 space-y-2">
          {categories.map((category, categoryIndex) => (
            <div key={category.id} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
                {editingId === category.id ? (
                  <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void update(category, { name: editingName }) }} className="liquid-glass-input min-w-0 flex-1 rounded-lg px-2 py-1 text-sm" />
                ) : <button className={`min-w-0 flex-1 truncate text-left text-sm font-semibold ${themeStyle.text}`} onClick={() => { setEditingId(category.id); setEditingName(category.name) }}>{category.name}</button>}
                {editingId === category.id && <button onClick={() => update(category, { name: editingName })} className={`rounded-lg border p-1.5 ${themeStyle.button}`} aria-label={t('common.save')}><Check size={14} /></button>}
                <button onClick={() => move(category, -1)} disabled={categoryIndex === 0 || busy} className={`rounded-lg border p-1.5 disabled:opacity-30 ${themeStyle.button}`} aria-label={t('reader.moveCategoryUp')}><ChevronUp size={14} /></button>
                <button onClick={() => move(category, 1)} disabled={categoryIndex === categories.length - 1 || busy} className={`rounded-lg border p-1.5 disabled:opacity-30 ${themeStyle.button}`} aria-label={t('reader.moveCategoryDown')}><ChevronDown size={14} /></button>
                <button onClick={() => remove(category)} className="rounded-lg border border-red-400/20 p-1.5 text-red-300"><Trash2 size={14} /></button>
              </div>
              {books && (
                <button type="button" onClick={() => openBooks(category)} className={`mt-2 flex min-h-10 w-full items-center justify-between rounded-lg border px-3 text-xs font-semibold ${themeStyle.button}`}>
                  <span className="flex items-center gap-2"><BookOpen size={14} />{t('library.manageCategoryBooks')}</span>
                  <span>{t('library.bookCount', { count: category.bookCount || 0 })}</span>
                </button>
              )}
              <div className="mt-2 flex gap-2">
                <select value={mergeTarget[category.id] || ''} onChange={e => setMergeTarget(current => ({ ...current, [category.id]: Number(e.target.value) }))} className={`min-h-9 min-w-0 flex-1 rounded-lg border px-2 text-xs ${themeStyle.button}`}>
                  <option value="">{t('reader.mergeInto')}</option>
                  {categories.filter(item => item.id !== category.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button onClick={() => merge(category)} disabled={!mergeTarget[category.id] || busy} className={`rounded-lg border px-2 disabled:opacity-40 ${themeStyle.button}`} aria-label={t('reader.mergeCategory')}><Merge size={14} /></button>
                <div className="flex gap-1">
                  {ANNOTATION_CATEGORY_COLORS.map(item => <button key={item} onClick={() => update(category, { color: item })} className="h-5 w-5 rounded-full" style={{ backgroundColor: item }} aria-label={item} />)}
                </div>
              </div>
            </div>
          ))}
        </div>
          </>
        )}
      </section>
    </div>
  )
}
