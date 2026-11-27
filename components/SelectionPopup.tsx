import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Copy,
  GripVertical,
  Highlighter,
  Languages,
  Mic,
  Plus,
  Search,
  StickyNote,
  X,
} from 'lucide-react'
import { LANGUAGE_OPTIONS, useI18n } from './I18nProvider'
import { cleanText } from '@/lib/text'
import { isTouchSelectionSheetViewport } from '@/lib/readerLayout'
import { copyTextToClipboard } from '@/lib/clipboard'
import { fetchWithTimeout } from '@/lib/request'
import type { Annotation, HighlightRect } from './ReaderTypes'

type TDKResult = {
  madde: string
  foundAs: string
  searchedAs: string
  definitions: { anlam: string; tur: string }[]
}

export function firstSelectedWord(text: string) {
  return cleanText(text)
    .trim()
    .split(/\s+/)[0]
    ?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || ''
}

export function formatTDKDefinitions(data: TDKResult[]) {
  const entry = data[0]
  if (!entry?.definitions?.length) return ''

  const header = entry.foundAs !== entry.searchedAs ? `[${entry.madde}]\n` : ''
  return header + entry.definitions
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.tur ? `(${item.tur}) ` : ''}${cleanText(item.anlam)}`)
    .join('\n')
}

type LookupLanguage = 'tr' | 'en' | 'unknown'

const HIGHLIGHT_COLORS = ['#facc15', '#fb7185', '#38bdf8', '#34d399', '#c084fc'] as const

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{children}</p>
}

export function detectLookupLanguage(word: string, selection: string): LookupLanguage {
  const sample = `${word} ${selection}`.toLocaleLowerCase('tr')
  if (/[çğıöşü]/i.test(sample)) return 'tr'
  if (/\b(the|and|with|from|that|this|what|when|where|which|would|could|should|into|about|because|through|their|there|were|been|have|not)\b/i.test(selection)) return 'en'
  if (/\b(ve|ile|bir|bu|şu|için|gibi|daha|çok|olan|olarak|ama|çünkü|de|da)\b/i.test(sample)) return 'tr'
  if (/^[a-z]+$/.test(word) && /(ing|ed|ly|tion|ment|ness|able|ible|ous|ive|al|er|est|s)$/.test(word.toLowerCase())) return 'en'
  return 'unknown'
}

export function SparklesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M19 14l.8 2.6L22 17.5l-2.2.9L19 21l-.8-2.6-2.2-.9 2.2-.9L19 14z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

export function SelectionPopup({
  x,
  y,
  selectedText,
  selectedRects,
  bookId,
  currentPage,
  cfi,
  onClose,
  onAnnotationSaved,
  onToast,
  onCollectSource,
  isEncrypted = false,
  onSaveAnnotation,
  onSaveWord,
}: {
  x: number
  y: number
  selectedText: string
  selectedRects: HighlightRect[]
  bookId: number
  currentPage: number | string
  cfi?: string
  onClose: () => void
  onAnnotationSaved: (ann: Annotation) => void
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void
  onCollectSource?: (source: { page: number; text: string; rects: HighlightRect[] }) => void
  isEncrypted?: boolean
  onSaveAnnotation?: (input: Pick<Annotation, 'type' | 'content' | 'page'>) => Promise<Annotation>
  onSaveWord?: (input: { word: string; definition: string; context: string; source_page: number }) => Promise<void>
}) {
  const { t, language } = useI18n()
  const defaultTargetLang = LANGUAGE_OPTIONS.find(item => item.code === language)?.deepl || 'TR'
  const cleanSelection = cleanText(selectedText)
  const [mode, setMode] = useState<'quick' | 'highlight' | 'translate' | 'define' | 'note'>('quick')
  const [result, setResult] = useState('')
  const [note, setNote] = useState('')
  const [draftExcerpt, setDraftExcerpt] = useState(cleanSelection)
  const [draftWord, setDraftWord] = useState(() => firstSelectedWord(cleanSelection))
  const [draftDefinition, setDraftDefinition] = useState('')
  const [loading, setLoading] = useState(false)
  const [targetLang, setTargetLang] = useState(defaultTargetLang)
  const [highlightColor, setHighlightColor] = useState('#facc15')
  const [colorsOpen, setColorsOpen] = useState(false)
  const [sttListening, setSttListening] = useState(false)
  const [sttSupported, setSttSupported] = useState(
    typeof window !== 'undefined' && (!!(window as unknown as Record<string, unknown>).webkitSpeechRecognition || !!(window as unknown as Record<string, unknown>).SpeechRecognition)
  )
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const previousActiveRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const manuallyPositionedRef = useRef(false)
  const [compactSheet, setCompactSheet] = useState(() => (
    typeof window !== 'undefined' && isTouchSelectionSheetViewport(window.innerWidth, navigator.maxTouchPoints || 0, window.innerHeight)
  ))

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const fieldInputClass = 'w-full rounded-xl px-3 py-2 text-sm text-white outline-none liquid-glass-input transition-all duration-200'

  function clampPosition(nextX: number, nextY: number, measuredHeight?: number) {
    const width = typeof window !== 'undefined' ? window.innerWidth : 900
    const height = typeof window !== 'undefined' ? window.innerHeight : 700
    const popupWidth = mode === 'quick' ? Math.min(608, width - 24) : Math.min(320, width - 24)
    const popupHeight = measuredHeight || (mode === 'quick' ? 50 : compactSheet ? height * 0.58 : 420)
    const margin = 12
    return {
      left: Math.max(margin, Math.min(nextX, width - popupWidth - margin)),
      top: Math.max(margin, Math.min(nextY, height - popupHeight - margin)),
    }
  }

  const [position, setPosition] = useState(() => clampPosition(x, y))

  useEffect(() => {
    if (manuallyPositionedRef.current) return
    const id = setTimeout(() => setPosition(clampPosition(x, y)), 0)
    return () => clearTimeout(id)
  }, [x, y])

  useEffect(() => {
    previousActiveRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTimer = window.setTimeout(() => popupRef.current?.focus(), 0)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      previousActiveRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    if (compactSheet || !popupRef.current) return
    const measure = () => {
      const rect = popupRef.current?.getBoundingClientRect()
      if (!rect) return
      setPosition(current => clampPosition(current.left, current.top, rect.height))
    }
    const timer = window.setTimeout(measure, 0)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(popupRef.current)
    return () => {
      window.clearTimeout(timer)
      observer?.disconnect()
    }
  }, [compactSheet, mode, result, note, colorsOpen, loading])

  useEffect(() => {
    function updateSheetMode() {
      setCompactSheet(isTouchSelectionSheetViewport(window.innerWidth, navigator.maxTouchPoints || 0, window.innerHeight))
    }
    updateSheetMode()
    window.addEventListener('resize', updateSheetMode)
    window.visualViewport?.addEventListener('resize', updateSheetMode)
    return () => {
      window.removeEventListener('resize', updateSheetMode)
      window.visualViewport?.removeEventListener('resize', updateSheetMode)
    }
  }, [])

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      if (!dragRef.current) return
      setPosition(clampPosition(event.clientX - dragRef.current.dx, event.clientY - dragRef.current.dy))
    }

    function handleUp() {
      dragRef.current = null
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [])

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a')) return
    manuallyPositionedRef.current = true
    dragRef.current = { dx: event.clientX - position.left, dy: event.clientY - position.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const startStt = () => {
    const SpeechRecognition = (window as unknown as Record<string, unknown>).webkitSpeechRecognition || (window as unknown as Record<string, unknown>).SpeechRecognition
    if (!SpeechRecognition) {
      setSttSupported(false)
      return
    }
    const recognition = new (SpeechRecognition as new () => unknown)() as {
      continuous: boolean
      interimResults: boolean
      lang: string
      onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null
      onend: (() => void) | null
      onerror: ((event: { error: string }) => void) | null
      start: () => void
      stop: () => void
    }
    recognition.continuous = true
    recognition.interimResults = false
    const sttLangMap: Record<string, string> = { tr: 'tr-TR', en: 'en-US', de: 'de-DE' }
    recognition.lang = sttLangMap[language] || 'en-US'

    recognition.onresult = (event: { results: SpeechRecognitionResultList }) => {
      const last = event.results[event.results.length - 1]
      if (last.isFinal) {
        setNote(prev => prev + ' ' + last[0].transcript)
      }
    }

    recognition.onend = () => {
      setSttListening(false)
    }

    recognition.onerror = () => {
      setSttListening(false)
    }

    recognition.start()
    setSttListening(true)
    ;(window as unknown as Record<string, unknown>).__sttRecognition = recognition
  }

  const stopStt = () => {
    const recognition = (window as unknown as Record<string, unknown>).__sttRecognition as { stop: () => void } | undefined
    if (recognition) {
      recognition.stop()
    }
    setSttListening(false)
  }

  async function lookupTDKDefinition(word: string) {
    const tdkRes = await fetchWithTimeout(`/api/tdk?q=${encodeURIComponent(word)}`, {}, 10000)
    if (tdkRes.ok) {
      const tdkData = await tdkRes.json() as TDKResult[]
      const tdkDefinition = Array.isArray(tdkData) ? formatTDKDefinitions(tdkData) : ''
      if (tdkDefinition) return tdkDefinition
    }
    return ''
  }

  async function lookupEnglishDefinition(word: string) {
    const dictRes = await fetchWithTimeout(`/api/dictionary?word=${encodeURIComponent(word)}`, {}, 10000)
    if (!dictRes.ok) return ''

    const data = await dictRes.json()
    return data.meanings
      ? cleanText(data.meanings.map((m: { partOfSpeech: string; definitions: { definition: string }[] }) => `[${m.partOfSpeech}] ${m.definitions[0]?.definition}`).join('\n'))
      : ''
  }

  async function lookupDefinition(word: string) {
    const language = detectLookupLanguage(word, cleanSelection)
    const lookups = language === 'en'
      ? [lookupEnglishDefinition, lookupTDKDefinition]
      : [lookupTDKDefinition, lookupEnglishDefinition]

    for (const lookup of lookups) {
      const definition = await lookup(word)
      if (definition) return definition
    }
    return ''
  }

  async function translate() {
    setMode('translate')
    if (isEncrypted) {
      setResult('Şifreli kitaptan seçilen metin, gizliliğin için çevrim içi çeviri hizmetine gönderilmez.')
      onToast('Şifreli kitaplarda çevrim içi çeviri kapalıdır.', 'info')
      return
    }
    setLoading(true)
    setResult('')
    try {
      const res = await fetchWithTimeout('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanSelection, target_lang: targetLang }),
      })
      if (!res.ok) throw new Error('Translation failed')
      const data = await res.json()
      const translation = cleanText(data.translation || data.error || t('selection.error'))
      setResult(translation)
      setDraftWord(cleanSelection)
      setDraftDefinition(translation === t('selection.error') ? '' : translation)
    } catch {
      setResult(t('selection.error'))
      onToast('Çeviri alınamadı. Tekrar dene.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function define() {
    setMode('define')
    if (isEncrypted) {
      setResult('Şifreli kitaptan seçilen kelime, gizliliğin için çevrim içi sözlük hizmetine gönderilmez.')
      onToast('Şifreli kitaplarda çevrim içi sözlük kapalıdır.', 'info')
      return
    }
    setLoading(true)
    setResult('')
    const word = firstSelectedWord(cleanSelection)
    setDraftWord(word)
    try {
      const definition = word ? await lookupDefinition(word) : ''
      const resolved = definition || t('selection.notFound')
      setResult(resolved)
      setDraftDefinition(resolved === t('selection.notFound') ? '' : resolved)
    } catch {
      setResult(t('selection.error'))
      onToast('Sözlük sonucu alınamadı. Tekrar dene.', 'error')
    } finally {
      setLoading(false)
    }
  }

  function openHighlightSave() {
    setDraftExcerpt(cleanSelection)
    setMode('highlight')
  }

  function searchWeb() {
    const query = cleanText(draftExcerpt || cleanSelection).trim()
    if (!query) return
    window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener,noreferrer')
  }

  async function highlight() {
    const excerpt = cleanText(draftExcerpt)
    if (!excerpt) return
    setLoading(true)
    try {
      const input = { type: 'highlight', content: { text: excerpt, color: highlightColor, rects: selectedRects, cfi }, page: Number(currentPage) } as const
      const annotation = onSaveAnnotation
        ? await onSaveAnnotation(input)
        : await fetchWithTimeout('/api/annotations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_id: bookId, ...input }),
          }).then(async response => {
            if (!response.ok) throw new Error('Highlight save failed')
            return response.json()
          })
      onAnnotationSaved(annotation)
      onToast(t('selection.highlightSaved'))
      onClose()
    } catch {
      onToast('Vurgu kaydedilemedi. Tekrar dene.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function saveWord() {
    const word = cleanText(draftWord)
    const definition = cleanText(draftDefinition)
    const context = cleanText(draftExcerpt || cleanSelection)
    if (!word) return
    setLoading(true)
    try {
      if (onSaveWord) {
        await onSaveWord({ word, definition, context, source_page: Number(currentPage) })
      } else {
        const response = await fetchWithTimeout('/api/words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, definition, context, source_book_id: bookId, source_page: currentPage }),
        })
        if (!response.ok) throw new Error('Word save failed')
      }
      onToast(t('selection.wordSaved', { word }))
      onClose()
    } catch {
      onToast('Kelime kaydedilemedi. Tekrar dene.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function saveNote() {
    const excerpt = cleanText(draftExcerpt || cleanSelection)
    if (!excerpt) return
    const input = { type: 'note', content: { text: excerpt, note: cleanText(note), rects: selectedRects, cfi }, page: Number(currentPage) } as const
    setLoading(true)
    try {
      const annotation = onSaveAnnotation
        ? await onSaveAnnotation(input)
        : await fetchWithTimeout('/api/annotations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_id: bookId, ...input }),
          }).then(async response => {
            if (!response.ok) throw new Error('Note save failed')
            return response.json()
          })
      onAnnotationSaved(annotation)
      onToast(t('selection.noteSaved'))
      onClose()
    } catch {
      onToast('Not kaydedilemedi. Tekrar dene.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function saveTranslation() {
    const word = cleanText(draftWord || cleanSelection)
    const definition = cleanText(draftDefinition || result)
    if (!word || !definition || definition === t('selection.error')) return
    const context = cleanText(draftExcerpt || cleanSelection)
    setLoading(true)
    try {
      if (onSaveWord) {
        await onSaveWord({ word, definition, context, source_page: Number(currentPage) })
      } else {
        const response = await fetchWithTimeout('/api/words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, definition, context, source_book_id: bookId, source_page: currentPage }),
        })
        if (!response.ok) throw new Error('Translation save failed')
      }
      onToast(t('selection.translationSaved'))
      onClose()
    } catch {
      onToast('Çeviri kaydedilemedi. Tekrar dene.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function copySelection() {
    const copied = await copyTextToClipboard(cleanSelection)
    onToast(copied ? t('selection.copied') : 'Panoya kopyalanamadı.', copied ? 'info' : 'error')
  }

  if (typeof document === 'undefined') return null

  const quickShellClass = 'selection-popover fixed z-[10050] w-[min(38rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-white/12 bg-slate-950/72 p-1.5 text-slate-100 shadow-[0_12px_35px_rgba(0,0,0,0.32)] backdrop-blur-xl transition-[box-shadow,border-color] duration-200'
  const expandedShellClass = compactSheet
    ? 'selection-popover fixed inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[10050] max-h-[min(58dvh,28rem)] overflow-hidden rounded-2xl border border-white/10 text-slate-100 liquid-glass-panel transition-[box-shadow,transform] duration-300 ease-out'
    : 'selection-popover fixed z-[10050] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 text-slate-100 liquid-glass-panel transition-[box-shadow,transform] duration-300 ease-out'

  const colorSwatches = (
    <div className={`flex shrink-0 items-center gap-0.5 overflow-hidden transition-all duration-300 ease-out ${colorsOpen ? 'max-w-[11rem] opacity-100' : 'max-w-0 opacity-0'}`}>
      {HIGHLIGHT_COLORS.map(item => (
        <button
          key={item}
          type="button"
          onClick={() => setHighlightColor(item)}
          title={t('selection.highlightColor')}
          aria-label={t('selection.highlightColor')}
          aria-pressed={highlightColor === item}
          className={`h-6 w-6 shrink-0 rounded-full border transition-all duration-200 active:scale-95 ${highlightColor === item ? 'border-white ring-2 ring-white/40 scale-110' : 'border-white/15 hover:border-white/60'}`}
          style={{ backgroundColor: item }}
        />
      ))}
    </div>
  )

  if (mode === 'quick') {
    const quickActionClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-colors duration-150 active:scale-[0.98]'
    const quickGhostClass = `${quickActionClass} text-slate-200 hover:bg-white/10 hover:text-white`
    const quickPopup = (
      <div
        data-selection-popup="quick"
        ref={popupRef}
        role="dialog"
        aria-label="Seçim araçları"
        tabIndex={-1}
        className={quickShellClass}
        style={{ left: position.left, top: position.top, zIndex: 10050 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap reader-toolbar">
          <div
            className="flex h-9 shrink-0 cursor-grab touch-none items-center rounded-lg bg-white/[0.04] px-0.5 active:cursor-grabbing"
            onPointerDown={startDrag}
            title={t('selection.dragPanel')}
            aria-hidden
          >
            <GripVertical size={14} className="mx-0.5 text-slate-500" />
          </div>
          <button
            type="button"
            onClick={() => setColorsOpen(open => !open)}
            title={t('selection.highlightColor')}
            aria-label={t('selection.highlightColor')}
            aria-expanded={colorsOpen}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 active:scale-95 ${colorsOpen ? 'border-white/40 ring-2 ring-white/25' : 'border-white/15 hover:border-white/50'}`}
            style={{ backgroundColor: highlightColor }}
          />
          {colorSwatches}
          <button
            onClick={openHighlightSave}
            title={t('selection.highlight')}
            aria-label={t('selection.highlight')}
            className={`${quickActionClass} bg-[var(--lib-accent,#e50914)] text-white shadow-[0_0_18px_var(--lib-accent-glow,rgba(229,9,20,0.35))]`}
          >
            <Highlighter size={15} />
            <span>{t('selection.highlight')}</span>
          </button>
          <button onClick={() => { setDraftExcerpt(cleanSelection); setMode('note') }} title={t('selection.note')} aria-label={t('selection.note')} className={quickGhostClass}>
            <StickyNote size={15} />
            <span>{t('selection.note')}</span>
          </button>
          <button onClick={translate} title={t('selection.translate')} aria-label={t('selection.translate')} className={quickGhostClass}>
            <Languages size={15} />
            <span>{t('selection.translate')}</span>
          </button>
          <button onClick={define} title={t('selection.define')} aria-label={t('selection.define')} className={quickGhostClass}>
            <BookOpen size={15} />
            <span>{t('selection.define')}</span>
          </button>
          <button onClick={searchWeb} title={t('selection.webSearch')} aria-label={t('selection.webSearch')} className={quickGhostClass}>
            <Search size={15} />
            <span>{t('selection.webSearch')}</span>
          </button>
          <button onClick={copySelection} title={t('selection.copy')} aria-label={t('selection.copy')} className={quickGhostClass}>
            <Copy size={15} />
            <span>{t('selection.copy')}</span>
          </button>
          <button onClick={onClose} title={t('selection.close')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-95" aria-label={t('selection.close')}>
            <X size={16} />
          </button>
        </div>
      </div>
    )
    return createPortal(quickPopup, document.body)
  }

  const popupShellClass = expandedShellClass

  const popup = (
    <div
      ref={popupRef}
      role="dialog"
      aria-modal="true"
      aria-label="Seçim araçları"
      tabIndex={-1}
      className={popupShellClass}
      style={compactSheet ? { zIndex: 10050 } : { left: position.left, top: position.top, zIndex: 10050 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={`${compactSheet ? 'cursor-default' : 'cursor-move touch-none'} border-b border-white/8 p-2.5 bg-white/[0.02]`} onPointerDown={compactSheet ? undefined : startDrag}>
        <div className="mb-2 flex items-start gap-2">
          <div className="mt-0.5 rounded-lg bg-[var(--lib-accent,#e50914)]/10 p-1.5 text-[var(--lib-accent,#ffb4aa)] transition-all duration-300">
            <SparklesIcon />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-xs leading-relaxed text-slate-200 font-medium">&quot;{cleanSelection.slice(0, 180)}{cleanSelection.length > 180 ? '...' : ''}&quot;</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">{t('selection.pageSelection', { page: currentPage })}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-white transition active:scale-90" aria-label={t('selection.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 backdrop-blur">
          {([
            ['highlight', Highlighter, t('selection.mark')],
            ['note', StickyNote, t('selection.note')],
            ['translate', Languages, t('selection.translate')],
            ['define', BookOpen, t('selection.define')],
          ] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              onClick={() => {
                if (value === 'translate') translate()
                else if (value === 'define') define()
                else if (value === 'highlight') openHighlightSave()
                else {
                  setDraftExcerpt(cleanSelection)
                  setMode(value)
                }
              }}
              style={
                mode === value
                  ? {
                      backgroundColor: 'var(--lib-accent, #e50914)',
                      boxShadow: '0 4px 12px var(--lib-accent-glow, rgba(229, 9, 20, 0.35))',
                    }
                  : undefined
              }
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-200 active:scale-95 ${
                mode === value
                  ? 'text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.03]'
              }`}
            >
              <Icon size={13} className={mode === value ? 'scale-110 transition-transform' : ''} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        {onCollectSource && (
          <button
            type="button"
            onClick={() => {
              onCollectSource({ page: Number(currentPage), text: cleanSelection, rects: selectedRects })
              onClose()
            }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-bold text-slate-100 transition hover:bg-white/[0.1]"
          >
            <Plus size={14} />
            {t('reader.addCollectedSource')}
          </button>
        )}
      </div>

      <div className={`${compactSheet ? 'max-h-[calc(min(58dvh,28rem)-7rem)]' : 'max-h-[18rem]'} overflow-y-auto p-3 scrollbar-thin`}>
        {mode === 'highlight' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{t('selection.editBeforeSave')}</p>
            <div>
              <FieldLabel>{t('selection.excerpt')}</FieldLabel>
              <textarea
                value={draftExcerpt}
                onChange={e => setDraftExcerpt(e.target.value)}
                rows={3}
                className={`${fieldInputClass} resize-y`}
              />
            </div>
            <div>
              <FieldLabel>{t('selection.highlightColor')}</FieldLabel>
              <div className="flex flex-wrap items-center gap-1.5">
                {HIGHLIGHT_COLORS.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setHighlightColor(item)}
                    aria-pressed={highlightColor === item}
                    className={`h-7 w-7 rounded-full border transition-all duration-200 active:scale-95 ${highlightColor === item ? 'border-white ring-2 ring-white/40' : 'border-white/15 hover:border-white/60'}`}
                    style={{ backgroundColor: item }}
                  />
                ))}
              </div>
            </div>
            <button onClick={highlight} disabled={loading} className="w-full rounded-xl liquid-glass-btn-primary px-3 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-50">{loading ? 'Kaydediliyor…' : t('selection.saveHighlight')}</button>
          </div>
        )}

        {mode === 'translate' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <select value={targetLang} onChange={e => setTargetLang(e.target.value as 'TR' | 'EN' | 'DE')} className={`flex-1 rounded-xl px-3 py-2 text-xs text-white outline-none ${fieldInputClass}`}>
                {LANGUAGE_OPTIONS.map(option => <option key={option.deepl} value={option.deepl} className="bg-slate-950">{t(`lang.${option.code}` as Parameters<typeof t>[0])}</option>)}
              </select>
              <button onClick={translate} disabled={loading} className="rounded-xl liquid-glass-btn-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{t('selection.run')}</button>
            </div>
            {loading ? (
              <p className="text-sm text-slate-400 animate-pulse">{t('selection.translating')}</p>
            ) : result ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">{t('selection.editBeforeSave')}</p>
                <div>
                  <FieldLabel>{t('selection.excerpt')}</FieldLabel>
                  <textarea value={draftExcerpt} onChange={e => setDraftExcerpt(e.target.value)} rows={2} className={`${fieldInputClass} resize-y`} />
                </div>
                <div>
                  <FieldLabel>{t('selection.wordLabel')}</FieldLabel>
                  <input value={draftWord} onChange={e => setDraftWord(e.target.value)} className={fieldInputClass} />
                </div>
                <div>
                  <FieldLabel>{t('selection.meaningLabel')}</FieldLabel>
                  <textarea value={draftDefinition} onChange={e => setDraftDefinition(e.target.value)} rows={4} className={`${fieldInputClass} resize-y`} />
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">{t('selection.chooseLanguage')}</p>
            )}
            {result && !loading && (
              <button onClick={saveTranslation} disabled={loading} className="w-full rounded-xl liquid-glass-btn-primary px-3 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-50">{loading ? 'Kaydediliyor…' : t('selection.saveTranslation')}</button>
            )}
          </div>
        )}

        {mode === 'define' && (
          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-slate-400 animate-pulse">{t('selection.lookingUp')}</p>
            ) : (
              <>
                <p className="text-xs text-slate-400">{t('selection.editBeforeSave')}</p>
                <div>
                  <FieldLabel>{t('selection.wordLabel')}</FieldLabel>
                  <input value={draftWord} onChange={e => setDraftWord(e.target.value)} className={fieldInputClass} />
                </div>
                <div>
                  <FieldLabel>{t('selection.meaningLabel')}</FieldLabel>
                  <textarea
                    value={draftDefinition}
                    onChange={e => setDraftDefinition(e.target.value)}
                    placeholder={t('selection.definitionPlaceholder')}
                    rows={4}
                    className={`${fieldInputClass} resize-y`}
                  />
                </div>
                <div>
                  <FieldLabel>{t('selection.excerpt')}</FieldLabel>
                  <textarea value={draftExcerpt} onChange={e => setDraftExcerpt(e.target.value)} rows={2} className={`${fieldInputClass} resize-y`} />
                </div>
              </>
            )}
            <button onClick={saveWord} disabled={loading || !draftWord.trim()} className="w-full rounded-xl liquid-glass-btn-primary px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? 'Kaydediliyor…' : t('selection.saveToWords')}</button>
          </div>
        )}

        {mode === 'note' && (
          <div className="space-y-3">
            <div>
              <FieldLabel>{t('selection.excerpt')}</FieldLabel>
              <textarea
                value={draftExcerpt}
                onChange={e => setDraftExcerpt(e.target.value)}
                rows={2}
                className={`${fieldInputClass} resize-y`}
              />
            </div>
            <div className="relative">
              <FieldLabel>{t('selection.note')}</FieldLabel>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t('selection.notePlaceholder')}
                style={{
                  '--focus-color': 'rgba(139, 92, 246, 0.6)',
                  '--focus-glow': 'rgba(139, 92, 246, 0.35)',
                } as React.CSSProperties}
                className="h-28 w-full resize-none rounded-xl p-3 text-sm text-white outline-none placeholder:text-slate-500 liquid-glass-input transition-all duration-200"
              />
              <button
                type="button"
                onClick={sttListening ? stopStt : startStt}
                disabled={!sttSupported}
                title={sttListening ? t('stt.stop') : sttSupported ? t('stt.start') : t('stt.notSupported')}
                className={`absolute bottom-2.5 right-2.5 rounded-lg p-2 transition active:scale-90 ${
                  sttListening
                    ? 'bg-red-500/80 text-white animate-pulse'
                    : sttSupported
                      ? 'bg-white/[0.06] text-slate-400 hover:bg-white/[0.12] hover:text-white'
                      : 'bg-white/[0.02] text-slate-600 cursor-not-allowed'
                }`}
              >
                <Mic size={16} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[t('selection.important'), t('selection.question'), t('selection.review')].map(item => (
                <button
                  key={item}
                  onClick={() => setNote(prev => prev ? `${prev}\n#${item}` : `#${item}`)}
                  className="rounded-lg px-2 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-95 liquid-glass-btn-secondary"
                >
                  {item}
                </button>
              ))}
            </div>
            <button onClick={saveNote} disabled={loading || !draftExcerpt.trim()} className="w-full rounded-xl liquid-glass-btn-primary px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? 'Kaydediliyor…' : t('selection.saveNote')}</button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(popup, document.body)
}
