'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, StickyNote, Trash2, X } from 'lucide-react'
import type { Annotation } from './ReaderTypes'
import { useI18n } from './I18nProvider'
import { buildAnnotationDraftKey, normalizeAnnotationTags } from '@/lib/annotations'
import type { AnnotationCategory } from '@/lib/annotationCategories'

type EditorTheme = {
  panel: string
  button: string
  active: string
  subtle: string
  text: string
  accent: string
}

interface AnnotationEditorProps {
  bookId: number
  page: number
  annotation?: Annotation | null
  initialContent?: Partial<Annotation['content']>
  pageNote?: boolean
  themeStyle: EditorTheme
  saving?: boolean
  onSave: (content: Partial<Annotation['content']>) => Promise<void> | void
  onClose: () => void
  categories?: AnnotationCategory[]
  onManageCategories?: () => void
}

interface AnnotationDraft {
  note: string
  tags: string[]
  categoryId?: number | null
}

export default function AnnotationEditor({
  bookId,
  page,
  annotation,
  initialContent,
  pageNote = false,
  themeStyle,
  saving = false,
  onSave,
  onClose,
  categories = [],
  onManageCategories,
}: AnnotationEditorProps) {
  const { t } = useI18n()
  const draftKey = useMemo(
    () => buildAnnotationDraftKey(bookId, page, annotation?.id),
    [annotation?.id, bookId, page],
  )
  const initialDraft = useMemo(() => {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return null
      const draft = JSON.parse(raw) as AnnotationDraft
      if (typeof draft.note !== 'string') return null
      return { note: draft.note, tags: normalizeAnnotationTags(draft.tags), categoryId: draft.categoryId ?? null }
    } catch {
      return null
    }
  }, [draftKey])
  const sourceContent = annotation?.content || initialContent
  const [note, setNote] = useState(initialDraft?.note ?? sourceContent?.note ?? '')
  const [tags, setTags] = useState(() => initialDraft?.tags ?? normalizeAnnotationTags(sourceContent?.tags))
  const [customTag, setCustomTag] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(initialDraft?.categoryId ?? sourceContent?.categoryId ?? null)
  const [draftRestored, setDraftRestored] = useState(Boolean(initialDraft))

  const suggestedTags = [
    t('reader.tag.important'),
    t('reader.tag.research'),
    t('reader.tag.quote'),
    t('reader.tag.exam'),
    t('reader.tag.unclear'),
  ]

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const initialNote = sourceContent?.note || ''
      const initialTags = normalizeAnnotationTags(sourceContent?.tags)
      const changed = note !== initialNote || JSON.stringify(tags) !== JSON.stringify(initialTags) || categoryId !== (sourceContent?.categoryId ?? null)
      if (!changed && !note.trim()) return
      localStorage.setItem(draftKey, JSON.stringify({ note, tags, categoryId } satisfies AnnotationDraft))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [categoryId, draftKey, note, sourceContent?.categoryId, sourceContent?.note, sourceContent?.tags, tags])

  function toggleTag(tag: string) {
    setTags(current => (
      current.some(item => item.toLocaleLowerCase('tr') === tag.toLocaleLowerCase('tr'))
        ? current.filter(item => item.toLocaleLowerCase('tr') !== tag.toLocaleLowerCase('tr'))
        : normalizeAnnotationTags([...current, tag])
    ))
  }

  function addCustomTag() {
    const next = normalizeAnnotationTags([...tags, customTag])
    if (next.length === tags.length) return
    setTags(next)
    setCustomTag('')
  }

  function discardDraft() {
    localStorage.removeItem(draftKey)
    setNote(sourceContent?.note || '')
    setTags(normalizeAnnotationTags(sourceContent?.tags))
    setCategoryId(sourceContent?.categoryId ?? null)
    setDraftRestored(false)
  }

  async function save() {
    if (!note.trim() || saving) return
    await onSave({
      ...sourceContent,
      ...initialContent,
      schemaVersion: 2,
      note: note.trim(),
      tags,
      categoryId,
      pageNote: annotation?.content.pageNote ?? pageNote,
    })
    localStorage.removeItem(draftKey)
  }

  return (
    <div className="fixed inset-0 z-[420] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="annotation-editor-title"
        className={`max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border p-4 shadow-[0_28px_90px_rgba(0,0,0,0.5)] sm:max-w-xl sm:rounded-2xl sm:p-5 ${themeStyle.panel}`}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ color: themeStyle.accent, backgroundColor: `${themeStyle.accent}1f` }}>
              <StickyNote size={19} />
            </span>
            <div>
              <h2 id="annotation-editor-title" className={`text-base font-bold ${themeStyle.text}`}>
                {annotation ? t('reader.editNote') : t('reader.addPageNote')}
              </h2>
              <p className={`text-xs ${themeStyle.subtle}`}>{t('common.pageShort')} {page}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.close')}>
            <X size={17} />
          </button>
        </div>

        {draftRestored && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs">
            <span>{t('reader.draftRestored')}</span>
            <button type="button" onClick={discardDraft} className="flex items-center gap-1 font-semibold text-amber-200">
              <Trash2 size={13} /> {t('reader.discardDraft')}
            </button>
          </div>
        )}

        {(sourceContent?.snapshot?.previewUrl || sourceContent?.area?.previewUrl) && (
          <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/15 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sourceContent.snapshot?.previewUrl || sourceContent.area?.previewUrl} alt={t('reader.snapshotPreview')} className="max-h-48 w-full rounded-lg object-contain" />
          </div>
        )}

        {sourceContent?.sources && sourceContent.sources.length > 0 && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {sourceContent.sources.map((source, index) => (
              <div key={`${source.page}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                <p className={`text-[10px] font-bold uppercase tracking-wide ${themeStyle.subtle}`}>
                  {t('reader.sourceNumber', { number: index + 1 })} · {t('common.pageShort')} {source.page}
                </p>
                {source.text && <p className={`mt-1 line-clamp-3 text-xs leading-relaxed ${themeStyle.text}`}>{source.text}</p>}
              </div>
            ))}
          </div>
        )}

        <textarea
          autoFocus
          value={note}
          onChange={event => setNote(event.target.value)}
          placeholder={t('reader.notePlaceholder')}
          rows={7}
          className="liquid-glass-input mt-4 w-full resize-y rounded-xl p-3 text-sm leading-relaxed outline-none"
        />

        <div className="mt-4">
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <p className={`text-[11px] font-bold uppercase tracking-[0.16em] ${themeStyle.subtle}`}>{t('reader.categoryLabel')}</p>
              {onManageCategories && <button type="button" onClick={onManageCategories} className={`rounded-lg border px-2 py-1 text-[11px] ${themeStyle.button}`}>{t('reader.manageCategories')}</button>}
            </div>
            <select value={categoryId || ''} onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : null)} className={`min-h-10 w-full rounded-xl border px-3 text-sm ${themeStyle.button}`}>
              <option value="">{t('reader.uncategorized')}</option>
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
          <p className={`mb-2 text-[11px] font-bold uppercase tracking-[0.16em] ${themeStyle.subtle}`}>{t('reader.tags')}</p>
          <div className="flex flex-wrap gap-2">
            {suggestedTags.map(tag => {
              const active = tags.some(item => item.toLocaleLowerCase('tr') === tag.toLocaleLowerCase('tr'))
              return (
                <button
                  type="button"
                  key={tag}
                  aria-pressed={active}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? themeStyle.active : themeStyle.button}`}
                >
                  {active && <Check size={12} className="mr-1 inline" />}
                  {tag}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={customTag}
              onChange={event => setCustomTag(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addCustomTag()
                }
              }}
              placeholder={t('reader.customTag')}
              className="liquid-glass-input min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none"
            />
            <button type="button" onClick={addCustomTag} disabled={!customTag.trim()} className={`rounded-xl border px-3 disabled:opacity-40 ${themeStyle.button}`} aria-label={t('reader.addTag')}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className={`min-h-11 flex-1 rounded-xl border px-4 text-sm font-semibold ${themeStyle.button}`}>
            {t('common.cancel')}
          </button>
          <button type="button" onClick={save} disabled={!note.trim() || saving} className="liquid-glass-btn-primary min-h-11 flex-1 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50">
            {saving ? `${t('common.save')}…` : t('common.save')}
          </button>
        </div>
      </section>
    </div>
  )
}
