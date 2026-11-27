'use client'

import { useMemo, useState } from 'react'
import type { Annotation, BookmarkRow } from '@/components/ReaderTypes'

type ThemeStyle = { panel: string; subtle: string; text: string; button: string; active: string; accent?: string }

export function ReaderNavigationCockpit({
  currentPage,
  totalPages,
  bookmarks,
  annotations,
  outline,
  themeStyle,
  pageLabel,
  onPageChange,
  onOpenOutline,
  onOpenNotes,
  showThumbnails,
  onToggleThumbnails,
}: {
  currentPage: number
  totalPages: number
  bookmarks: BookmarkRow[]
  annotations: Annotation[]
  outline: Array<{ title: string; dest: unknown }>
  themeStyle: ThemeStyle
  pageLabel: (page: number) => string
  onPageChange: (page: number) => void
  onOpenOutline: () => void
  onOpenNotes: () => void
  showThumbnails: boolean
  onToggleThumbnails: () => void
}) {
  const [pageInput, setPageInput] = useState(String(currentPage))
  const progress = totalPages ? Math.round((currentPage / totalPages) * 100) : 0
  const noteCount = useMemo(() => annotations.filter(item => item.type === 'note').length, [annotations])
  const highlightCount = useMemo(() => annotations.filter(item => item.type === 'highlight').length, [annotations])

  function commitPage() {
    const parsed = Number(pageInput)
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage))
      return
    }
    const next = Math.min(Math.max(1, Math.floor(parsed)), Math.max(1, totalPages))
    setPageInput(String(next))
    onPageChange(next)
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-4 ${themeStyle.button}`}>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${themeStyle.subtle}`}>Reader cockpit</p>
            <p className={`mt-1 text-3xl font-black ${themeStyle.text}`}>{progress}%</p>
          </div>
          <p className={`text-right text-xs ${themeStyle.subtle}`}>{pageLabel(currentPage)} / {pageLabel(totalPages || 0)}</p>
        </div>
        <input type="range" min={1} max={Math.max(1, totalPages)} value={Math.min(currentPage, Math.max(1, totalPages))} onChange={event => onPageChange(Number(event.target.value))} className="w-full" style={{ accentColor: themeStyle.accent || '#e50914' }} aria-label="Page scrubber" />
        <div className="mt-3 flex items-center gap-2">
          <input value={pageInput} onChange={event => setPageInput(event.target.value)} onBlur={commitPage} onKeyDown={event => { if (event.key === 'Enter') commitPage() }} className={`w-20 rounded-lg border px-2 py-1.5 text-center text-sm ${themeStyle.button}`} aria-label="Go to page" />
          <span className={`text-xs ${themeStyle.subtle}`}>/ {totalPages || '?'}</span>
          <button type="button" onClick={() => onPageChange(Math.max(1, currentPage - 1))} className={`ml-auto rounded-lg border px-2.5 py-1.5 text-xs ${themeStyle.button}`}>−</button>
          <button type="button" onClick={() => onPageChange(Math.min(Math.max(1, totalPages), currentPage + 1))} className={`rounded-lg border px-2.5 py-1.5 text-xs ${themeStyle.button}`}>+</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onOpenNotes} className={`rounded-xl border p-3 text-left ${themeStyle.button}`}><span className="block text-lg font-bold">{noteCount}</span><span className={`text-[10px] ${themeStyle.subtle}`}>Notes</span></button>
        <button type="button" onClick={onOpenNotes} className={`rounded-xl border p-3 text-left ${themeStyle.button}`}><span className="block text-lg font-bold">{highlightCount}</span><span className={`text-[10px] ${themeStyle.subtle}`}>Highlights</span></button>
        <button type="button" onClick={onOpenOutline} className={`rounded-xl border p-3 text-left ${themeStyle.button}`}><span className="block text-lg font-bold">{outline.length}</span><span className={`text-[10px] ${themeStyle.subtle}`}>Chapters</span></button>
      </div>
      <button type="button" onClick={onToggleThumbnails} aria-pressed={showThumbnails} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs font-semibold ${showThumbnails ? themeStyle.active : themeStyle.button}`}><span>Thumbnail strip</span><span className="text-[10px]">{showThumbnails ? 'ON' : 'OFF'}</span></button>

      {bookmarks.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between"><p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${themeStyle.subtle}`}>Bookmarks</p><span className={`text-xs ${themeStyle.subtle}`}>{bookmarks.length}</span></div>
          <div className="space-y-1.5">
            {bookmarks.slice(0, 6).map(bookmark => <button key={bookmark.id} type="button" onClick={() => onPageChange(bookmark.page)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs ${themeStyle.button}`}><span>{pageLabel(bookmark.page)}</span><span className={themeStyle.subtle}>→</span></button>)}
          </div>
        </div>
      )}

      {outline.length > 0 && (
        <div>
          <button type="button" onClick={onOpenOutline} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs font-semibold ${themeStyle.button}`}><span>Open outline</span><span className={themeStyle.subtle}>→</span></button>
        </div>
      )}
    </div>
  )
}
