'use client'
/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Document, Page } from 'react-pdf'
import { IconButton, THEME_STYLES } from './ReaderUI'
import { SelectionPopup } from './SelectionPopup'
import type { Annotation, ReaderTheme } from './ReaderTypes'
import { THEME_STORAGE } from '@/lib/themePreferences'

export type RsvpAnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'

export type RsvpWordCue = {
  word: string
  kind: 'heading' | 'body'
  blockStart: boolean
  blockEnd: boolean
}

const ANNOTATION_COLORS: Record<RsvpAnnotationColor, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
  orange: '#fb923c',
}

export type RsvpReaderProps = {
  open: boolean
  onClose: () => void
  getWordsForPage: () => string[]
  getCuesForPage?: () => RsvpWordCue[]
  currentPage: number
  numPages: number
  onRequestPage: (p: number) => void
  /** Absolute word index on the first loaded page to start from (0-based). */
  initialWordIndex?: number
  /** Preferred: resolve start from the loaded word list (selection / viewport aware). */
  resolveStartIndex?: (words: string[]) => number
  themeStyle: {
    shell: string
    text: string
    button: string
    active: string
    [key: string]: string | React.ComponentType
  }
  theme: ReaderTheme
  fileUrl?: string
  accent?: string
  t: (k: string) => string
  onStartReadingSession?: () => void
  onStopReadingSession?: () => void
  onSpeakText?: (text: string) => void
  bookTitle?: string
  bookId?: number
  onAnnotationSaved?: (ann: Annotation) => void
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void
  onPositionChange?: (position: { page: number; wordIndex: number }) => void
  onCreateAudioNote?: () => void
}

const FONT_MAP = { S: '2.5rem', M: '3.5rem', L: '4.5rem', XL: '6rem' } as const
type FontKey = keyof typeof FONT_MAP
type FocusStyle = 'off' | 'letter' | 'anchor'
type ModeTab = 'sprint' | 'read' | 'listen' | 'cruise'
type PreviewMode = 'off' | 'page-start' | 'always'
type PreviewBackground = 'theme' | 'white' | 'dark' | 'sepia'
type RsvpThemePreference = 'reader' | ReaderTheme
type PreviewPdfPage = Parameters<NonNullable<React.ComponentProps<typeof Page>['onLoadSuccess']>>[0]

const RSVP_THEME_TOKENS: Record<ReaderTheme, {
  accent: string
  isLight: boolean
  wordColor: string
  wordShadow: string
}> = {
  midnight: { accent: '#e50914', isLight: false, wordColor: '#f8f8f8', wordShadow: '0 2px 5px rgba(0,0,0,0.95), 0 0 20px rgba(0,0,0,0.72)' },
  slate: { accent: '#60a5fa', isLight: false, wordColor: '#f1f5f9', wordShadow: '0 2px 5px rgba(0,0,0,0.95), 0 0 20px rgba(0,0,0,0.72)' },
  paper: { accent: '#2563eb', isLight: true, wordColor: '#0f172a', wordShadow: '0 2px 5px rgba(255,255,255,0.95), 0 0 20px rgba(255,255,255,0.82)' },
  sepia: { accent: '#fbbf24', isLight: false, wordColor: '#f5ead8', wordShadow: '0 2px 5px rgba(0,0,0,0.95), 0 0 20px rgba(0,0,0,0.72)' },
  seoul: { accent: '#4A9B8E', isLight: true, wordColor: '#1C1A17', wordShadow: '0 2px 5px rgba(255,255,255,0.95), 0 0 20px rgba(255,255,255,0.82)' },
}

function orpIndex(word: string): number {
  const L = word.length
  if (L <= 1) return 0
  if (L <= 5) return 1
  if (L <= 9) return 2
  if (L <= 13) return 3
  return 4
}

