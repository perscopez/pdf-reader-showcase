'use client'

import { useEffect, useRef, useState } from 'react'
import { AlignJustify, FileText, Minus, Plus } from 'lucide-react'
import type { ReflowBlock } from '@/lib/reflow'
import { isTextMostlyGarbled } from '@/lib/text'

interface ReflowReaderProps {
  bookId: number
  currentPage: number
  themeStyle: { text: string; subtle: string; button: string }
  accent: string
  t: (key: string) => string
  onTextLoaded?: (text: string, blocks: ReflowBlock[]) => void
  onTextSelection?: (text: string, x: number, y: number) => void
  pageText?: { text: string; blocks: ReflowBlock[] }
  initialScrollOffset?: number
  onScrollPositionChange?: (offset: number) => void
  disableRemoteFetch?: boolean
  readerFontScale?: number
  readerLineHeight?: number
  readerColumnWidth?: number
  reducedMotion?: boolean
  onExitTextFlow?: () => void
  readingDirection?: 'auto' | 'ltr' | 'rtl'
}

function loadNumber(key: string, fallback: number, min: number, max: number) {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) return fallback
    const value = Number(stored)
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  } catch {
    return fallback
  }
}

export function ReflowReader({ bookId, currentPage, themeStyle, accent, t, onTextLoaded, onTextSelection, pageText, initialScrollOffset = 0, onScrollPositionChange, disableRemoteFetch = false, readerFontScale = 1, readerLineHeight, readerColumnWidth, reducedMotion = false, onExitTextFlow, readingDirection = 'auto' }: ReflowReaderProps) {
  const requestKey = `${bookId}:${currentPage}`
  const [pageData, setPageData] = useState<{ key: string; blocks: ReflowBlock[] }>({ key: '', blocks: [] })
  const [isGarbled, setIsGarbled] = useState(false)
  const [fontSize, setFontSize] = useState(() => loadNumber('reflow-font-size', 19, 15, 30))
  const [lineHeight, setLineHeight] = useState(() => loadNumber('reflow-line-height', 1.65, 1.35, 2.1))
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif' | 'mono' | 'dyslexic'>('sans')
  const [textAlign, setTextAlign] = useState<'left' | 'justify'>('left')
  const [columnWidth, setColumnWidth] = useState<36 | 44 | 56>(44)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const restoredPageRef = useRef<number | null>(null)

  const fontFamilies = {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Noto Sans", Arial, sans-serif',
    serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    dyslexic: '"OpenDyslexic", "Comic Sans MS", sans-serif',
  }

  useEffect(() => {
    if (pageText) {
      const frame = requestAnimationFrame(() => {
        setPageData({ key: requestKey, blocks: pageText.blocks })
        setIsGarbled(isTextMostlyGarbled(pageText.text))
        onTextLoaded?.(pageText.text, pageText.blocks)
      })
      return () => cancelAnimationFrame(frame)
    }
    if (disableRemoteFetch) {
      const frame = requestAnimationFrame(() => {
        setPageData({ key: requestKey, blocks: [] })
        setIsGarbled(false)
        onTextLoaded?.('', [])
      })
      return () => cancelAnimationFrame(frame)
    }
    let cancelled = false
    fetch(`/api/books/${bookId}/page-text?page=${currentPage}`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error('page text unavailable')))
      .then(data => {
        if (cancelled) return
        const nextBlocks = Array.isArray(data.blocks) ? data.blocks as ReflowBlock[] : []
        const text = typeof data.text === 'string' ? data.text : ''
        setPageData({ key: requestKey, blocks: nextBlocks })
        setIsGarbled(isTextMostlyGarbled(text))
        onTextLoaded?.(text, nextBlocks)
      })
      .catch(() => {
        if (!cancelled) {
          setPageData({ key: requestKey, blocks: [] })
          setIsGarbled(false)
          onTextLoaded?.('', [])
        }
      })
    return () => { cancelled = true }
  }, [bookId, currentPage, disableRemoteFetch, onTextLoaded, pageText, requestKey])

  useEffect(() => {
    if (restoredPageRef.current === currentPage) return
    restoredPageRef.current = currentPage
    const frame = requestAnimationFrame(() => rootRef.current?.scrollTo({ top: initialScrollOffset }))
    return () => cancelAnimationFrame(frame)
  }, [currentPage, initialScrollOffset])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('reflow-font-size', String(fontSize))
    } catch (e) {
      console.warn(e)
    }
  }, [fontSize])

  useEffect(() => {
    try {
      localStorage.setItem('reflow-line-height', String(lineHeight))
    } catch (e) {
      console.warn(e)
    }
  }, [lineHeight])

  function captureSelection() {
    const selection = window.getSelection()
    const text = selection?.toString().replace(/\s+/g, ' ').trim() || ''
    if (!selection || text.length < 2 || selection.rangeCount === 0) return
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    onTextSelection?.(text, rect.left, rect.bottom + 8)
  }

  return (
    <div
      ref={rootRef}
      className={`min-h-full max-h-full w-full overflow-y-auto py-3 sm:py-8 ${reducedMotion ? 'reader-reduced-motion' : ''}`}
      onScroll={event => {
        const offset = event.currentTarget.scrollTop
        if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = requestAnimationFrame(() => onScrollPositionChange?.(offset))
      }}
      aria-label={t('reader.reflowMode')}
      dir={readingDirection === 'auto' ? undefined : readingDirection}
      tabIndex={0}
    >
      <div className="sticky top-0 z-10 mx-auto mb-5 flex flex-wrap w-fit items-center gap-2 rounded-xl border border-white/10 bg-black/75 p-1.5 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/75" title={t('reader.reflowModeHint')}>
          <AlignJustify size={13} aria-hidden="true" />
          <span>{t('reader.reflowMode')}</span>
        </div>

        {onExitTextFlow && (
          <button
            type="button"
            onClick={onExitTextFlow}
            className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
            title={t('reader.pdfModeHint')}
          >
            <FileText size={13} aria-hidden="true" />
            <span>{t('reader.pdfMode')}</span>
          </button>
        )}

        <span className="hidden h-5 w-px bg-white/15 sm:block" />

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setFontSize(value => Math.max(15, value - 1))} className="min-h-11 min-w-11 rounded-md p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label={t('reader.reflowSmaller')}><Minus size={15} /></button>
          <span className="min-w-10 text-center text-xs font-semibold text-white/75">{fontSize}px</span>
          <button type="button" onClick={() => setFontSize(value => Math.min(30, value + 1))} className="min-h-11 min-w-11 rounded-md p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label={t('reader.reflowLarger')}><Plus size={15} /></button>
        </div>

        <span className="h-5 w-px bg-white/15" />

        <button
          type="button"
          onClick={() => setLineHeight(value => value >= 1.95 ? 1.45 : +(value + 0.15).toFixed(2))}
          className="rounded-md p-2 text-white/75 hover:bg-white/10 hover:text-white"
          aria-label={t('reader.reflowSpacing')}
          title="Satır Aralığı"
        >
          <AlignJustify size={15} />
        </button>

        <select
          value={fontFamily}
          onChange={e => setFontFamily(e.target.value as typeof fontFamily)}
          className="bg-white/10 border border-white/10 text-white text-xs rounded-md px-2 py-1 outline-none"
        >
          <option value="sans" className="bg-[#141414]">Sans</option>
          <option value="serif" className="bg-[#141414]">Serif</option>
          <option value="mono" className="bg-[#141414]">Mono</option>
          <option value="dyslexic" className="bg-[#141414]">Dyslexic</option>
        </select>

        <select
          value={textAlign}
          onChange={e => setTextAlign(e.target.value as typeof textAlign)}
          className="bg-white/10 border border-white/10 text-white text-xs rounded-md px-2 py-1 outline-none"
        >
          <option value="left" className="bg-[#141414]">Sola Hizala</option>
          <option value="justify" className="bg-[#141414]">İki Yana Yasla</option>
        </select>

        <select
          value={columnWidth}
          onChange={e => setColumnWidth(Number(e.target.value) as typeof columnWidth)}
          className="bg-white/10 border border-white/10 text-white text-xs rounded-md px-2 py-1 outline-none"
        >
          <option value={36} className="bg-[#141414]">Dar Sütun</option>
          <option value={44} className="bg-[#141414]">Orta Sütun</option>
          <option value={56} className="bg-[#141414]">Geniş Sütun</option>
        </select>
      </div>

      <article
        className={`reflow-content mx-auto w-full px-4 pb-20 sm:px-8 ${themeStyle.text}`}
        style={{
          fontFamily: fontFamilies[fontFamily],
          fontSize: fontSize * readerFontScale,
          lineHeight: readerLineHeight || lineHeight,
          textAlign,
          maxWidth: `${readerColumnWidth ? Math.round(readerColumnWidth / 2) : columnWidth}rem`,
          letterSpacing: 0,
          textRendering: 'optimizeLegibility',
        }}
        onPointerUp={captureSelection}
      >
        {isGarbled && (
          <div className="mb-6 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs sm:text-sm leading-relaxed text-amber-200/90 shadow-lg">
            <p className="font-semibold mb-1">⚠️ {t('selection.error')}</p>
            <p>{t('reader.reflowGarbledWarning')}</p>
          </div>
        )}

        {pageData.key !== requestKey ? (
          <p className={`py-24 text-center text-sm ${themeStyle.subtle}`}>{t('common.loading')}</p>
        ) : pageData.blocks.length === 0 ? (
          <div className="mx-auto max-w-md py-24 text-center">
            <p className="text-base font-semibold">{t('reader.reflowNoText')}</p>
            <p className={`mt-2 text-sm ${themeStyle.subtle}`}>{t('reader.reflowNoTextHint')}</p>
          </div>
        ) : pageData.blocks.map((block, index) => {
          if (block.type === 'heading') {
            return <h2 key={index} className="mb-4 mt-8 text-[1.45em] font-bold leading-tight" style={{ color: accent }}>{block.text}</h2>
          }
          if (block.type === 'list') {
            return <p key={index} className="mb-[0.85em] pl-5 [text-indent:-1.1em]">{block.text}</p>
          }
          if (block.type === 'caption') {
            return <p key={index} className={`mb-[1em] text-[0.82em] ${themeStyle.subtle}`}>{block.text}</p>
          }
          return <p key={index} className="mb-[1.05em] [text-wrap:pretty]">{block.text}</p>
        })}
      </article>
    </div>
  )
}
