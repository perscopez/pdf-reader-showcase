'use client'

import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown, ChevronUp, Loader2, Search, X } from 'lucide-react'
import { useI18n } from './I18nProvider'
import type { PdfSearchMatch } from '@/lib/pdfInDocSearch'

interface PdfInDocSearchProps {
  open: boolean
  query: string
  matches: PdfSearchMatch[]
  activeIndex: number
  loading: boolean
  onQueryChange: (value: string) => void
  onClose: () => void
  onNext: () => void
  onPrev: () => void
  onSelectResult: (index: number) => void
  isDark?: boolean
}

function SnippetPreview({ match }: { match: PdfSearchMatch }) {
  const before = match.snippet.slice(0, match.snippetMatchStart)
  const hit = match.snippet.slice(match.snippetMatchStart, match.snippetMatchEnd)
  const after = match.snippet.slice(match.snippetMatchEnd)
  return (
    <span className="block text-[12.5px] leading-relaxed">
      <span className="opacity-70">{before}</span>
      <mark className="rounded bg-[rgba(229,9,20,0.28)] px-0.5 font-semibold text-current">{hit}</mark>
      <span className="opacity-70">{after}</span>
    </span>
  )
}

export default function PdfInDocSearch({
  open,
  query,
  matches,
  activeIndex,
  loading,
  onQueryChange,
  onClose,
  onNext,
  onPrev,
  onSelectResult,
  isDark = true,
}: PdfInDocSearchProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) onPrev()
        else onNext()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        onNext()
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        onPrev()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, onNext, onPrev])

  useEffect(() => {
    if (!open) return
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const hasQuery = query.trim().length >= 2
  const grouped = useMemo(() => {
    const map = new Map<number, { index: number; match: PdfSearchMatch }[]>()
    matches.forEach((match, index) => {
      const list = map.get(match.page) ?? []
      list.push({ index, match })
      map.set(match.page, list)
    })
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [matches])

  if (!open) return null

  const countLabel = loading
    ? t('common.loading')
    : matches.length
      ? (activeIndex >= 0
        ? t('reader.docSearch.matchOf', { current: activeIndex + 1, total: matches.length })
        : t('reader.docSearch.resultsCount', { total: matches.length }))
      : hasQuery
        ? t('reader.docSearch.noMatches')
        : t('reader.docSearch.typeToSearch')

  return (
    <div
      className={`fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[220] mx-auto flex max-h-[70vh] max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl sm:inset-x-auto sm:right-4 sm:left-auto sm:w-[26rem] ${isDark ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-light border-black/10 text-slate-900'}`}
      role="dialog"
      aria-label={t('reader.docSearch.resultsTitle')}
    >
      <div className="flex items-center gap-2 border-b border-current/10 p-2">
        <Search size={16} className="shrink-0 opacity-70" />
        <input
          ref={inputRef}
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={t('reader.docSearch.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60"
          aria-label={t('reader.docSearch.placeholder')}
        />
        <button type="button" onClick={onPrev} disabled={matches.length === 0} className="rounded-lg border border-current/15 p-1.5 disabled:opacity-40" aria-label={t('reader.docSearch.prev')}>
          <ChevronUp size={14} />
        </button>
        <button type="button" onClick={onNext} disabled={matches.length === 0} className="rounded-lg border border-current/15 p-1.5 disabled:opacity-40" aria-label={t('reader.docSearch.next')}>
          <ChevronDown size={14} />
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-current/15 p-1.5" aria-label={t('common.close')}>
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide opacity-70">
        {loading && <Loader2 size={12} className="animate-spin" />}
        <span>{countLabel}</span>
      </div>

      {matches.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
          {grouped.map(([page, items]) => (
            <div key={page} className="mb-1">
              <p className="sticky top-0 z-10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider opacity-55 backdrop-blur-sm">
                {t('reader.docSearch.pageLabel', { page })}
              </p>
              {items.map(({ index, match }) => {
                const isActive = index === activeIndex
                return (
                  <button
                    key={index}
                    ref={isActive ? activeItemRef : undefined}
                    type="button"
                    onClick={() => onSelectResult(index)}
                    className={`mb-1 flex w-full gap-2 rounded-xl px-2.5 py-2 text-left transition ${isActive ? (isDark ? 'bg-white/12 ring-1 ring-white/20' : 'bg-black/8 ring-1 ring-black/10') : (isDark ? 'hover:bg-white/6' : 'hover:bg-black/5')}`}
                  >
                    <span className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${isDark ? 'bg-white/10' : 'bg-black/8'}`}>{page}</span>
                    <SnippetPreview match={match} />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {matches.length === 0 && hasQuery && !loading && (
        <div className="px-4 py-8 text-center text-sm opacity-60">{t('reader.docSearch.noMatches')}</div>
      )}
    </div>
  )
}