function loadNum(key: string, min: number, max: number, fallback: number): number {
  try {
    if (typeof window === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const v = Number(raw)
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback
  } catch (e) { return fallback }
}

function loadFontKey(): FontKey {
  try {
    if (typeof window === 'undefined') return 'M'
    const s = localStorage.getItem('rsvp-font')
    if (s === 'S' || s === 'M' || s === 'L' || s === 'XL') return s
  } catch (e) {}
  return 'M'
}

function loadBool(key: string, def = false): boolean {
  try {
    if (typeof window === 'undefined') return def
    const v = localStorage.getItem(key)
    if (v === null) return def
    return v === '1'
  } catch (e) { return def }
}

function loadFocusStyle(): FocusStyle {
  try {
    if (typeof window === 'undefined') return 'letter'
    const s = localStorage.getItem('rsvp-focus-style')
    if (s === 'off' || s === 'letter' || s === 'anchor') return s
  } catch (e) {}
  return 'letter'
}

function loadPreviewMode(): PreviewMode {
  try {
    if (typeof window === 'undefined') return 'off'
    const value = localStorage.getItem('rsvp-page-preview')
    return value === 'page-start' || value === 'always' ? value : 'off'
  } catch { return 'off' }
}

function loadPreviewBackground(): PreviewBackground {
  try {
    if (typeof window === 'undefined') return 'theme'
    const value = localStorage.getItem(THEME_STORAGE.rsvpPreviewBackground)
    return value === 'white' || value === 'dark' || value === 'sepia' ? value : 'theme'
  } catch { return 'theme' }
}

function loadRsvpTheme(): RsvpThemePreference {
  try {
    if (typeof window === 'undefined') return 'reader'
    const value = localStorage.getItem(THEME_STORAGE.rsvp)
    return value === 'midnight' || value === 'slate' || value === 'paper' || value === 'sepia' || value === 'seoul'
      ? value
      : 'reader'
  } catch { return 'reader' }
}

function sentenceBounds(words: string[], idx: number): [number, number] {
  const safe = Math.min(idx, Math.max(words.length - 1, 0))
  let start = safe
  while (start > 0) {
    const prev = words[start - 1] || ''
    const last = prev.slice(-1)
    if (last === '.' || last === '!' || last === '?') break
    start--
  }
  let end = safe
  while (end < words.length - 1) {
    const cur = words[end] || ''
    const last = cur.slice(-1)
    if (last === '.' || last === '!' || last === '?') { end++; break }
    end++
  }
  return [Math.max(0, start), Math.min(end + 1, words.length)]
}

function deferStateUpdate(fn: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(fn, 0)
}

export function RsvpReader(props: RsvpReaderProps) {
  const { open, onClose, getWordsForPage, getCuesForPage, currentPage, numPages, onRequestPage, initialWordIndex = 0, resolveStartIndex, themeStyle: readerThemeStyle, theme: readerTheme, t, fileUrl, onStartReadingSession, onStopReadingSession, onSpeakText, bookTitle, bookId, onAnnotationSaved, onToast, onPositionChange, onCreateAudioNote } = props

  // --- annotation state ---
  const [activeSelection, setActiveSelection] = useState<{ text: string; x: number; y: number } | null>(null)
  const contextRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const [words, setWords] = useState<string[]>([])
  const [wordCues, setWordCues] = useState<RsvpWordCue[]>([])
  const [idx, setIdx] = useState(0)
  const startWordAppliedRef = useRef(false)
  const initialWordIndexRef = useRef(Math.max(0, initialWordIndex))
  const initialPageRef = useRef(currentPage)
  const resolveStartIndexRef = useRef(resolveStartIndex)
  useEffect(() => {
    resolveStartIndexRef.current = resolveStartIndex
  }, [resolveStartIndex])
  const [playing, setPlaying] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [pageTransitioning, setPageTransitioning] = useState(false)
  const [wpm, setWpm] = useState(() => loadNum('rsvp-wpm', 100, 800, 300))
  const [chunk, setChunk] = useState(() => loadNum('rsvp-chunk', 1, 3, 1))
  const [fontSize, setFontSize] = useState<FontKey>(loadFontKey)
  const [showContext, setShowContext] = useState(() => loadBool('rsvp-context', true))
  const [showRamp, setShowRamp] = useState(() => loadBool('rsvp-ramp'))
  const [rewind, setRewind] = useState(() => loadNum('rsvp-rewind', 0, 5, 2))
  const [focusStyle, setFocusStyle] = useState<FocusStyle>(loadFocusStyle)
  const [bionic, setBionic] = useState(() => loadBool('rsvp-bionic'))
  const [showProgress, setShowProgress] = useState(() => loadBool('rsvp-show-progress', true))
  const [showStats, setShowStats] = useState(() => loadBool('rsvp-show-stats', true))
  const [showControls, setShowControls] = useState(() => loadBool('rsvp-show-controls', true))
  const [splitHyphen, setSplitHyphen] = useState(() => loadBool('rsvp-split-hyphen'))
  const [autoresume, setAutoresume] = useState(() => loadBool('rsvp-autoresume', true))
  const [pauseOnPunct, setPauseOnPunct] = useState(() => loadBool('rsvp-pause-on-punct', true))
  const [pauseDur, setPauseDur] = useState(() => loadNum('rsvp-pause-dur', 100, 250, 200))
  const [syllable, setSyllable] = useState(() => loadBool('rsvp-syllable', true))
  const [timingIntensity, setTimingIntensity] = useState(() => loadNum('rsvp-timing-intensity', 0, 100, 100))
  const [showingSettings, setShowingSettings] = useState(false)
  const [showingShortcuts, setShowingShortcuts] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [activeSubPanel, setActiveSubPanel] = useState<'appearance' | 'advanced' | null>(null)
  const [activeMode, setActiveMode] = useState<ModeTab>('sprint')
  const [rsvpThemePreference, setRsvpThemePreference] = useState<RsvpThemePreference>(loadRsvpTheme)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(loadPreviewMode)
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>(loadPreviewBackground)
  const [previewExpiredPage, setPreviewExpiredPage] = useState(0)
  const [previewPageSize, setPreviewPageSize] = useState({ width: 1200, height: 0, ready: false })
  const [previewViewport, setPreviewViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }))

  const rampStart = useRef(0)
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageGuardRef = useRef(0)
  const sessionStartedRef = useRef(false)

  const chunks = useMemo(() => {
    const source = wordCues.length === words.length
      ? wordCues
      : words.map((word, index) => ({ word, kind: 'body' as const, blockStart: index === 0, blockEnd: index === words.length - 1 }))
    const expanded = splitHyphen
      ? source.flatMap(cue => {
          const parts = cue.word.includes('-') ? cue.word.split('-').filter(Boolean) : [cue.word]
          return parts.map((word, index) => ({
            ...cue,
            word,
            blockStart: cue.blockStart && index === 0,
            blockEnd: cue.blockEnd && index === parts.length - 1,
          }))
        })
      : source
    const result: Array<{ words: string[]; heading: boolean; blockStart: boolean; blockEnd: boolean }> = []
    for (let i = 0; i < expanded.length; i += chunk) {
      const group = expanded.slice(i, i + chunk)
      result.push({
        words: group.map(cue => cue.word),
        heading: group.some(cue => cue.kind === 'heading'),
        blockStart: group.some(cue => cue.blockStart),
        blockEnd: group.some(cue => cue.blockEnd),
      })
    }
    return result
  }, [words, wordCues, chunk, splitHyphen])

  const totalChunks = chunks.length
  const safeIdx = open ? Math.min(idx, Math.max(totalChunks - 1, 0)) : 0

  const activeWordStart = Math.min(safeIdx * chunk, Math.max(words.length - 1, 0))
  const contextStart = Math.max(0, activeWordStart - 3)
  const contextEnd = Math.min(words.length, activeWordStart + chunk + 8)

  useEffect(() => {
    if (open) pageGuardRef.current = 0
  }, [open])
  useEffect(() => {
    pageGuardRef.current = 0
    setPreviewPageSize({ width: 1200, height: 0, ready: false })
  }, [currentPage])

  useEffect(() => { try { localStorage.setItem('rsvp-wpm', String(wpm)) } catch (e) {} }, [wpm])
  useEffect(() => { try { localStorage.setItem('rsvp-chunk', String(chunk)) } catch (e) {} }, [chunk])
  useEffect(() => { try { localStorage.setItem('rsvp-font', fontSize) } catch (e) {} }, [fontSize])
  useEffect(() => { try { localStorage.setItem('rsvp-context', showContext ? '1' : '0') } catch (e) {} }, [showContext])
  useEffect(() => { try { localStorage.setItem('rsvp-ramp', showRamp ? '1' : '0') } catch (e) {} }, [showRamp])
  useEffect(() => { try { localStorage.setItem('rsvp-rewind', String(rewind)) } catch (e) {} }, [rewind])
  useEffect(() => { try { localStorage.setItem('rsvp-focus-style', focusStyle) } catch (e) {} }, [focusStyle])
  useEffect(() => { try { localStorage.setItem('rsvp-bionic', bionic ? '1' : '0') } catch (e) {} }, [bionic])
  useEffect(() => { try { localStorage.setItem('rsvp-show-progress', showProgress ? '1' : '0') } catch (e) {} }, [showProgress])
  useEffect(() => { try { localStorage.setItem('rsvp-show-stats', showStats ? '1' : '0') } catch (e) {} }, [showStats])
  useEffect(() => { try { localStorage.setItem('rsvp-show-controls', showControls ? '1' : '0') } catch (e) {} }, [showControls])
  useEffect(() => { try { localStorage.setItem('rsvp-split-hyphen', splitHyphen ? '1' : '0') } catch (e) {} }, [splitHyphen])
  useEffect(() => { try { localStorage.setItem('rsvp-autoresume', autoresume ? '1' : '0') } catch (e) {} }, [autoresume])
  useEffect(() => { try { localStorage.setItem('rsvp-pause-on-punct', pauseOnPunct ? '1' : '0') } catch (e) {} }, [pauseOnPunct])
  useEffect(() => { try { localStorage.setItem('rsvp-pause-dur', String(pauseDur)) } catch (e) {} }, [pauseDur])
  useEffect(() => { try { localStorage.setItem('rsvp-syllable', syllable ? '1' : '0') } catch (e) {} }, [syllable])
  useEffect(() => { try { localStorage.setItem('rsvp-timing-intensity', String(timingIntensity)) } catch (e) {} }, [timingIntensity])
  useEffect(() => { try { localStorage.setItem('rsvp-page-preview', previewMode) } catch (e) {} }, [previewMode])
  useEffect(() => { try { localStorage.setItem(THEME_STORAGE.rsvpPreviewBackground, previewBackground) } catch (e) {} }, [previewBackground])
  useEffect(() => { try { localStorage.setItem(THEME_STORAGE.rsvp, rsvpThemePreference) } catch (e) {} }, [rsvpThemePreference])

  useEffect(() => {
    const updateViewport = () => setPreviewViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    if (playing && !sessionStartedRef.current && onStartReadingSession) {
      sessionStartedRef.current = true
      onStartReadingSession()
    }
    if (!playing && sessionStartedRef.current && onStopReadingSession) {
      sessionStartedRef.current = false
      onStopReadingSession()
    }
  }, [playing, onStartReadingSession, onStopReadingSession])

  useEffect(() => {
    if (!open || previewMode !== 'page-start') return
    const id = setTimeout(() => setPreviewExpiredPage(currentPage), 2600)
    return () => clearTimeout(id)
  }, [open, currentPage, previewMode, previewBackground, rsvpThemePreference])

  const pagePreviewVisible = open
    && previewMode !== 'off'
    && (showingSettings || previewMode === 'always' || previewExpiredPage !== currentPage)

  const previewSectionIndex = words.length > 0
    ? Math.min(2, Math.floor((activeWordStart / words.length) * 3))
    : 0

  const previewSectionText = useMemo(() => {
    const start = Math.floor((words.length * previewSectionIndex) / 3)
    const end = previewSectionIndex === 2
      ? words.length
      : Math.floor((words.length * (previewSectionIndex + 1)) / 3)
    return words.slice(start, Math.max(start + 1, end)).join(' ')
  }, [previewSectionIndex, words])

  const handlePreviewPageLoad = useCallback((page: PreviewPdfPage) => {
    if (page.pageNumber !== currentPage) return
    const pageWidth = page.view[2] - page.view[0]
    const scale = 1200 / pageWidth
    const viewport = page.getViewport({ scale })
    setPreviewPageSize({ width: viewport.width, height: viewport.height, ready: true })
  }, [currentPage])

  const previewTransform = useMemo(() => {
    if (!previewPageSize.ready || previewPageSize.height <= 0) return { x: 0, y: 0, scale: 1 }
    const sectionHeight = previewPageSize.height / 3
    const scale = Math.max(
      previewViewport.width / previewPageSize.width,
      previewViewport.height / sectionHeight,
    )
    const sectionCenterY = sectionHeight * (previewSectionIndex + 0.5)
    return {
      x: (previewViewport.width - previewPageSize.width * scale) / 2,
      y: previewViewport.height / 2 - sectionCenterY * scale,
      scale,
    }
  }, [previewPageSize, previewSectionIndex, previewViewport])

  const advancePage = useCallback(() => {
    if (pageGuardRef.current === currentPage) return
    pageGuardRef.current = currentPage
    if (currentPage < numPages) onRequestPage(currentPage + 1)
  }, [currentPage, numPages, onRequestPage])

  useEffect(() => {
    initialWordIndexRef.current = Math.max(0, initialWordIndex)
  }, [initialWordIndex])

  useEffect(() => {
    if (open) return
    const id = deferStateUpdate(() => {
      setPlaying(false)
      setIdx(0)
      setWords([])
      setWordCues([])
      setEmpty(false)
      setPageTransitioning(false)
      setCountdown(null)
      setShowingSettings(false)
      setShowingShortcuts(false)
      pageGuardRef.current = 0
      setActiveSubPanel(null)
      sessionStartedRef.current = false
      startWordAppliedRef.current = false
    })
    return () => clearTimeout(id)
  }, [open])

  // Document-level selection listener for both desktop and mobile viewports
  useEffect(() => {
    if (!open || playing) {
      setActiveSelection(null)
      return
    }
    let timer: NodeJS.Timeout | null = null

    function handleSelectionChange() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) {
          setActiveSelection(null)
          return
        }
        const text = sel.toString().trim()
        if (!text) {
          setActiveSelection(null)
          return
        }
        if (contextRef.current && !contextRef.current.contains(sel.anchorNode)) {
          setActiveSelection(null)
          return
        }

        try {
          const range = sel.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          if (rect) {
            const isTouch = navigator.maxTouchPoints > 0 || window.innerWidth < 768
            if (isTouch) {
              // Position it nicely in the bottom sheet area on mobile viewports
              setActiveSelection({
                text,
                x: 12,
                y: Math.max(12, window.innerHeight - 380)
              })
            } else {
              // Directly under selection on desktop viewports
              setActiveSelection({
                text,
                x: rect.left,
                y: rect.bottom + 10
              })
            }
          }
        } catch (e) {
          setActiveSelection({
            text,
            x: window.innerWidth / 2 - 150,
            y: window.innerHeight / 2 - 100
          })
        }
      }, 700)
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [open, playing])

  useEffect(() => {
    if (!open) return
    let cancelled = false; let tries = 0
    const resetEmptyId = deferStateUpdate(() => {
      if (!cancelled) setEmpty(false)
    })
    if (!startWordAppliedRef.current) {
      initialPageRef.current = currentPage
    }
    const applyStartIndex = (loadedWords: string[]) => {
      if (startWordAppliedRef.current || currentPage !== initialPageRef.current) return 0
      startWordAppliedRef.current = true
      if (loadedWords.length === 0) return 0
      const resolved = resolveStartIndexRef.current?.(loadedWords)
      const wordIdx = Math.min(
        typeof resolved === 'number' ? Math.max(0, resolved) : initialWordIndexRef.current,
        loadedWords.length - 1,
      )
      return Math.floor(wordIdx / Math.max(1, chunk))
    }
    const tryLoad = () => {
      if (cancelled) return
      try {
        const cues = getCuesForPage?.()
        if (Array.isArray(cues) && cues.length > 0) {
          const loaded = cues.map(cue => cue.word)
          setWordCues(cues)
          setWords(loaded)
          setIdx(applyStartIndex(loaded))
          setPageTransitioning(false)
          return
        }
        const w = getWordsForPage()
        if (Array.isArray(w) && w.length > 0) {
          setWordCues([])
          setWords(w)
          setIdx(applyStartIndex(w))
          setPageTransitioning(false)
          return
        }
      } catch (e) {}
      tries += 1
      if (tries >= 10) { setWordCues([]); setWords([]); setEmpty(true); setPageTransitioning(false); return }
      setTimeout(tryLoad, 150)
    }
    tryLoad()
    return () => { cancelled = true; clearTimeout(resetEmptyId) }
  }, [open, currentPage, getWordsForPage, getCuesForPage])

  useEffect(() => {
    if (!open || words.length === 0 || empty) return
    if (showRamp) rampStart.current = Date.now()
    setCountdown(null)
    setPlaying(true)
  }, [open, words.length, empty, showRamp])

  // Empty covers and image-only pages must not stop the reading flow.
  useEffect(() => {
    if (!open || !empty) return

    const id = setTimeout(() => {
      if (currentPage < numPages) {
        setPageTransitioning(true)
        advancePage()
      } else {
        setPlaying(false)
      }
    }, 800)

    return () => clearTimeout(id)
  }, [open, empty, currentPage, numPages, advancePage])

  useEffect(() => {
    if (!playing || empty || countdown !== null || pageTransitioning) return
    if (totalChunks === 0 || idx >= totalChunks) {
      const id = deferStateUpdate(() => setPlaying(false))
      return () => clearTimeout(id)
    }
    let effectiveWpm = wpm
    if (showRamp && rampStart.current > 0) {
      const elapsed = (Date.now() - rampStart.current) / 1000
      if (elapsed < 3) effectiveWpm = wpm * (0.6 + (elapsed / 3) * 0.4)
    }
    const frame = chunks[idx]
    if (!frame) {
      const id = deferStateUpdate(() => setPlaying(false))
      return () => clearTimeout(id)
    }
    const fullWord = frame.words.join(' ')
    const baseDelay = 60000 / effectiveWpm
    let delay = baseDelay
    if (syllable && fullWord.length > 8) delay *= 1 + Math.min((fullWord.length - 8) * 0.05, 0.7)
    const last = fullWord.slice(-1)
    const basePunctMul = pauseOnPunct ? (pauseDur / 100) : 1
    if (last === '.' || last === '!' || last === '?') delay *= basePunctMul * 2
    else if (last === ',' || last === ';' || last === ':') delay *= basePunctMul * 1.5
    if (fullWord.includes('\n') || fullWord === '') delay *= 2.5
    if (frame.heading) delay *= frame.blockStart ? 1.7 : 1.45
    else if (frame.blockStart) delay *= 1.14
    if (frame.blockEnd) delay *= frame.heading ? 1.55 : 1.12
    if (timingIntensity < 100) {
      const intensity = timingIntensity / 100
      delay = baseDelay + (delay - baseDelay) * intensity
    }
    const delayCap = frame.heading ? Math.min(1800, baseDelay * 4.5) : Math.min(1100, baseDelay * 2.75)
    delay = Math.min(delay, delayCap)
    tickRef.current = setTimeout(() => {
      const nextIdx = idx + 1
      if (nextIdx >= totalChunks) {
        if (currentPage < numPages) {
          setPageTransitioning(true)
          advancePage()
        } else {
          setPlaying(false)
        }
        return
      }
      setIdx(nextIdx)
    }, delay)
    return () => { if (tickRef.current) clearTimeout(tickRef.current) }
  }, [playing, idx, chunks, totalChunks, wpm, empty, countdown, pageTransitioning, showRamp, advancePage, pauseOnPunct, pauseDur, syllable, timingIntensity, currentPage, numPages])

  useEffect(() => {
    if (!open) return
    const onBlur = () => { if (playing) setPlaying(false) }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [open, playing])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
        || target.closest('[role="dialog"]') !== dialogRef.current
      )) return
      e.stopPropagation()
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); if (!autoresume) setPlaying(false); setIdx(v => Math.min(v + 1, totalChunks)) }
      else if (e.key === 'ArrowLeft' && !e.shiftKey) { e.preventDefault(); if (!autoresume) setPlaying(false); setIdx(v => Math.max(v - 1, 0)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setWpm(v => Math.min(v + 25, 800)) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setWpm(v => Math.max(v - 25, 100)) }
      else if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); setPlaying(false); const [, end] = sentenceBounds(words, idx); setIdx(Math.min(end, totalChunks)) }
      else if (e.key === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); setPlaying(false); const [start] = sentenceBounds(words, idx); setIdx(Math.max(start - 1, 0)) }
      else if (e.key === 'Escape') { e.preventDefault(); if (activeSubPanel) setActiveSubPanel(null); else if (showingSettings) setShowingSettings(false); else if (showingShortcuts) setShowingShortcuts(false); else onClose() }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); onClose() }
      else if (e.key === '?' || e.key === 'h') { e.preventDefault(); setShowingShortcuts(v => !v) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, words, idx, totalChunks, showingSettings, showingShortcuts, onClose, autoresume])

  useEffect(() => {
    if (!open) return
    onPositionChange?.({ page: currentPage, wordIndex: Math.max(0, idx * chunk) })
  }, [chunk, currentPage, idx, onPositionChange, open])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    return () => { if (tickRef.current) clearTimeout(tickRef.current) }
  }, [])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  function handleModeTab(tab: ModeTab) {
    setActiveMode(tab)
    if (tab === 'read') onClose()
    else if (tab === 'listen' && onSpeakText) {
      const allText = words.join(' ')
      if (allText) onSpeakText(allText)
    }
  }

  function handlePlayPause() {
    if (!playing && rewind > 0 && idx > 0 && totalChunks > 0) setIdx(v => Math.max(0, v - rewind))
    setPlaying(v => !v)
  }

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (totalChunks === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setIdx(Math.floor(ratio * totalChunks))
    if (autoresume) setPlaying(true)
    else setPlaying(false)
  }

  // --- annotation helpers ---
  function getSelectedRsvpText(): string {
    try {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) return ''
      const text = sel.toString().trim()
      // Only allow selection within the RSVP context area
      if (!text) return ''
      if (contextRef.current && !contextRef.current.contains(sel.anchorNode)) return ''
      return text
    } catch {
      return ''
    }
  }


  function handleHighlightCurrentChunk(event: React.MouseEvent) {
    if (!bookId) return
    const text = (chunks[safeIdx]?.words || ['']).join(' ').trim()
    if (!text) return
    setActiveSelection({
      text,
      x: event.clientX || (typeof window !== 'undefined' ? window.innerWidth / 2 - 192 : 100),
      y: event.clientY || (typeof window !== 'undefined' ? window.innerHeight / 2 - 150 : 100)
    })
  }

  if (!open || typeof document === 'undefined') return null

  const frame = chunks[safeIdx] || { words: [''], heading: false, blockStart: false, blockEnd: false }
  const displayText = frame.words.join(' ')
  const firstWord = frame.words[0] || ''
  const p = focusStyle === 'off' ? 0 : orpIndex(firstWord)
  const left = displayText.slice(0, p)
  const pivot = focusStyle === 'off' ? '' : displayText.slice(p, p + 1)
  const right = displayText.slice(p + 1)
  const showGuides = focusStyle === 'letter' || focusStyle === 'anchor'
  const progress = totalChunks > 0 ? Math.min(idx / totalChunks, 1) : 0
  const resolvedRsvpTheme = rsvpThemePreference === 'reader' ? readerTheme : rsvpThemePreference
  const themeStyle = rsvpThemePreference === 'reader' ? readerThemeStyle : THEME_STYLES[resolvedRsvpTheme]
  const themeTokens = RSVP_THEME_TOKENS[resolvedRsvpTheme]
  const accent = rsvpThemePreference === 'reader' && props.accent ? props.accent : themeTokens.accent
  const shellClass = themeStyle.shell || 'bg-[#050505] text-[#f8f8f8]'
  const headerClass = themeStyle.header || shellClass
  const panelClass = themeStyle.panel || shellClass
  const buttonClass = themeStyle.button || 'border-white/10 bg-white/[0.06] text-[#e5e2e1]'
  const activeClass = themeStyle.active || buttonClass

  const remainingChunks = totalChunks > 0 ? totalChunks - Math.min(idx, totalChunks) : 0
  const remainingSecs = remainingChunks > 0 ? (remainingChunks * (60000 / Math.max(wpm, 100)) / 1000) : 0
  const minutes = Math.floor(remainingSecs / 60)
  const seconds = Math.floor(remainingSecs % 60)

  const maxHalfLen = Math.max(1, left.length, right.length)
  const wordScaleStyle = {
    '--rsvp-fs-val': `var(--rsvp-fs-${fontSize.toLowerCase()})`,
    '--max-half-len': maxHalfLen,
    fontSize: 'min(var(--rsvp-fs-val), calc((100vw - 1.5rem) / (var(--max-half-len) * 2 * 0.62)))'
  } as React.CSSProperties
  const controlsOpacity = { opacity: showingSettings ? 0.3 : 1, transition: 'opacity 0.2s' }
  const fontBaseStyle = { fontFamily: "'ui-monospace', 'SFMono-Regular', Menlo, monospace" }
  const settingsPanelBg = { background: themeTokens.isLight ? 'rgba(248,250,252,0.82)' : 'rgba(0,0,0,0.86)', backdropFilter: 'blur(14px)' }
  const settingsOverlayStyle = { ...settingsPanelBg, zIndex: 10000, paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }
  const wheelContainerStyle = { maxWidth: 760, paddingLeft: 16, paddingRight: 16 }
  const progressBarBg = { height: 4, background: 'rgba(127,127,127,0.25)', borderRadius: 4, overflow: 'hidden' as const, cursor: 'pointer' }
  const progressFillStyle = { width: `${progress * 100}%`, height: '100%', background: accent, transition: 'width 0.15s ease' }
  const infoRowStyle = { fontSize: '0.8rem', opacity: 0.7 }
  const wordOpacityStyle = { opacity: 1, color: themeTokens.wordColor, textShadow: themeTokens.wordShadow }
  const pivotStyle = { color: focusStyle === 'off' ? themeTokens.wordColor : accent, textAlign: 'center' as const }
  const guideLineTopStyle = { left: '50%', bottom: '115%', width: 2, height: '1.2rem', background: accent, opacity: 0.65, transform: 'translateX(-50%)' }
  const guideLineBottomStyle = { left: '50%', top: '115%', width: 2, height: '1.2rem', background: accent, opacity: 0.65, transform: 'translateX(-50%)' }
  const modeTabBase = 'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all'
  const resolvedPreviewBackground = previewBackground === 'theme'
    ? resolvedRsvpTheme === 'sepia' ? 'sepia' : themeTokens.isLight ? 'white' : 'dark'
    : previewBackground
  const previewPalette = {
    white: { background: '#f8fafc', text: '#0f172a', filter: 'grayscale(0.2) brightness(0.82) contrast(0.88)', wash: 'rgba(248,250,252,0.3)' },
    dark: { background: '#050505', text: '#f8fafc', filter: 'invert(0.9) hue-rotate(180deg) grayscale(0.15) brightness(0.52) contrast(0.88)', wash: 'rgba(0,0,0,0.42)' },
    sepia: { background: '#d8c39f', text: '#392f24', filter: 'sepia(1) saturate(0.58) brightness(0.68) contrast(0.84)', wash: 'rgba(83,58,30,0.32)' },
  }[resolvedPreviewBackground]

  function renderBionicText(text: string) {
    if (!bionic) return text
    const mid = Math.ceil(text.length * 0.5)
    return <><strong className='font-black'>{text.slice(0, mid)}</strong>{text.slice(mid)}</>
  }

  function rsvpThemeLabel(item: RsvpThemePreference) {
    if (item === 'reader') return t('reader.rsvpThemeFollowReader')
    if (item === 'midnight') return t('reader.theme.dark')
    if (item === 'slate') return t('reader.theme.slate')
    if (item === 'paper') return t('reader.theme.light')
    if (item === 'sepia') return t('reader.theme.sepia')
    return THEME_STYLES[item].label
  }

  function chooseRsvpTheme(item: RsvpThemePreference) {
    setRsvpThemePreference(item)
    if (previewBackground === 'theme') setPreviewExpiredPage(0)
  }

  function choosePreviewBackground(background: PreviewBackground) {
    setPreviewBackground(background)
    setPreviewExpiredPage(0)
  }

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('reader.rsvpToggle')}
      tabIndex={-1}
      data-rsvp-theme={resolvedRsvpTheme}
      className={`fixed inset-0 z-[9999] isolate flex flex-col items-center justify-between overflow-hidden pointer-events-auto ${shellClass}`}
      style={{ zIndex: 9999 }}
    >
      {(fileUrl || words.length > 0) && (
        <div
          className='pointer-events-none absolute inset-0 z-0 overflow-hidden transition-opacity duration-150'
          style={{ background: previewPalette.background, opacity: pagePreviewVisible ? 1 : 0 }}
          data-rsvp-preview-source={previewPageSize.ready ? 'pdf' : 'text'}
          data-rsvp-preview-section={previewSectionIndex + 1}
          data-rsvp-preview-background={resolvedPreviewBackground}
          aria-hidden='true'
        >
          <div className='absolute inset-0' style={{ filter: previewPalette.filter, opacity: 0.5 }}>
            {fileUrl && (
              <Document file={fileUrl} loading={null} error={null} onLoadError={() => setPreviewPageSize(previous => ({ ...previous, ready: false }))}>
                <div
                  className='rsvp-page-preview-stage'
                  style={{
                    opacity: previewPageSize.ready ? 1 : 0,
                    transform: `translate3d(${previewTransform.x}px, ${previewTransform.y}px, 0) scale(${previewTransform.scale})`,
                  }}
                >
                  <Page
                    className='rsvp-page-preview'
                    pageNumber={currentPage}
                    width={Math.min(1200, Math.round(previewViewport.width * 1.5))}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    loading={null}
                    onLoadSuccess={handlePreviewPageLoad}
                  />
                </div>
              </Document>
            )}
          </div>
          <div className='absolute inset-0 z-[1]' style={{ background: previewPalette.wash }} />
          {!previewPageSize.ready && (
            <div key={previewSectionIndex} className='absolute inset-0 z-[2] flex items-center justify-center overflow-hidden px-[8vw] py-24 text-center' style={{ color: previewPalette.text }}>
              <p className='max-w-[54rem] text-[clamp(1.5rem,4vw,4rem)] font-semibold leading-relaxed opacity-20'>{previewSectionText}</p>
            </div>
          )}
        </div>
      )}

      {!showControls && (
        <div className='absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20'>
          <IconButton label={t('reader.rsvpShowControls')} onClick={() => setShowControls(true)} className={buttonClass} large>
            <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M4 6h16M4 12h16M4 18h16'/></svg>
          </IconButton>
        </div>
      )}

      {showControls && <div className={`z-10 flex w-full shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:h-14 sm:flex-nowrap sm:justify-between sm:px-4 sm:py-0 ${headerClass}`}>
        <span className='order-3 min-w-0 basis-full truncate text-center text-xs font-medium opacity-70 sm:order-1 sm:basis-auto sm:text-left sm:text-sm sm:max-w-[40%]'>{bookTitle || ''}</span>
        <span className='order-1 inline-flex min-w-0 flex-1 items-center justify-start gap-2 text-xs opacity-70 sm:order-2 sm:flex-none sm:justify-center'>
          <span>{currentPage} / {numPages}</span>
          <span className='rounded-full border px-2 py-0.5 font-semibold' style={{ borderColor: accent, color: accent }}>RSVP v2</span>
        </span>
        <div className='order-2 ml-auto flex shrink-0 items-center gap-1 sm:order-3 sm:ml-0'>
          <IconButton
            label={previewMode === 'off' ? t('reader.rsvpPreviewShow') : t('reader.rsvpPreviewHide')}
            active={previewMode !== 'off'}
            onClick={() => setPreviewMode(value => value === 'off' ? 'always' : 'off')}
            className={previewMode !== 'off' ? activeClass : buttonClass}
          >
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
              {previewMode !== 'off' ? (
                <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z' />
              ) : (
                <path d='M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22' />
              )}
            </svg>
          </IconButton>
          <IconButton label={t('reader.rsvpSettings')} active={showingSettings} onClick={() => { setShowingSettings(v => !v); setActiveSubPanel(null) }} className={showingSettings ? activeClass : buttonClass}>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><circle cx='12' cy='12' r='3'/><path d='M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42'/></svg>
          </IconButton>
          <IconButton label={t('reader.rsvpHideControls')} onClick={() => setShowControls(false)} className={buttonClass}>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M4 6h16M4 12h16M4 18h16M3 3l18 18'/></svg>
          </IconButton>
          <IconButton label={t('reader.rsvpClose')} onClick={onClose} className={buttonClass} large>
            <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M18 6L6 18M6 6l12 12'/></svg>
          </IconButton>
        </div>
      </div>}

      {countdown !== null && (
        <div className='absolute inset-0 z-20 flex items-center justify-center' style={settingsPanelBg}>
          <span className='text-7xl font-black' style={{ color: accent, animation: 'none' }}>{countdown}</span>
        </div>
      )}

      <div className='relative z-10 flex min-h-0 w-full flex-1 flex-col items-center justify-center px-3 sm:px-6'>
        {empty ? (
          <div className='text-center' style={{ opacity: 0.7, fontSize: '1.1rem' }}>
            {t('reader.rsvpNoText')}
            {currentPage < numPages && <p className='mt-2 text-xs opacity-65'>{t('reader.rsvpSkippingPage')}</p>}
          </div>
        ) : (
          <div className='flex min-w-0 max-w-full flex-col items-center' style={wordOpacityStyle}>
            <div className='relative flex w-full min-w-0 max-w-[calc(100vw-1.5rem)] items-center justify-center overflow-visible text-center' style={{ ...fontBaseStyle, ...wordScaleStyle, fontWeight: 700, lineHeight: 1 }}>
              {showGuides && <div aria-hidden className='absolute' style={guideLineTopStyle} />}
              {showGuides && <div aria-hidden className='absolute' style={guideLineBottomStyle} />}
              {focusStyle === 'off' ? (
                <span className='block max-w-full overflow-hidden text-ellipsis whitespace-nowrap'>{renderBionicText(displayText)}</span>
              ) : (
                <span className='relative inline-block min-w-[0.62em] shrink-0 text-center' style={pivotStyle} data-rsvp-pivot={pivot || undefined}>
                  {pivot}
                  <span className='absolute right-[100%] top-0 whitespace-nowrap text-right' style={{ color: themeTokens.wordColor }}>
                    {bionic ? renderBionicText(left) : left}
                  </span>
                  <span className='absolute left-[100%] top-0 whitespace-nowrap text-left' style={{ color: themeTokens.wordColor }}>
                    {bionic ? renderBionicText(right) : right}
                  </span>
                </span>
              )}
            </div>
            {showContext && words.length > 0 && activeWordStart < words.length && (
              <div
                ref={contextRef}
                className={`mt-6 max-h-[7.5rem] max-w-[min(44rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border px-4 py-2 text-center leading-relaxed shadow-lg ${panelClass}`}
                style={{ fontSize: '0.95rem', userSelect: !playing ? 'text' : 'none', cursor: !playing ? 'text' : 'default' }}
              >
                {words.slice(contextStart, contextEnd).map((w, i) => {
                  const globalIdx = contextStart + i
                  const isActive = globalIdx >= activeWordStart && globalIdx < activeWordStart + chunk
                  const isPast = globalIdx < activeWordStart
                  return (
                    <span key={`${globalIdx}-${w}`} style={{ opacity: isActive ? 1 : isPast ? 0.38 : 0.72, color: isActive ? accent : undefined, fontWeight: isActive ? 700 : 400, transition: 'opacity 0.15s' }}>
                      {w}{' '}
                    </span>
                  )
                })}
              </div>
            )}
            {/* Highlight current chunk button when paused */}
            {!playing && !empty && bookId && onAnnotationSaved && (
              <button
                onClick={handleHighlightCurrentChunk}
                className='mt-3 rounded-full border px-3 py-1 text-xs font-medium transition-all hover:opacity-90 shrink-0'
                style={{ borderColor: accent, color: accent, background: `${accent}18` }}
                title='Highlight current word/sentence'
              >
                ✦ Vurgula
              </button>
            )}
            {!empty && onCreateAudioNote && (
              <button
                type='button'
                onClick={onCreateAudioNote}
                className='mt-2 rounded-full border px-3 py-1 text-xs font-semibold transition-all hover:opacity-90 shrink-0'
                style={{ borderColor: accent, color: accent, background: `${accent}18` }}
              >
                ✎ {t('reader.audioNoteAtPosition')}
              </button>
            )}
          </div>
        )}
      </div>

      {showControls && <div className={`relative z-10 flex w-full shrink-0 flex-col items-center gap-3 border-t pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 ${headerClass}`}>
        {showProgress && (
          <div className='w-full' style={wheelContainerStyle}>
            <div style={progressBarBg} onClick={handleProgressClick}>
              <div style={progressFillStyle} />
            </div>
            {showStats && (
              <div className='flex justify-between mt-1' style={infoRowStyle}>
                <span>{empty || totalChunks === 0 ? '' : `${Math.min(safeIdx + 1, totalChunks)} / ${totalChunks}`}</span>
                <span>{minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`}</span>
              </div>
            )}
          </div>
        )}

        <div className='flex items-center gap-3' style={controlsOpacity}>
          <IconButton label={t('reader.rsvpPrevWord')} onClick={() => { setPlaying(false); setIdx(v => Math.max(v - 1, 0)) }} className={buttonClass} large>
            <svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor'><path d='M11 7l-5 5 5 5V7zm7 0l-5 5 5 5V7z'/></svg>
          </IconButton>
          <IconButton label={playing ? t('reader.rsvpPause') : t('reader.rsvpPlay')} onClick={handlePlayPause} className={playing ? activeClass : buttonClass} active={playing} large>
            {playing
              ? <svg width='22' height='22' viewBox='0 0 24 24' fill='currentColor'><path d='M6 5h4v14H6zM14 5h4v14h-4z'/></svg>
              : <svg width='22' height='22' viewBox='0 0 24 24' fill='currentColor'><path d='M8 5v14l11-7z'/></svg>}
          </IconButton>
          <IconButton label={t('reader.rsvpNextWord')} onClick={() => { setPlaying(false); setIdx(v => Math.min(v + 1, totalChunks)) }} className={buttonClass} large>
            <svg width='20' height='20' viewBox='0 0 24 24' fill='currentColor'><path d='M13 7l5 5-5 5V7zM6 7l5 5-5 5V7z'/></svg>
          </IconButton>
        </div>

        <div className='grid w-full max-w-[760px] grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 px-4 sm:flex sm:flex-nowrap sm:justify-center sm:gap-3' style={{ ...controlsOpacity, fontSize: '0.85rem' }}>
          <button onClick={() => setWpm(v => Math.max(v - 25, 100))} aria-label={t('reader.rsvpSlower')} className={`order-1 rounded-lg border px-3 py-1 ${buttonClass}`}>-</button>
          <div className='order-5 col-span-4 grid grid-cols-4 gap-1.5 sm:order-none sm:flex sm:basis-auto sm:gap-2'>
            {[200, 300, 400, 500].map(p => (
              <button key={p} onClick={() => setWpm(p)} className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${wpm === p ? activeClass : buttonClass}`}>{p}</button>
            ))}
          </div>
          <input type='range' min={100} max={800} step={25} value={wpm} onChange={e => setWpm(Number(e.target.value))} aria-label={t('reader.rsvpSpeed')} className='order-1 min-w-0 sm:order-none sm:w-[150px]' style={{ accentColor: accent }} />
          <button onClick={() => setWpm(v => Math.min(v + 25, 800))} aria-label={t('reader.rsvpFaster')} className={`order-1 rounded-lg border px-3 py-1 ${buttonClass}`}>+</button>
          <span className='order-1 whitespace-nowrap text-right text-xs sm:order-none sm:min-w-16 sm:text-left sm:text-[0.85rem]'>{wpm} {t('reader.rsvpWpm')}</span>
        </div>
      </div>}

      {showingSettings && (
        <div className='absolute inset-0 z-[10000] flex items-end justify-center p-3 sm:items-start sm:pt-12' style={settingsOverlayStyle} onClick={() => { setShowingSettings(false); setActiveSubPanel(null) }}>
          <div className={`w-full max-w-md rounded-2xl border p-4 shadow-2xl max-sm:rounded-b-none sm:p-5 ${panelClass}`} style={{ maxHeight: 'min(85vh, calc(100dvh - 1.5rem))', overflowY: 'auto', WebkitOverflowScrolling: 'touch', pointerEvents: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className='mb-3 flex items-center justify-between gap-3'>
              <p className='text-base font-bold'>{t('reader.rsvpSettings')}</p>
              <span className='shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold' style={{ borderColor: accent, color: accent }}>v2</span>
            </div>

            <div className='mb-4 grid grid-cols-2 gap-1.5 sm:flex'>
              {(['sprint', 'read', 'listen', 'cruise'] as ModeTab[]).map(tab => (
                <button key={tab} onClick={() => handleModeTab(tab)} className={`${modeTabBase} min-w-0 truncate`} style={{ borderColor: activeMode === tab ? accent : 'rgba(127,127,127,0.3)', color: activeMode === tab ? accent : undefined, background: activeMode === tab ? `${accent}18` : undefined }}>
                  {t('reader.rsvpMode' + tab.charAt(0).toUpperCase() + tab.slice(1))}
                </button>
              ))}
            </div>

            <div className='mb-4 p-3 rounded-xl border' style={{ borderColor: 'rgba(127,127,127,0.15)', background: 'rgba(127,127,127,0.05)' }}>
              <p className='text-xs font-semibold opacity-60 mb-2'>{t('reader.rsvpLivePreview')}</p>
              <div className='flex w-full min-w-0 items-center justify-center overflow-visible text-center' style={{ fontFamily: "'ui-monospace', monospace", fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.4 }}>
                {(() => {
                  const pw = 'focus'
                  const pi = focusStyle === 'off' ? 0 : orpIndex(pw)
                  const pl = pw.slice(0, pi)
                  const pp = focusStyle === 'off' ? pw : pw.slice(pi, pi + 1)
                  const pr = pw.slice(pi + 1)
                  return focusStyle === 'off' ? (
                    <span className='block max-w-full overflow-hidden text-ellipsis whitespace-nowrap'>{bionic ? renderBionicText(pw) : pw}</span>
                  ) : (
                    <span className='relative inline-block min-w-[0.62em] shrink-0 text-center' style={{ color: accent }}>
                      {pp}
                      <span className='absolute right-[100%] top-0 whitespace-nowrap text-right' style={{ color: themeTokens.wordColor }}>
                        {bionic ? renderBionicText(pl) : pl}
                      </span>
                      <span className='absolute left-[100%] top-0 whitespace-nowrap text-left' style={{ color: themeTokens.wordColor }}>
                        {bionic ? renderBionicText(pr) : pr}
                      </span>
                    </span>
                  )
                })()}
              </div>
            </div>

            <div className='space-y-4'>
              <div>
                <p className='text-sm font-semibold mb-2 opacity-70'>{t('reader.rsvpPacing')}</p>
                <div className='space-y-3'>
                  <div>
                    <span className='text-xs opacity-50'>{wpm} WPM</span>
                    <input type='range' min={100} max={800} step={25} value={wpm} onChange={e => setWpm(Number(e.target.value))} style={{ accentColor: accent, width: '100%' }} />
                  </div>
                  <div>
                    <span className='text-xs opacity-50'>{t('reader.rsvpChunk')}: {chunk}</span>
                    <input type='range' min={1} max={3} step={1} value={chunk} onChange={e => setChunk(Number(e.target.value))} style={{ accentColor: accent, width: '100%' }} />
                  </div>
                </div>
              </div>

              <div>
                <p className='text-sm font-semibold mb-2 opacity-70'>{t('reader.rsvpFocusStyle')}</p>
                <div className='grid grid-cols-3 gap-2'>
                  {(['off', 'letter', 'anchor'] as FocusStyle[]).map(fs => (
                    <button key={fs} onClick={() => setFocusStyle(fs)} className='min-w-0 truncate rounded-lg border px-2 py-1.5 text-xs font-medium sm:px-3' style={{ borderColor: focusStyle === fs ? accent : 'rgba(127,127,127,0.3)', color: focusStyle === fs ? accent : undefined, background: focusStyle === fs ? `${accent}18` : undefined }}>
                      {t('reader.rsvpFocus' + fs.charAt(0).toUpperCase() + fs.slice(1))}
                    </button>
                  ))}
                </div>
              </div>

              <label className='flex items-center justify-between text-sm'>
                <span>{t('reader.rsvpBionic')}</span>
                <input type='checkbox' checked={bionic} onChange={e => setBionic(e.target.checked)} style={{ accentColor: accent }} />
              </label>

              <label className='flex items-center justify-between text-sm'>
                <span>{t('reader.rsvpContext')}</span>
                <input type='checkbox' checked={showContext} onChange={e => setShowContext(e.target.checked)} style={{ accentColor: accent }} />
              </label>

              <div>
                <p className='text-sm font-semibold mb-2 opacity-70'>{t('reader.rsvpDisplay')}</p>
                <div className='space-y-2'>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpShowProgress')}</span>
                    <input type='checkbox' checked={showProgress} onChange={e => setShowProgress(e.target.checked)} style={{ accentColor: accent }} />
                  </label>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpShowStats')}</span>
                    <input type='checkbox' checked={showStats} onChange={e => setShowStats(e.target.checked)} style={{ accentColor: accent }} />
                  </label>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpShowControls')}</span>
                    <input type='checkbox' checked={showControls} onChange={e => {
                      const visible = e.target.checked
                      setShowControls(visible)
                      if (!visible) {
                        setShowingSettings(false)
                        setActiveSubPanel(null)
                      }
                    }} style={{ accentColor: accent }} />
                  </label>
                </div>
              </div>

              <div className='grid grid-cols-2 gap-2'>
                <button onClick={() => setActiveSubPanel(activeSubPanel === 'appearance' ? null : 'appearance')} className='min-w-0 truncate rounded-lg border px-3 py-1.5 text-xs font-medium' style={{ borderColor: activeSubPanel === 'appearance' ? accent : 'rgba(127,127,127,0.3)', color: activeSubPanel === 'appearance' ? accent : undefined }}>{t('reader.rsvpAppearance')}</button>
                <button onClick={() => setActiveSubPanel(activeSubPanel === 'advanced' ? null : 'advanced')} className='min-w-0 truncate rounded-lg border px-3 py-1.5 text-xs font-medium' style={{ borderColor: activeSubPanel === 'advanced' ? accent : 'rgba(127,127,127,0.3)', color: activeSubPanel === 'advanced' ? accent : undefined }}>{t('reader.rsvpAdvanced')}</button>
              </div>

              {activeSubPanel === 'appearance' && (
                <div className='rounded-xl border p-4 space-y-3' style={{ borderColor: 'rgba(127,127,127,0.15)' }}>
                  <p className='text-xs font-semibold opacity-70'>{t('reader.rsvpAppearance')}</p>
                  <div>
                    <span className='mb-2 block text-sm'>{t('reader.rsvpTheme')}</span>
                    <div className='grid grid-cols-3 gap-1.5'>
                      {(['reader', 'midnight', 'paper', 'sepia', 'seoul'] as RsvpThemePreference[]).map(item => (
                        <button key={item} type='button' onClick={() => chooseRsvpTheme(item)} className='min-w-0 truncate rounded-lg border px-2 py-1.5 text-xs font-medium' style={{ borderColor: rsvpThemePreference === item ? accent : 'rgba(127,127,127,0.3)', color: rsvpThemePreference === item ? accent : undefined, background: rsvpThemePreference === item ? `${accent}18` : undefined }}>
                          {rsvpThemeLabel(item)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpFontSize')}</span>
                    <div className='flex gap-1'>
                      {(['S', 'M', 'L', 'XL'] as FontKey[]).map(f => (
                        <button key={f} onClick={() => setFontSize(f)} className='rounded-md border px-2.5 py-1 text-xs' style={{ borderColor: fontSize === f ? accent : 'rgba(127,127,127,0.3)', color: fontSize === f ? accent : undefined }}>{f}</button>
                      ))}
                    </div>
                  </label>
                  <div className='pt-1'>
                    <span className='mb-2 block text-sm'>{t('reader.rsvpBgPreview')}</span>
                    <div className='grid grid-cols-3 gap-1.5'>
                      {(['off', 'page-start', 'always'] as PreviewMode[]).map(mode => (
                        <button key={mode} type='button' onClick={() => setPreviewMode(mode)} className='min-w-0 rounded-lg border px-2 py-1.5 text-xs font-medium' style={{ borderColor: previewMode === mode ? accent : 'rgba(127,127,127,0.3)', color: previewMode === mode ? accent : undefined, background: previewMode === mode ? `${accent}18` : undefined }}>
                          {t(mode === 'off' ? 'reader.rsvpPreviewOff' : mode === 'page-start' ? 'reader.rsvpPreviewPageStart' : 'reader.rsvpPreviewAlways')}
                        </button>
                      ))}
                    </div>
                    <span className='mb-2 mt-3 block text-sm'>{t('reader.rsvpPreviewBackground')}</span>
                    <div className='grid grid-cols-4 gap-1.5'>
                      {(['theme', 'white', 'dark', 'sepia'] as PreviewBackground[]).map(background => (
                        <button key={background} type='button' onClick={() => choosePreviewBackground(background)} className='min-w-0 rounded-lg border px-1.5 py-1.5 text-xs font-medium' style={{ borderColor: previewBackground === background ? accent : 'rgba(127,127,127,0.3)', color: previewBackground === background ? accent : undefined, background: previewBackground === background ? `${accent}18` : undefined }}>
                          {t(`reader.rsvpPreviewBackground${background.charAt(0).toUpperCase()}${background.slice(1)}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeSubPanel === 'advanced' && (
                <div className='rounded-xl border p-4 space-y-3' style={{ borderColor: 'rgba(127,127,127,0.15)' }}>
                  <p className='text-xs font-semibold opacity-70'>{t('reader.rsvpAdvanced')}</p>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpSplitHyphen')}</span>
                    <input type='checkbox' checked={splitHyphen} onChange={e => setSplitHyphen(e.target.checked)} style={{ accentColor: accent }} />
                  </label>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpAutoResume')}</span>
                    <input type='checkbox' checked={autoresume} onChange={e => setAutoresume(e.target.checked)} style={{ accentColor: accent }} />
                  </label>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpRamp')}</span>
                    <input type='checkbox' checked={showRamp} onChange={e => setShowRamp(e.target.checked)} style={{ accentColor: accent }} />
                  </label>
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpPauseOnPunct')}</span>
                    <input type='checkbox' checked={pauseOnPunct} onChange={e => setPauseOnPunct(e.target.checked)} style={{ accentColor: accent }} />
                  </label>
                  {pauseOnPunct && (
                    <div>
                      <span className='text-xs opacity-50'>{t('reader.rsvpPauseDuration')}: {pauseDur}%</span>
                      <input type='range' min={100} max={250} step={10} value={pauseDur} onChange={e => setPauseDur(Number(e.target.value))} style={{ accentColor: accent, width: '100%' }} />
                    </div>
                  )}
                  <label className='flex items-center justify-between text-sm'>
                    <span>{t('reader.rsvpSyllable')}</span>
                    <input type='checkbox' checked={syllable} onChange={e => setSyllable(e.target.checked)} style={{ accentColor: accent }} />
                  </label>
                  <div>
                    <span className='text-xs opacity-50'>{t('reader.rsvpTimingIntensity')}: {timingIntensity}%</span>
                    <input type='range' min={0} max={100} step={5} value={timingIntensity} onChange={e => setTimingIntensity(Number(e.target.value))} style={{ accentColor: accent, width: '100%' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showingShortcuts && (
        <div className='absolute inset-0 z-[10000] flex items-center justify-center p-3' style={settingsOverlayStyle} onClick={() => setShowingShortcuts(false)}>
          <div className={`w-full max-w-xs rounded-2xl border p-5 shadow-2xl ${panelClass}`} onClick={e => e.stopPropagation()}>
            <p className='text-base font-bold mb-3'>{t('reader.rsvpShortcuts')}</p>
            <div className='space-y-1.5 text-sm'>
              <p><span className='font-mono text-xs border rounded px-1.5 py-0.5' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>Space</span> {t('reader.rsvpPlay')}/{t('reader.rsvpPause')}</p>
              <p><span className='font-mono text-xs border rounded px-1.5 py-0.5' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>←</span><span className='font-mono text-xs border rounded px-1.5 py-0.5 ml-1' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>→</span> {t('reader.rsvpPrevWord')}/{t('reader.rsvpNextWord')}</p>
              <p><span className='font-mono text-xs border rounded px-1.5 py-0.5' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>↑</span><span className='font-mono text-xs border rounded px-1.5 py-0.5 ml-1' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>↓</span> {t('reader.rsvpFaster')}/{t('reader.rsvpSlower')}</p>
              <p><span className='font-mono text-xs border rounded px-1.5 py-0.5' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>⇧←</span><span className='font-mono text-xs border rounded px-1.5 py-0.5 ml-1' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>⇧→</span> {t('reader.rsvpSentencePrev')}/{t('reader.rsvpSentenceNext')}</p>
              <p><span className='font-mono text-xs border rounded px-1.5 py-0.5' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>Esc</span> {t('reader.rsvpClose')}</p>
              <p><span className='font-mono text-xs border rounded px-1.5 py-0.5' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>R</span> {t('reader.rsvpClose')}</p>
              <p><span className='font-mono text-xs border rounded px-1.5 py-0.5' style={{ borderColor: 'rgba(127,127,127,0.3)' }}>?</span> {t('reader.rsvpShortcuts')}</p>
            </div>
          </div>
        </div>
      )}

      {activeSelection && bookId && (
        <SelectionPopup
          x={activeSelection.x}
          y={activeSelection.y}
          selectedText={activeSelection.text}
          selectedRects={[]}
          bookId={bookId}
          currentPage={currentPage}
          onClose={() => {
            setActiveSelection(null)
            window.getSelection()?.removeAllRanges()
          }}
          onAnnotationSaved={(ann) => {
            if (onAnnotationSaved) {
              onAnnotationSaved({
                ...ann,
                content: {
                  ...ann.content,
                  source: 'rsvp',
                }
              })
            }
          }}
          onToast={onToast || (() => {})}
        />
      )}
    </div>
  )

  return createPortal(overlay, document.body)
}
