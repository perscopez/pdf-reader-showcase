'use client'
/* eslint-disable react-hooks/refs, react-hooks/immutability */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Document, Page, pdfjs } from 'react-pdf'
import {
  ArrowLeft,
  ArrowUpRight,
  Archive,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock3,
  Coffee,
  Columns2,
  Landmark,
  Copy,
  Download,
  FileText,
  Eye,
  EyeOff,
  Eraser,
  ExternalLink,
  Highlighter,
  AlignJustify,
  Image as ImageIcon,
  Languages,
  LogOut,
  Maximize2,
  Minus,
  MoreHorizontal,
  Moon,
  Pause,
  PanelRightOpen,
  Pencil,
  RotateCw,
  Sliders,
  Sun,
  Contrast,
  LayoutGrid,
  Play,
  Plus,
  Ruler,
  Save,
  Search,
  SlidersHorizontal,
  StickyNote,
  TabletSmartphone,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  Mic,
  Volume2,
  StopCircle,
  ListOrdered,
} from 'lucide-react'
import LanguageSwitcher from './LanguageSwitcher'
import { LANGUAGE_OPTIONS, useI18n } from './I18nProvider'
import { ToastContainer, useToast } from './Toast'
import BugReportDialog from './BugReportDialog'
import ReadingSessionLabel from './ReadingSessionLabel'
import { cleanText, joinWrappedTextLines, repairTurkishWordSpacing } from '@/lib/text'
import { THEME_STORAGE } from '@/lib/themePreferences'
import { getAssetUrl } from '@/lib/api'
import type { LibraryTheme } from '@/lib/libraryTheme'
import {
  buildChunkSsml,
  buildReadingOrderUnits,
  findPhraseStartIndex,
  joinHyphenatedBreaks,
  resolveAutoGcpVoice,
  resolveChunkVoice,
  splitWordUnitsIntoChunks,
  tokenizeTtsWords,
  wordIndexAtProgress,
  type MappedTtsVoice,
  type TtsStartMode,
  type TtsWordUnit,
} from '@/lib/tts'

import type { Annotation, AnnotationSource, AudioCursor, BookmarkRow, DrawPath, DrawTool, HighlightRect, PageLayout, Point, ReaderTheme, ReadingSession, ReadingStats, SidePanel } from './ReaderTypes'
import { DRAW_COLORS, IconButton, THEME_STYLES, compactDuration } from './ReaderUI'
import { DrawingCanvas, DrawingOverlay, pointDistance } from './DrawingCanvas'
import { SelectionPopup, SparklesIcon } from './SelectionPopup'
import { RsvpReader, type RsvpWordCue } from './RsvpReader'
import AudioNoteRecorder, { type AudioNoteRecorderHandle } from './AudioNoteRecorder'
import { ReflowReader } from './ReflowReader'
import { ContinuousReader } from './reader/ContinuousReader'
import { ReaderAccessibilityTools } from './reader/ReaderAccessibilityTools'
import { ReaderCommandPalette } from './reader/ReaderCommandPalette'
import { ReaderNavigationCockpit } from './reader/ReaderNavigationCockpit'
import { ReaderOfflineStatus } from './reader/ReaderOfflineStatus'
import { ReaderQualityCenter } from './reader/ReaderQualityCenter'
import { useSync } from './SyncProvider'
import PdfInDocSearch from './PdfInDocSearch'
import AnnotationEditor from './AnnotationEditor'
import AnnotationCategoryManager from './AnnotationCategoryManager'
import LinkedNoteText from './LinkedNoteText'
import AreaNoteSelector from './AreaNoteSelector'
import OcrTextLayer from './OcrTextLayer'
import type { AnnotationCategory } from '@/lib/annotationCategories'
import type { ReflowBlock } from '@/lib/reflow'
import {
  buildNativePageTextModel,
  buildOcrPageTextModel,
  type PageTextModel,
} from '@/lib/pdfTextModel'
import {
  getCanonicalPointerSelectionMode,
  isCanonicalSelectionModelUsable,
  resolveCanonicalPdfSelection,
  resolveCanonicalPdfSelectionFromRange,
  type CanonicalPdfSelection,
} from '@/lib/pdfSelection'
import {
  calculateFitWidthScale,
  getNoteRailAnchor,
  getSelectionToolbarPosition,
  isPhoneLandscapeViewport,
  isTouchSelectionSheetViewport,
  isTypingTarget,
  isOversizedPageSelection,
  layoutNoteRailAnchors,
  mergeOverlappingHighlightRects,
  readBooleanSetting,
} from '@/lib/readerLayout'
import { PDF_WORKER_SRC, PDF_DOCUMENT_OPTIONS } from '@/lib/pdfWorker'
import { copyTextToClipboard } from '@/lib/clipboard'
import {
  buildPageText,
  normalizeSearchQuery,
  type PdfSearchMatch,
} from '@/lib/pdfInDocSearch'
import { readerSearchCacheKey, searchReaderDocument } from '@/lib/readerSearch'
import {
  buildAnnotationDeepLink,
  filterAnnotations,
  normalizeAnnotationTags,
  parseAnnotationDeepLink,
  type AnnotationKindFilter,
  type AnnotationSort,
} from '@/lib/annotations'
import { getVisiblePageNumbers, mapTextMatchToSpanSegments, rotateNormalizedRect } from '@/lib/pageInteraction'
import { createReadingCursor, DEFAULT_READER_PREFERENCES, parseReaderPreferences, type ReaderMode } from '@/lib/readerV3'
import { audioCursorLabel, audioCursorTime, normalizeAudioCursor } from '@/lib/audioLinkedNotes'
import {
  deleteEncryptedAnnotation,
  getEncryptedPageText,
  listEncryptedBookmarks,
  listEncryptedAnnotations,
  deleteEncryptedBookmark,
  putEncryptedAnnotationPreview,
  putEncryptedPageText,
  saveEncryptedBookmark,
  saveEncryptedAnnotation,
  saveEncryptedWord,
} from '@/lib/encryptedReaderStore'

pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC

interface PDFReaderProps {
  bookId: number
  fileUrl: string
  rawFileUrl?: string
  initialPage: number
  initialTotalPages?: number
  bookTitle?: string
  bookAuthor?: string
  bookThumbnail?: string
  libraryTheme?: LibraryTheme
  onBack?: () => void
  onPageChange: (page: number) => void
  onForceRefresh?: () => void
  isEncrypted?: boolean
}

const PINCH_ZOOM_THRESHOLD = 0.025
const TWO_FINGER_SWIPE_THRESHOLD = 60
const DRAW_TOOLS: DrawTool[] = ['select', 'pen', 'highlighter', 'eraser', 'line', 'arrow', 'rectangle', 'ellipse', 'text', 'sticky']

type PdfRenderViewport = { width: number; height: number }
type PdfRenderPage = {
  getViewport: (options: { scale: number; rotation?: number }) => PdfRenderViewport
  render: (options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PdfRenderViewport; background?: string }) => { promise: Promise<void> }
}
type PdfTextItem = {
  str: string
  width?: number
  height?: number
  transform?: number[]
  hasEOL?: boolean
  dir?: string
}
type PdfTextPage = PdfRenderPage & {
  getTextContent?: () => Promise<{ items: PdfTextItem[] }>
}
type PdfDocumentRef = {
  numPages?: number
  getDestination?: (dest: unknown) => Promise<unknown[]>
  getPage?: (pageNumber: number) => Promise<PdfTextPage>
}

type WebKitGestureEvent = Event & { scale?: number }

function clampScale(value: number) {
  return Math.min(8, Math.max(0.5, +value.toFixed(2)))
}

// Returns true if a string looks like garbled/CID-encoded text
function isGarbledToken(token: string): boolean {
  if (token.length < 4) return false
  const letters = (token.match(/\p{L}/gu) || []).length
  if (letters === 0) return false
  // Count vowels (Latin + common accented)
  const vowels = (token.match(/[aeıioöuüAEIİOÖUÜaeiouáéíóúàèìòùâêîôûäëïöüãõ]/gi) || []).length
  const vowelRatio = vowels / letters
  // Count non-letter, non-digit chars
  const nonLetterDigit = (token.match(/[^\p{L}\p{N}]/gu) || []).length
  const nonRatio = nonLetterDigit / token.length
  // Garbled if: very long with no vowels, or majority non-readable
  return (letters > 6 && vowelRatio < 0.08) || nonRatio > 0.6
}

function buildRsvpTextFromLayer(layer: Element): string {
  try {
    const spans = Array.from(layer.querySelectorAll('span'))
      .map(span => {
        try {
          const rect = span.getBoundingClientRect()
          return {
            text: cleanText(span.textContent || ''),
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }
        } catch {
          return { text: '', left: 0, top: 0, width: 0, height: 0 }
        }
      })
      .filter(item => item.text.trim() && item.width > 0 && item.height > 0)
      .sort((a, b) => Math.abs(a.top - b.top) > 3 ? a.top - b.top : a.left - b.left)

    const lines: typeof spans[] = []
    for (const span of spans) {
      const line = lines.find(items => Math.abs(items[0].top - span.top) <= Math.max(4, span.height * 0.35))
      if (line) line.push(span)
      else lines.push([span])
    }

    return lines
      .map(line => {
        const sorted = line.sort((a, b) => a.left - b.left)
        return sorted.reduce((text, item, index) => {
          if (index === 0) return item.text
          const previous = sorted[index - 1]
          const gap = item.left - (previous.left + previous.width)
          const needsSpace = gap > Math.max(1.5, previous.height * 0.15) && !/[\s([{'"“‘]$/.test(text) && !/^[,.;:!?%)\]}'"\u201d\u2019]/.test(item.text)
          return `${text}${needsSpace ? ' ' : ''}${item.text}`
        }, '')
      })
      .join('\n')
  } catch {
    return ''
  }
}

function geometryAwareSelectionText(selection: Selection | null): string {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
  const range = selection.getRangeAt(0)
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  const anchorLayer = (anchor instanceof Element ? anchor : anchor?.parentElement)
    ?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
  const focusLayer = (focus instanceof Element ? focus : focus?.parentElement)
    ?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
  if (!anchorLayer || anchorLayer !== focusLayer) return ''

  const anchorSpan = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('span')
  const focusSpan = (focus instanceof Element ? focus : focus?.parentElement)?.closest('span')
  const anchorRect = anchorSpan?.getBoundingClientRect()
  const focusRect = focusSpan?.getBoundingClientRect()
  const visualTop = anchorRect && focusRect ? Math.min(anchorRect.top, focusRect.top) : Number.NEGATIVE_INFINITY
  const visualBottom = anchorRect && focusRect ? Math.max(anchorRect.bottom, focusRect.bottom) : Number.POSITIVE_INFINITY
  const sameVisualLine = Boolean(anchorRect && focusRect && Math.abs(anchorRect.top - focusRect.top) <= Math.max(4, Math.min(anchorRect.height, focusRect.height) * 0.4))
  const visualLeft = anchorRect && focusRect ? Math.min(anchorRect.left, focusRect.left) : Number.NEGATIVE_INFINITY
  const visualRight = anchorRect && focusRect ? Math.max(anchorRect.right, focusRect.right) : Number.POSITIVE_INFINITY

  const selected = Array.from(anchorLayer.querySelectorAll('span')).flatMap(span => {
    try {
      if (!range.intersectsNode(span)) return []
      const spanRange = document.createRange()
      spanRange.selectNodeContents(span)
      if (span.contains(range.startContainer)) {
        spanRange.setStart(range.startContainer, range.startOffset)
      }
      if (span.contains(range.endContainer)) {
        spanRange.setEnd(range.endContainer, range.endOffset)
      }
      const text = cleanText(spanRange.toString())
      const rect = span.getBoundingClientRect()
      if (!text || rect.width <= 0 || rect.height <= 0) return []
      // PDF object order is not always visual reading order (headers/footers
      // are frequently interleaved in the text-layer DOM). A DOM Range can
      // therefore intersect visually unrelated spans. Keep only the visual
      // corridor between the actual anchor and focus glyphs.
      const verticalTolerance = Math.max(3, rect.height * 0.35)
      if (rect.bottom < visualTop - verticalTolerance || rect.top > visualBottom + verticalTolerance) return []
      if (sameVisualLine && (rect.right < visualLeft - 3 || rect.left > visualRight + 3)) return []
      return [{ text, left: rect.left, top: rect.top, width: rect.width, height: rect.height }]
    } catch {
      return []
    }
  }).sort((a, b) => Math.abs(a.top - b.top) > Math.max(3, Math.min(a.height, b.height) * 0.35)
    ? a.top - b.top
    : a.left - b.left)
  if (selected.length === 0) return cleanText(selection.toString()).trim()

  const lines: typeof selected[] = []
  selected.forEach(item => {
    const line = lines.find(items => Math.abs(items[0].top - item.top) <= Math.max(3, item.height * 0.35))
    if (line) line.push(item)
    else lines.push([item])
  })
  const normalizedLines = lines.map(line => {
    const ordered = line.sort((a, b) => a.left - b.left)
    return ordered.reduce((text, item, index) => {
      if (index === 0) return item.text
      const previous = ordered[index - 1]
      const gap = item.left - (previous.left + previous.width)
      const needsSpace = gap > Math.max(1.5, previous.height * 0.15)
        && !/[\s([{/'"“‘-]$/.test(text)
        && !/^[,.;:!?%)\]}'"\u201d\u2019]/.test(item.text)
      return `${text}${needsSpace ? ' ' : ''}${item.text}`
    }, '')
  })
  return normalizedLines.reduce((text, line) => text ? joinWrappedTextLines(text, line) : line, '').trim()
}

function normalizePdfTextLayerReadingOrder(layer: Element | null) {
  if (!(layer instanceof HTMLElement)) return
  if (layer.closest('[data-canonical-selection-active="true"]')) return
  const activeSelection = window.getSelection()
  if (
    activeSelection
    && !activeSelection.isCollapsed
    && activeSelection.anchorNode
    && activeSelection.focusNode
    && layer.contains(activeSelection.anchorNode)
    && layer.contains(activeSelection.focusNode)
  ) return
  const spans = Array.from(layer.querySelectorAll<HTMLElement>(':scope > span'))
    .map((span, originalIndex) => ({ span, originalIndex, rect: span.getBoundingClientRect() }))
    .filter(item => item.rect.width > 0 && item.rect.height > 0)
  if (spans.length < 2) return

  const ordered = [...spans].sort((a, b) => {
    const lineTolerance = Math.max(3, Math.min(a.rect.height, b.rect.height) * 0.35)
    if (Math.abs(a.rect.top - b.rect.top) > lineTolerance) return a.rect.top - b.rect.top
    if (Math.abs(a.rect.left - b.rect.left) > 1) return a.rect.left - b.rect.left
    return a.originalIndex - b.originalIndex
  })
  const alreadyOrdered = ordered.every((item, index) => item.originalIndex === index)
  layer.dataset.visualOrderNormalized = '1'
  if (alreadyOrdered) return

  // PDF.js emits spans in PDF object order, which may put a footer between a
  // heading and its paragraph. Rebuild only the generated text children in
  // visual reading order; their absolute transforms keep rendering unchanged,
  // while native selection no longer crosses unrelated page regions.
  const marker = layer.querySelector<HTMLElement>(':scope > .endOfContent')
  const fragment = document.createDocumentFragment()
  ordered.forEach((item, index) => {
    fragment.appendChild(item.span)
    const next = ordered[index + 1]
    if (next) {
      const lineTolerance = Math.max(3, Math.min(item.rect.height, next.rect.height) * 0.35)
      if (Math.abs(item.rect.top - next.rect.top) > lineTolerance) fragment.appendChild(document.createElement('br'))
    }
  })
  Array.from(layer.children).forEach(child => {
    if (child !== marker) child.remove()
  })
  layer.insertBefore(fragment, marker)
}

function normalizeRsvpWords(raw: string): string[] {
  try {
    // NFKC normalize + zero-width char removal first
    const nfkc = raw.normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
      .replace(/\u00A0/g, ' ')

    const normalized = cleanText(nfkc)
      .replace(/[ﬁﬂﬃﬄ]/g, char => ({ 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl' }[char] || char))
      // Join soft-hyphenated line breaks: word-\nword -> wordword
      .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2')
      .replace(/[•·●▪◦]/g, ' ')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .trim()

    const segmented = normalized.split(/\s+/).filter(Boolean)

    return segmented
      .flatMap(token => token.length > 36 ? token.split(/(?=[,;:/.()[\]{}])/).filter(Boolean) : [token])
      .map(token => token.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.!?;:,'")\]}]+$/gu, ''))
      .filter(token => /[\p{L}\p{N}]/u.test(token))
      .filter(token => !isGarbledToken(token))
  } catch {
    return []
  }
}


function TextHighlightOverlay({ annotations, onDelete, rotation = 0 }: { annotations: Annotation[]; onDelete?: (id: number) => void; rotation?: number }) {
  const highlights = annotations.filter(item => item.type === 'highlight' && item.content.rects?.length)
  if (highlights.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {highlights.flatMap(annotation => (
        mergeOverlappingHighlightRects(annotation.content.rects || []).map(sourceRect => rotateNormalizedRect(sourceRect, rotation)).map((rect, index) => (
          <div
            key={`${annotation.id}-${index}`}
            className="absolute rounded-[2px] mix-blend-multiply"
            style={{
              left: `${rect.left * 100}%`,
              top: `${rect.top * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
              backgroundColor: annotation.content.color || '#facc15',
              opacity: 0.42,
            }}
          >
            {index === 0 && onDelete && (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onDelete(annotation.id)
                }}
                className="pointer-events-auto absolute -left-5 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full bg-red-600 text-white opacity-60 shadow-md transition hover:bg-red-500 hover:opacity-100 focus:opacity-100"
                aria-label="Delete highlight"
                title="Delete highlight"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))
      ))}
    </div>
  )
}

function CanonicalSelectionOverlay({
  selection,
  rotation,
  color,
}: {
  selection: CanonicalPdfSelection | null
  rotation: number
  color: string
}) {
  if (!selection) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[9]" aria-hidden="true" data-canonical-selection-overlay>
      {selection.rects.map(sourceRect => rotateNormalizedRect(sourceRect, rotation)).map((rect, index) => (
        <span
          key={`${selection.startWordId || 'start'}-${selection.endWordId || 'end'}-${index}`}
          className="absolute rounded-[2px]"
          style={{
            left: `${rect.left * 100}%`,
            top: `${rect.top * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
            backgroundColor: color,
            opacity: 0.34,
            boxShadow: `0 0 0 1px ${color}33`,
          }}
        />
      ))}
    </div>
  )
}

type InlineNoteTheme = Pick<(typeof THEME_STYLES)[ReaderTheme], 'panel' | 'subtle' | 'text' | 'accent' | 'accentGlow'>

function InlineNoteOverlay({
  annotations,
  themeStyle,
  focusedId,
  page,
  isLeftPage = false,
  rotation = 0,
}: {
  annotations: Annotation[]
  themeStyle: InlineNoteTheme
  focusedId?: number | null
  page: number
  isLeftPage?: boolean
  rotation?: number
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const { t } = useI18n()

  const selectionNotes = annotations
    .filter(item => (
      item.type === 'note'
      && !item.content.pageNote
      && (item.content.rects?.length || item.content.area || item.content.snapshot?.rect || item.content.sources?.some(source => source.page === page))
      && cleanText(item.content.note || '').trim()
    ))
    .map(item => {
      const multiSourceRects = item.content.sources
        ?.filter(source => source.page === page)
        .flatMap(source => source.rects?.length ? source.rects : source.area ? [source.area] : []) || []
      const sourceRects = mergeOverlappingHighlightRects(multiSourceRects.length
        ? multiSourceRects
        : item.content.rects?.length
        ? item.content.rects
        : item.content.area
          ? [item.content.area]
          : item.content.snapshot?.rect
            ? [item.content.snapshot.rect]
          : []).map(rect => rotateNormalizedRect(rect, rotation))
      const railAnchor = getNoteRailAnchor(sourceRects)
      return railAnchor ? { item, railAnchor, sourceRects } : null
    })
    .filter((entry): entry is { item: Annotation; railAnchor: { left: number; top: number }; sourceRects: HighlightRect[] } => Boolean(entry))

  const pageOnlyNotes = annotations
    .filter(item => item.type === 'note' && item.content.pageNote && cleanText(item.content.note || '').trim())
    .sort((a, b) => a.id - b.id)
  if (selectionNotes.length === 0 && pageOnlyNotes.length === 0) return null

  const pageTop = new Map(pageOnlyNotes.map((item, index) => [item.id, Math.min(0.48, 0.1 + index * 0.075)]))
  const selectionMinTop = Math.min(0.58, 0.13 + pageOnlyNotes.length * 0.075)
  const positions = new Map(layoutNoteRailAnchors(
    selectionNotes.map(({ item, railAnchor }) => ({ id: item.id, top: railAnchor.top })),
    { minGap: 0.09, minTop: selectionMinTop },
  ).map(position => [position.id, position]))
  const railNotes = [
    ...pageOnlyNotes.map(item => ({ item, rects: [] as HighlightRect[], top: pageTop.get(item.id) || 0.1, pageNote: true })),
    ...selectionNotes.map(({ item, sourceRects }) => ({ item, rects: sourceRects, top: positions.get(item.id)?.top || 0.5, pageNote: false })),
  ]

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {railNotes.map(({ item, rects, top, pageNote }) => {
        const isExpanded = (expandedId ?? focusedId) === item.id
        const note = cleanText(item.content.note || '').trim()

        return (
          <div key={item.id}>
            {rects.map((rect, index) => (
              <span
                key={`${item.id}-note-anchor-${index}`}
                data-annotation-source={item.id}
                aria-hidden="true"
                className="absolute border-b border-dashed transition-[border-color,background-color,box-shadow] duration-200"
                style={{
                  left: `${rect.left * 100}%`,
                  top: `${rect.top * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  borderColor: themeStyle.accent,
                  backgroundColor: isExpanded ? `${themeStyle.accent}18` : 'transparent',
                  boxShadow: isExpanded ? `0 3px 10px ${themeStyle.accentGlow}` : 'none',
                  opacity: isExpanded ? 0.95 : 0.62,
                }}
              />
            ))}
            <article
              className={`pointer-events-auto absolute rounded-l-xl rounded-r-md border text-left shadow-[0_10px_28px_rgba(0,0,0,0.24)] backdrop-blur-xl transition-[width,background-color,border-color,box-shadow] duration-200 ${themeStyle.panel} ${
                isLeftPage
                  ? isExpanded
                    ? 'left-2 z-30 w-[min(18rem,calc(100vw-2rem))] p-3 sm:left-auto sm:right-[calc(100%+0.65rem)] sm:w-72'
                    : 'left-0 z-20 w-9 px-1.5 py-2 sm:left-auto sm:right-[calc(100%+0.65rem)] sm:w-44 sm:px-2.5'
                  : isExpanded
                    ? 'right-2 z-30 w-[min(18rem,calc(100vw-2rem))] p-3 sm:right-auto sm:left-[calc(100%+0.65rem)] sm:w-72'
                    : 'right-0 z-20 w-9 px-1.5 py-2 sm:right-auto sm:left-[calc(100%+0.65rem)] sm:w-44 sm:px-2.5'
              }`}
              style={{
                top: `${top * 100}%`,
                transform: 'translateY(-50%)',
                borderColor: `${themeStyle.accent}55`,
                boxShadow: isExpanded
                  ? `0 14px 36px rgba(0,0,0,0.28), 0 0 22px ${themeStyle.accentGlow}`
                  : '0 10px 28px rgba(0,0,0,0.24)',
                '--note-accent': themeStyle.accent,
              } as React.CSSProperties}
            >
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? t('reader.collapseNote') : t('reader.expandNote')}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setExpandedId(isExpanded ? 0 : item.id)
                }}
                className="flex w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--note-accent)]"
              >
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
                  style={{ color: themeStyle.accent, backgroundColor: `${themeStyle.accent}20` }}
                >
                  <StickyNote size={13} />
                </span>
                <span className="hidden min-w-0 flex-1 sm:block">
                  <span className={`block text-[9px] font-bold uppercase tracking-[0.18em] ${themeStyle.text}`}>
                    {pageNote ? t('reader.addPageNote') : t('selection.note')}
                  </span>
                </span>
                {isExpanded
                  ? <ChevronUp size={13} className={`shrink-0 ${themeStyle.subtle}`} />
                  : <ChevronDown size={13} className={`hidden shrink-0 sm:block ${themeStyle.subtle}`} />}
              </button>
              {!isExpanded && (
                <LinkedNoteText
                  text={note}
                  className={`mt-0.5 hidden truncate text-[11px] leading-4 sm:block ${themeStyle.subtle}`}
                />
              )}
              {isExpanded && (
                <LinkedNoteText
                  text={note}
                  className={`mt-2 block max-h-64 overflow-y-auto whitespace-pre-line border-t pt-2 text-xs leading-relaxed ${themeStyle.text}`}
                  style={{ borderColor: `${themeStyle.accent}33` }}
                />
              )}
            </article>
          </div>
        )
      })}
    </div>
  )
}

const MemoTextHighlightOverlay = memo(TextHighlightOverlay)
const MemoInlineNoteOverlay = memo(InlineNoteOverlay)




interface StoredSettings {
  theme: ReaderTheme
  scale: number
  pageLayout: PageLayout
  fitWidth: boolean
  bigControls: boolean
  showPageNotes: boolean
  currentPage: number
  sidePanel: SidePanel
  focusMode: boolean
  focusToolsVisible: boolean
  drawTool: DrawTool
  drawColor: string
  brushSize: number
  drawOpacity: number
  rotation?: number
  brightness?: number
  contrast?: number
  showThumbnailStrip?: boolean
  twoPageSpread?: boolean
  readingMode?: ReaderMode
  rsvpWordIndex?: number
  ttsWordIndex?: number
  reflowScrollOffset?: number
  fontScale?: number
  lineHeight?: number
  columnWidth?: number
  readingRuler?: boolean
  focusLine?: boolean
  highContrast?: boolean
  eInkMode?: boolean
  readingDirection?: 'auto' | 'ltr' | 'rtl'
  reducedMotion?: boolean
  prefetchPages?: boolean
}

function parseStoredSettings(raw: Record<string, unknown>, defaults: StoredSettings): StoredSettings {
  const ergonomics = parseReaderPreferences(raw, {
    ...DEFAULT_READER_PREFERENCES,
    mode: defaults.readingMode || DEFAULT_READER_PREFERENCES.mode,
  })
  return {
    theme: raw.theme && THEME_STYLES[raw.theme as ReaderTheme] ? raw.theme as ReaderTheme : defaults.theme,
    scale: typeof raw.scale === 'number' ? Math.max(0.5, Math.min(8, raw.scale)) : defaults.scale,
    pageLayout: raw.pageLayout === 'double' ? 'double' : defaults.pageLayout,
    fitWidth: typeof raw.fitWidth === 'boolean' ? raw.fitWidth : defaults.fitWidth,
    bigControls: typeof raw.bigControls === 'boolean' ? raw.bigControls : defaults.bigControls,
    showPageNotes: readBooleanSetting(raw, 'showPageNotes', defaults.showPageNotes),
    currentPage: typeof raw.currentPage === 'number' ? Math.max(1, Math.floor(raw.currentPage)) : defaults.currentPage,
    sidePanel: raw.sidePanel === 'progress' || raw.sidePanel === 'notes' || raw.sidePanel === 'highlights' || raw.sidePanel === 'bookmarks' || raw.sidePanel === 'ask-ai' || raw.sidePanel === 'audio-notes' || raw.sidePanel === 'outline' || raw.sidePanel === 'navigator' || raw.sidePanel === 'quality' || raw.sidePanel === 'study' || raw.sidePanel === null ? raw.sidePanel as SidePanel : defaults.sidePanel,
    focusMode: typeof raw.focusMode === 'boolean' ? raw.focusMode : defaults.focusMode,
    focusToolsVisible: typeof raw.focusToolsVisible === 'boolean' ? raw.focusToolsVisible : defaults.focusToolsVisible,
    drawTool: raw.drawTool && DRAW_TOOLS.includes(raw.drawTool as DrawTool) ? raw.drawTool as DrawTool : defaults.drawTool,
    drawColor: typeof raw.drawColor === 'string' && raw.drawColor ? raw.drawColor : defaults.drawColor,
    brushSize: typeof raw.brushSize === 'number' ? Math.max(2, Math.min(18, raw.brushSize)) : defaults.brushSize,
    drawOpacity: typeof raw.drawOpacity === 'number' ? Math.max(0.15, Math.min(1, raw.drawOpacity)) : defaults.drawOpacity,
    rotation: typeof raw.rotation === 'number' ? raw.rotation : 0,
    brightness: typeof raw.brightness === 'number' ? raw.brightness : 1,
    contrast: typeof raw.contrast === 'number' ? raw.contrast : 1,
    showThumbnailStrip: typeof raw.showThumbnailStrip === 'boolean' ? raw.showThumbnailStrip : false,
    twoPageSpread: typeof raw.twoPageSpread === 'boolean' ? raw.twoPageSpread : false,
    readingMode: raw.readingMode === 'reflow' || raw.readingMode === 'continuous' ? raw.readingMode : 'pdf',
    rsvpWordIndex: typeof raw.rsvpWordIndex === 'number' ? Math.max(0, Math.floor(raw.rsvpWordIndex)) : 0,
    ttsWordIndex: typeof raw.ttsWordIndex === 'number' ? Math.max(0, Math.floor(raw.ttsWordIndex)) : 0,
    reflowScrollOffset: typeof raw.reflowScrollOffset === 'number' ? Math.max(0, raw.reflowScrollOffset) : 0,
    fontScale: ergonomics.fontScale,
    lineHeight: ergonomics.lineHeight,
    columnWidth: ergonomics.columnWidth,
    readingRuler: ergonomics.readingRuler,
    focusLine: ergonomics.focusLine,
    highContrast: ergonomics.highContrast,
    eInkMode: ergonomics.eInkMode,
    readingDirection: ergonomics.readingDirection,
    reducedMotion: ergonomics.reducedMotion,
    prefetchPages: ergonomics.prefetchPages,
  }
}

function getStoredSettings(bookId: number, initialPage: number): StoredSettings {
  const defaults: StoredSettings = {
    theme: 'midnight',
    scale: 1,
    pageLayout: 'single',
    fitWidth: typeof window !== 'undefined' && window.innerWidth < 768,
    bigControls: false,
    showPageNotes: true,
    currentPage: initialPage,
    sidePanel: 'progress',
    focusMode: false,
    focusToolsVisible: true,
    drawTool: 'pen',
    drawColor: '#f8fafc',
    brushSize: 4,
    drawOpacity: 1,
    readingMode: 'pdf',
    rsvpWordIndex: 0,
    ttsWordIndex: 0,
    reflowScrollOffset: 0,
    ...DEFAULT_READER_PREFERENCES,
  }
  if (typeof window === 'undefined') return defaults
  try {
    const globalRaw = JSON.parse(window.localStorage.getItem(THEME_STORAGE.reader) || '{}') as Record<string, unknown>
    const bookRaw = JSON.parse(window.localStorage.getItem(THEME_STORAGE.readerBook(bookId)) || '{}') as Record<string, unknown>
    return parseStoredSettings({
      ...globalRaw,
      ...bookRaw,
      showPageNotes: globalRaw.showPageNotes,
    }, defaults)
  } catch {
    return defaults
  }
}

export default function PDFReader({
  bookId,
  fileUrl,
  rawFileUrl,
  initialPage,
  initialTotalPages = 0,
  bookTitle = 'PDF Reader',
  bookAuthor = '',
  bookThumbnail = '',
  libraryTheme: _libraryTheme,
  onBack,
  onPageChange,
  onForceRefresh,
  isEncrypted = false,
}: PDFReaderProps) {
  const { t, pageLabel, locale, language } = useI18n()
  const { conflicts, triggerSync } = useSync()
  const resolvedFileUrl = getAssetUrl(fileUrl)
  const resolvedRawFileUrl = rawFileUrl ? getAssetUrl(rawFileUrl) : undefined
  const [_initialSettings] = useState(() => getStoredSettings(bookId, initialPage))
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>((_initialSettings.rotation as 0 | 90 | 180 | 270) || 0)
  const [numPages, setNumPages] = useState(initialTotalPages)
  const [currentPage, setCurrentPage] = useState(_initialSettings.currentPage)
  const [pageInput, setPageInput] = useState(String(_initialSettings.currentPage))
  const [rsvpOpen, setRsvpOpen] = useState(false)
  const [readingMode, setReadingMode] = useState<ReaderMode>(_initialSettings.readingMode || 'pdf')
  const [rsvpWordIndex, setRsvpWordIndex] = useState(_initialSettings.rsvpWordIndex || 0)
  const [ttsWordIndex, setTtsWordIndex] = useState(_initialSettings.ttsWordIndex || 0)
  const [readingCursor, setReadingCursor] = useState(() => createReadingCursor(initialPage, Math.max(_initialSettings.rsvpWordIndex || 0, _initialSettings.ttsWordIndex || 0)))
  const [reflowScrollOffset, setReflowScrollOffset] = useState(_initialSettings.reflowScrollOffset || 0)
  const [reflowPageText, setReflowPageText] = useState<{ page: number; text: string; blocks: ReflowBlock[] }>({ page: 0, text: '', blocks: [] })
  const [pageTextModel, setPageTextModel] = useState<{ page: number; model: PageTextModel } | null>(null)
  const [visiblePageTextModels, setVisiblePageTextModels] = useState<Record<number, PageTextModel>>({})
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({})
  const [pageTextRecoveryBusy, setPageTextRecoveryBusy] = useState(false)
  const [pageRenderReady, setPageRenderReady] = useState(0)
  const [secondPageRenderReady, setSecondPageRenderReady] = useState(0)
  const pageRecoveryJobsRef = useRef(new Map<number, Promise<void>>())
  useEffect(() => {
    let cancelled = false
    if (isEncrypted) {
      if (rotation !== 0) return
      void getEncryptedPageText(bookId, currentPage).then(model => {
        if (cancelled) return
        setPageTextModel(model ? { page: currentPage, model } : null)
        if (model) {
          setVisiblePageTextModels(current => ({ ...current, [currentPage]: model }))
          setReflowPageText({ page: currentPage, text: model.text, blocks: model.blocks })
        } else {
          setReflowPageText({ page: currentPage, text: '', blocks: [] })
        }
      }).catch(() => {
        if (!cancelled) setReflowPageText({ page: currentPage, text: '', blocks: [] })
      })
      return () => { cancelled = true }
    }
    if (rotation !== 0) return
    fetch(`/api/books/${bookId}/page-text?page=${currentPage}`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error('page text unavailable')))
      .then(data => {
        if (cancelled) return
        const model = data.model && typeof data.model === 'object' ? data.model as PageTextModel : null
        setPageTextModel(model?.source === 'ocr' ? { page: currentPage, model } : null)
        if (model?.source === 'ocr') setVisiblePageTextModels(current => ({ ...current, [currentPage]: model }))
        setReflowPageText({
          page: currentPage,
          text: typeof data.text === 'string' ? data.text : '',
          blocks: Array.isArray(data.blocks) ? data.blocks as ReflowBlock[] : [],
        })
      })
      .catch(() => {
        if (!cancelled) {
          setPageTextModel(null)
          setReflowPageText({ page: currentPage, text: '', blocks: [] })
        }
      })
    return () => { cancelled = true }
  }, [bookId, currentPage, isEncrypted, rotation])
  const getRsvpWords = useCallback(() => {
    if (reflowPageText.page === currentPage && reflowPageText.text.trim()) return normalizeRsvpWords(reflowPageText.text)
    const layer = readerRef.current?.querySelector(`.react-pdf__Page[data-page-number='${currentPage}'] .react-pdf__Page__textContent`)
    return layer ? normalizeRsvpWords(buildRsvpTextFromLayer(layer)) : []
  }, [currentPage, reflowPageText])
  const getRsvpCues = useCallback((): RsvpWordCue[] => {
    if (reflowPageText.page !== currentPage || reflowPageText.blocks.length === 0) return []
    return reflowPageText.blocks.flatMap(block => {
      const blockWords = normalizeRsvpWords(block.text)
      return blockWords.map((word, index) => ({
        word,
        kind: block.type === 'heading' ? 'heading' as const : 'body' as const,
        blockStart: index === 0,
        blockEnd: index === blockWords.length - 1,
      }))
    })
  }, [currentPage, reflowPageText])
  const activeReflowPage = useMemo(() => (
    reflowPageText.page === currentPage
      ? { text: reflowPageText.text, blocks: reflowPageText.blocks }
      : undefined
  ), [currentPage, reflowPageText])
  const [scale, setScale] = useState(_initialSettings.scale)
  const [pageLayout, setPageLayout] = useState<PageLayout>(_initialSettings.pageLayout)
  const [fitWidth, setFitWidth] = useState(_initialSettings.fitWidth)
  const [bigControls, setBigControls] = useState(_initialSettings.bigControls)
  const [showPageNotes, setShowPageNotes] = useState(_initialSettings.showPageNotes)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [popup, setPopup] = useState<{ x: number; y: number; text: string; page: number; rects: HighlightRect[] } | null>(null)
  const [canonicalSelection, setCanonicalSelection] = useState<{ page: number; value: CanonicalPdfSelection } | null>(null)
  const canonicalSelectionRef = useRef<{ page: number; value: CanonicalPdfSelection } | null>(null)
  const clearCanonicalSelection = useCallback(() => {
    canonicalSelectionRef.current = null
    setCanonicalSelection(null)
  }, [])
  const [sidePanel, setSidePanel] = useState<SidePanel>(() => (
    typeof window !== 'undefined' && window.innerWidth < 768 ? null : _initialSettings.sidePanel
  ))
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([])
  const [drawMode, setDrawMode] = useState(false)
  const [drawTool, setDrawTool] = useState<DrawTool>(_initialSettings.drawTool)
  const [drawOpacity, setDrawOpacity] = useState(_initialSettings.drawOpacity)
  const [drawColor, setDrawColor] = useState(_initialSettings.drawColor)
  const [brushSize, setBrushSize] = useState(_initialSettings.brushSize)
  // Focus mode is session-only. Restoring a hidden toolbar on phones can leave
  // the reader looking like it has no controls at all.
  const [focusMode, setFocusMode] = useState(false)
  const [focusToolsVisible, setFocusToolsVisible] = useState(true)
  const [ocrText, setOcrText] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const [theme, setTheme] = useState<ReaderTheme>(_initialSettings.theme)
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [showMoreTools, setShowMoreTools] = useState(false)
  const [showBugReport, setShowBugReport] = useState(false)
  const [brightness, setBrightness] = useState<number>(_initialSettings.brightness || 1)
  const [contrast, setContrast] = useState<number>(_initialSettings.contrast || 1)
  const [showDisplaySettings, setShowDisplaySettings] = useState(false)
  const [showThumbnailStrip, setShowThumbnailStrip] = useState(_initialSettings.showThumbnailStrip || false)
  const [fontScale, setFontScale] = useState(_initialSettings.fontScale || DEFAULT_READER_PREFERENCES.fontScale)
  const [lineHeight, setLineHeight] = useState(_initialSettings.lineHeight || DEFAULT_READER_PREFERENCES.lineHeight)
  const [columnWidth, setColumnWidth] = useState(_initialSettings.columnWidth || DEFAULT_READER_PREFERENCES.columnWidth)
  const [readingRuler, setReadingRuler] = useState(Boolean(_initialSettings.readingRuler))
  const [focusLine, setFocusLine] = useState(Boolean(_initialSettings.focusLine))
  const [highContrast, setHighContrast] = useState(Boolean(_initialSettings.highContrast))
  const [eInkMode, setEInkMode] = useState(Boolean(_initialSettings.eInkMode))
  const [readingDirection, setReadingDirection] = useState<'auto' | 'ltr' | 'rtl'>(_initialSettings.readingDirection || 'auto')
  const [reducedMotion, setReducedMotion] = useState(Boolean(_initialSettings.reducedMotion))
  const [prefetchPages, setPrefetchPages] = useState(_initialSettings.prefetchPages ?? true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [rulerY, setRulerY] = useState(0)
  const [prefetching, setPrefetching] = useState(false)
  const [mobileToolCategory, setMobileToolCategory] = useState<'view' | 'markup' | 'tools' | null>(null)

  const selectReadingMode = useCallback((mode: ReaderMode) => {
    setReadingMode(mode)
    // PDF mode is the predictable single-page escape hatch from continuous
    // and text-flow reading. Users can still opt into two-page spread from
    // View after returning to the PDF canvas.
    if (mode === 'pdf') setPageLayout('single')
    setSidePanel(null)
    setPopup(null)
    clearCanonicalSelection()
    setDrawMode(false)
    setMobileToolCategory(null)
    setShowMoreTools(false)
    setShowDisplaySettings(false)
    setDocSearchOpen(false)
  }, [clearCanonicalSelection])

  function closeAllOtherPanels(except?: string) {
    if (except !== 'sidePanel') setSidePanel(null)
    if (except !== 'displaySettings') setShowDisplaySettings(false)
    if (except !== 'themePicker') setShowThemePicker(false)
    if (except !== 'moreTools') setShowMoreTools(false)
    if (except !== 'docSearch') setDocSearchOpen(false)
  }
  const [annotationSearch, setAnnotationSearch] = useState('')
  const [noteKindFilter, setNoteKindFilter] = useState<AnnotationKindFilter>('all')
  const [noteTagFilter, setNoteTagFilter] = useState('')
  const [noteCategoryFilter, setNoteCategoryFilter] = useState<number | null>(null)
  const [annotationCategories, setAnnotationCategories] = useState<AnnotationCategory[]>([])
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [noteSort, setNoteSort] = useState<AnnotationSort>('page-asc')
  const [notesCurrentPageOnly, setNotesCurrentPageOnly] = useState(false)
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<number[]>([])
  const [noteEditor, setNoteEditor] = useState<{ annotation?: Annotation; initialContent?: Partial<Annotation['content']>; page: number; pageNote: boolean } | null>(null)
  const [noteSaving, setNoteSaving] = useState(false)
  const audioRecorderRef = useRef<AudioNoteRecorderHandle>(null)
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<number | null>(null)
  const [areaSelectMode, setAreaSelectMode] = useState(false)
  const [areaUploadBusy, setAreaUploadBusy] = useState(false)
  const [sourceCollectMode, setSourceCollectMode] = useState(false)
  const [sourceCollection, setSourceCollection] = useState<AnnotationSource[]>([])
  const [docSearchOpen, setDocSearchOpen] = useState(false)
  const [docSearchQuery, setDocSearchQuery] = useState('')
  const [docSearchMatches, setDocSearchMatches] = useState<PdfSearchMatch[]>([])
  const [docSearchIndex, setDocSearchIndex] = useState(0)
  const [docSearchLoading, setDocSearchLoading] = useState(false)
  const docSearchAbortRef = useRef<AbortController | null>(null)
  const docSearchCacheRef = useRef(new Map<string, PdfSearchMatch[]>())
  const [readingSeconds, setReadingSeconds] = useState(0)
  const [sessionPaused, setSessionPaused] = useState(true)
  const readingSecondsRef = useRef(0)
  const sessionSavedRef = useRef(false)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const [loadError, setLoadError] = useState(false)
  const [forceNativeViewer, setForceNativeViewer] = useState(false)
  const [readingStats, setReadingStats] = useState<ReadingStats | null>(null)
  const [readerWidth, setReaderWidth] = useState(0)
  // PDF outline/TOC
  const [pdfOutline, setPdfOutline] = useState<Array<{ title: string; dest: unknown; items?: unknown[] }>>([])
  const pdfDocRef = useRef<PdfDocumentRef | null>(null)
  const { messages: toastMessages, toast, remove: removeToast } = useToast()
  const swipeStart = useRef<Point | null>(null)
  const twoFingerCenter = useRef<Point | null>(null)
  const lastPinch = useRef<number | null>(null)
  const pinchZoomActive = useRef(false)
  const pinchScaleRef = useRef(1)
  const pinchStartScale = useRef(1)
  const headerRef = useRef<HTMLElement>(null)
  const readerRef = useRef<HTMLElement>(null)
  const readerShellRef = useRef<HTMLDivElement>(null)
  const normalizePrimaryTextLayer = useCallback(() => {
    ;[80, 320, 900].forEach(delay => window.setTimeout(() => {
      normalizePdfTextLayerReadingOrder(readerRef.current?.querySelector(`[data-page-number="${currentPage}"] .react-pdf__Page__textContent`) || null)
    }, delay))
  }, [currentPage])
  const normalizeSecondaryTextLayer = useCallback(() => {
    ;[80, 320, 900].forEach(delay => window.setTimeout(() => {
      normalizePdfTextLayerReadingOrder(readerRef.current?.querySelector(`[data-page-number="${currentPage + 1}"] .react-pdf__Page__textContent`) || null)
    }, delay))
  }, [currentPage])
  const currentPageRef = useRef(_initialSettings.currentPage)
  const firstPageCanvasRef = useRef<HTMLCanvasElement>(null)
  const secondPageCanvasRef = useRef<HTMLCanvasElement>(null)
  const ocrWorkerRef = useRef<Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null>(null)
  const ocrWorkerPromiseRef = useRef<Promise<Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>> | null>(null)
  const ocrQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const ocrGenerationRef = useRef(0)
  const scaleRef = useRef(_initialSettings.scale)
  const [isPinching, setIsPinching] = useState(false)
  const [pinchScale, setPinchScale] = useState(1)
  const [sessionStartPage, setSessionStartPage] = useState(_initialSettings.currentPage)
  const [headerHeight, setHeaderHeight] = useState(0)

  useEffect(() => {
    let cancelled = false
    const visiblePages = getVisiblePageNumbers(currentPage, pageLayout, numPages || currentPage)
    void Promise.all(visiblePages.map(async page => {
      const pdfPage = await pdfDocRef.current?.getPage?.(page)
      if (!pdfPage) return null
      const viewport = pdfPage.getViewport({ scale: 1, rotation })
      return { page, width: viewport.width, height: viewport.height }
    })).then(sizes => {
      if (cancelled) return
      const valid = sizes.filter((size): size is { page: number; width: number; height: number } => Boolean(size))
      if (valid.length === 0) return
      setPageSizes(current => {
        const changed = valid.some(size => current[size.page]?.width !== size.width || current[size.page]?.height !== size.height)
        if (!changed) return current
        return { ...current, ...Object.fromEntries(valid.map(size => [size.page, { width: size.width, height: size.height }])) }
      })
      const primary = valid.find(size => size.page === currentPage)
      if (primary) setPageSize(current => current.width === primary.width && current.height === primary.height
        ? current
        : { width: primary.width, height: primary.height })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentPage, numPages, pageLayout, rotation])

  const selectionVersionRef = useRef(0)
  const touchActiveRef = useRef(0)
  const pendingSelectionPopupRef = useRef(0)
  const selectionPointerRef = useRef<{
    startedAt: number
    endedAt: number
    pointerType: string
    pointerId: number
    inTextLayer: boolean
    modelPage: number | null
    canonicalPage: number | null
    startX: number
    startY: number
    endX: number
    endY: number
  }>({ startedAt: 0, endedAt: 0, pointerType: '', pointerId: -1, inTextLayer: false, modelPage: null, canonicalPage: null, startX: 0, startY: 0, endX: 0, endY: 0 })
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isTtsPaused, setIsTtsPaused] = useState(false)
  const [speechRate, setSpeechRate] = useState(1)
  const speechRateRef = useRef(1)
  const [playbackStartMode, setPlaybackStartMode] = useState<TtsStartMode>('viewport')
  const [ttsPickMode, setTtsPickMode] = useState(false)
  const [ttsChunksList, setTtsChunksList] = useState<{ text: string; startWord: number; endWord: number }[]>([])
  const [showTtsSectionList, setShowTtsSectionList] = useState(false)
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  const speakingTextRef = useRef('')
  const chunkOffsetRef = useRef(0)
  const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>(() => {
    if (typeof window === 'undefined') return []
    const s = window.speechSynthesis
    return s ? s.getVoices() : []
  })
  const [selectedVoiceName, setSelectedVoiceName] = useState('')
  const [gcpVoices, setGcpVoices] = useState<MappedTtsVoice[]>([])
  const edgeAudioRef = useRef<HTMLAudioElement | null>(null)
  const ttsSessionRef = useRef(0)
  const ttsPlaybackRef = useRef<{ provider: 'browser' | 'google'; timeMs?: number; durationMs?: number; chunkStartWord?: number; chunkEndWord?: number }>({ provider: 'browser' })
  const ttsHighlightCursorRef = useRef(0)
  const ttsPageWordsRef = useRef<{
    id: string
    token: string
    startOffset: number
    endOffset: number
    spans: HTMLElement[]
    ranges: Range[]
  }[]>([])
  const ttsSpanByKeyRef = useRef<Map<number, HTMLElement>>(new Map())
  const ttsPickChunksRef = useRef<{ startWord: number; endWord: number }[]>([])
  const gcpQueueRef = useRef<{
    session: number
    chunks: { text: string; startWord: number; endWord: number; voice: string }[]
    index: number
    aborted: boolean
    cache: Map<number, string>
    players: Map<number, HTMLAudioElement>
    inflight: Map<number, Promise<void>>
    abortControllers: AbortController[]
  } | null>(null)

  useEffect(() => {
    speechRateRef.current = speechRate
    if (edgeAudioRef.current) {
      edgeAudioRef.current.playbackRate = Math.max(0.5, Math.min(2, speechRate))
    }
    const queue = gcpQueueRef.current
    if (queue) {
      for (const player of queue.players.values()) {
        player.playbackRate = Math.max(0.5, Math.min(2, speechRate))
      }
    }
  }, [speechRate])

  useEffect(() => {
    const s = synth
    if (!s) return
    const load = () => setAllVoices(s.getVoices())
    load()
    s.addEventListener('voiceschanged', load)
    return () => s.removeEventListener('voiceschanged', load)
  }, [synth])

  useEffect(() => {
    if (isEncrypted) return
    fetch('/api/tts')
      .then(r => r.json())
      .then(v => {
        if (Array.isArray(v)) setGcpVoices(v as MappedTtsVoice[])
      })
      .catch(() => {})
  }, [isEncrypted])

  useEffect(() => {
    return () => {
      const queue = gcpQueueRef.current
      if (queue) {
        queue.aborted = true
        for (const controller of queue.abortControllers) controller.abort()
        for (const url of queue.cache.values()) URL.revokeObjectURL(url)
      }
      if (edgeAudioRef.current) {
        edgeAudioRef.current.pause()
        edgeAudioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!readingRuler && !focusLine) return
    let frame = 0
    const onPointerMove = (event: PointerEvent) => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setRulerY(event.clientY)
      })
    }
    const root = readerRef.current
    root?.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      root?.removeEventListener('pointermove', onPointerMove)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [focusLine, readingRuler])

  useEffect(() => {
    if (!prefetchPages || isEncrypted || !numPages || typeof navigator === 'undefined' || !navigator.onLine) return
    const controller = new AbortController()
    const nextPages = [currentPage + 1, currentPage + 2].filter(page => page <= numPages)
    if (nextPages.length === 0) return
    const startTimer = window.setTimeout(() => setPrefetching(true), 0)
    Promise.all(nextPages.map(async page => {
      await Promise.resolve(pdfDocRef.current?.getPage?.(page)).catch(() => undefined)
      await fetch(`/api/books/${bookId}/page-text?page=${page}`, { signal: controller.signal, cache: 'force-cache' }).catch(() => undefined)
    })).finally(() => {
      if (!controller.signal.aborted) setPrefetching(false)
    })
    return () => { window.clearTimeout(startTimer); controller.abort() }
  }, [bookId, currentPage, isEncrypted, numPages, prefetchPages])

  const langMap: Record<string, string> = { tr: 'tr-TR', en: 'en-US', de: 'de-DE' }
  const ttsLang = langMap[language] || 'en-US'
  const uiLocalePrefix = language
  const preferredGcpVoices = useMemo(() => {
    const preferred = gcpVoices.filter(v => v.Locale.toLowerCase().startsWith(uiLocalePrefix))
    return preferred.length > 0 ? preferred : gcpVoices
  }, [gcpVoices, uiLocalePrefix])
  const otherGcpVoices = useMemo(() => {
    if (preferredGcpVoices.length === gcpVoices.length) return []
    return gcpVoices.filter(v => !v.Locale.toLowerCase().startsWith(uiLocalePrefix))
  }, [gcpVoices, preferredGcpVoices.length, uiLocalePrefix])

  const premiumVoiceNames: Record<string, string[]> = {
    tr: ['Yelda'],
    en: ['Samantha', 'Daniel', 'Karen', 'Fiona', 'Moira', 'Tessa', 'Veena'],
    de: ['Anna'],
  }

  function getBestVoice(lang: string): SpeechSynthesisVoice | null {
    if (!synth) return null
    const voices = allVoices.length > 0 ? allVoices : synth.getVoices()
    if (selectedVoiceName) {
      const found = voices.find(v => v.name === selectedVoiceName)
      if (found) return found
    }
    const langVoices = voices.filter(v => v.lang.startsWith(lang))
    if (langVoices.length === 0) return null
    const premiums = premiumVoiceNames[lang] || []
    for (const name of premiums) {
      const hit = langVoices.find(v => v.name.toLowerCase().includes(name.toLowerCase()))
      if (hit) return hit
    }
    return langVoices[0]
  }

  const langVoices = allVoices.filter(v => v.lang.startsWith(language))

  function clearTtsHighlight() {
    readerRef.current?.querySelectorAll('.tts-highlight').forEach(el => el.classList.remove('tts-highlight'))
    const registry = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights
    registry?.delete('pdf-reader-tts-active')
  }

  function clearTtsChunkPick() {
    readerRef.current?.querySelectorAll('.tts-chunk-pick').forEach(el => {
      el.classList.remove('tts-chunk-pick', 'tts-chunk-pick-a', 'tts-chunk-pick-b')
      el.removeAttribute('data-tts-chunk')
    })
    const registry = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights
    registry?.delete('pdf-reader-tts-chunk-a')
    registry?.delete('pdf-reader-tts-chunk-b')
    ttsPickChunksRef.current = []
    setTtsPickMode(false)
    setShowTtsSectionList(false)
  }

  function collectVisibleSpanBoxes() {
    const boxes: { text: string; left: number; top: number; width: number; height: number; key: number }[] = []
    const spanByKey = new Map<number, HTMLElement>()
    let key = 0

    const pageContainer = readerRef.current?.querySelector(`.react-pdf__Page[data-page-number="${currentPage}"]`) 
      || readerRef.current?.querySelector('.react-pdf__Page')
    
    if (!pageContainer) return boxes

    const layer = pageContainer.parentElement?.querySelector('.ocr-text-layer')
      || pageContainer.querySelector('.react-pdf__Page__textContent')
    if (!layer) return boxes

    const layerRect = layer.getBoundingClientRect()

    layer.querySelectorAll('span').forEach(span => {
      try {
        const rect = span.getBoundingClientRect()
        const text = span.textContent || ''
        if (!text.trim() || rect.width <= 0 || rect.height <= 0) return
        
        const relLeft = rect.left - layerRect.left
        const relTop = rect.top - layerRect.top

        spanByKey.set(key, span as HTMLElement)
        boxes.push({
          text,
          left: relLeft,
          top: relTop,
          width: rect.width,
          height: rect.height,
          key,
        })
        key += 1
      } catch {
        // Ignore detached spans.
      }
    })
    ttsSpanByKeyRef.current = spanByKey
    return boxes
  }

  function buildTtsPlaybackPlan(units?: TtsWordUnit[]) {
    const resolved = units || buildReadingOrderUnits(collectVisibleSpanBoxes())
    const spanCursor = new Map<number, number>()
    let documentOffset = 0
    ttsPageWordsRef.current = resolved.map((unit, wordIndex) => {
      const spans = unit.spanKeys
        .map(spanKey => ttsSpanByKeyRef.current.get(spanKey))
        .filter((span): span is HTMLElement => Boolean(span))
      const ranges = unit.spanKeys.flatMap(spanKey => {
        const span = ttsSpanByKeyRef.current.get(spanKey)
        const textNode = span && Array.from(span.childNodes).find(node => node.nodeType === Node.TEXT_NODE)
        if (!span || !textNode) return []
        const sourceText = textNode.textContent || ''
        const from = spanCursor.get(spanKey) || 0
        const normalizedToken = unit.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const match = sourceText.slice(from).match(new RegExp(normalizedToken, 'iu'))
          || sourceText.slice(from).match(/\S+/u)
        const start = match ? from + (match.index || 0) : 0
        const end = match ? Math.min(sourceText.length, start + match[0].length) : sourceText.length
        spanCursor.set(spanKey, end)
        if (end <= start) return []
        const range = document.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, end)
        return [range]
      })
      const startOffset = documentOffset
      documentOffset += unit.normalized.length
      const endOffset = documentOffset
      documentOffset += 1
      const modelWordId = spans.find(span => span.dataset.readerWordId)?.dataset.readerWordId
      const modelStart = Number(spans.find(span => span.dataset.textStart)?.dataset.textStart)
      const modelEnd = Number(spans.find(span => span.dataset.textEnd)?.dataset.textEnd)
      return {
        id: modelWordId || `page-${currentPage}-word-${wordIndex}-${startOffset}`,
        token: unit.normalized,
        startOffset: Number.isFinite(modelStart) ? modelStart : startOffset,
        endOffset: Number.isFinite(modelEnd) ? modelEnd : endOffset,
        spans,
        ranges,
      }
    })
    ttsHighlightCursorRef.current = 0
    return resolved
  }

  function highlightTtsWordAt(index: number) {
    const pageWords = ttsPageWordsRef.current
    if (index < 0 || index >= pageWords.length) return
    if (index < ttsHighlightCursorRef.current - 1) return
    const target = pageWords[index]
    clearTtsHighlight()
    const registry = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void } }).highlights
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (registry && HighlightConstructor && target.ranges.length > 0) {
      registry.set('pdf-reader-tts-active', new HighlightConstructor(...target.ranges))
    } else {
      for (const span of target.spans) span.classList.add('tts-highlight')
    }
    ttsHighlightCursorRef.current = index + 1
    setTtsWordIndex(index)
    setReadingCursor(createReadingCursor(currentPage, index, 'tts'))
    const focus = target.spans[0]
    if (focus) focus.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }

  function currentAudioCursor(): AudioCursor | null {
    if (readingCursor.source === 'idle') return null
    const target = ttsPageWordsRef.current[readingCursor.wordIndex]
    const playback = ttsPlaybackRef.current
    return normalizeAudioCursor({
      page: readingCursor.page,
      wordIndex: readingCursor.wordIndex,
      source: readingCursor.source,
      text: target?.token,
      ...playback,
    })
  }

  function stopGcpQueue() {
    const queue = gcpQueueRef.current
    if (queue) {
      queue.aborted = true
      for (const controller of queue.abortControllers) controller.abort()
      for (const url of queue.cache.values()) URL.revokeObjectURL(url)
      for (const player of queue.players.values()) {
        player.onended = null
        player.ontimeupdate = null
        player.onerror = null
        player.onplaying = null
        player.pause()
        player.removeAttribute('src')
        player.load()
      }
      queue.cache.clear()
      queue.players.clear()
      queue.abortControllers = []
    }
    gcpQueueRef.current = null
    if (edgeAudioRef.current) {
      edgeAudioRef.current.onended = null
      edgeAudioRef.current.ontimeupdate = null
      edgeAudioRef.current.onerror = null
      edgeAudioRef.current.onplaying = null
      edgeAudioRef.current.pause()
      edgeAudioRef.current = null
    }
  }

  function getSelectedReaderText(): string {
    if (typeof window === 'undefined') return ''
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return ''
    const text = geometryAwareSelectionText(selection)
    if (!text) return ''
    const anchor = selection.anchorNode
    const node = anchor instanceof Element ? anchor : anchor?.parentElement
    if (!node?.closest('.react-pdf__Page__textContent, .ocr-text-layer')) return ''
    return text
  }

  function findViewportStartIndex(pageWords: { spans: HTMLElement[] }[]): number {
    const root = readerRef.current
    if (!root || pageWords.length === 0) return 0
    const rootRect = root.getBoundingClientRect()
    const top = rootRect.top + Math.min(80, rootRect.height * 0.12)
    const bottom = rootRect.bottom - 24
    for (let i = 0; i < pageWords.length; i += 1) {
      const span = pageWords[i].spans[0]
      if (!span) continue
      const rect = span.getBoundingClientRect()
      if (rect.bottom >= top && rect.top <= bottom) return i
    }
    return 0
  }

  function resolveRsvpStartIndex(words: string[]): number {
    if (words.length === 0) return 0
    const selectedText = getSelectedReaderText()
    if (playbackStartMode === 'page-start') return 0
    if (playbackStartMode === 'selection' && selectedText) {
      return findPhraseStartIndex(words, selectedText)
    }
    const units = buildReadingOrderUnits(collectVisibleSpanBoxes())
    if (units.length === 0) {
      if (selectedText) return findPhraseStartIndex(words, selectedText)
      return 0
    }
    const pageWords = units.map(unit => ({
      spans: unit.spanKeys
        .map(spanKey => ttsSpanByKeyRef.current.get(spanKey))
        .filter((span): span is HTMLElement => Boolean(span)),
    }))
    const viewportIdx = findViewportStartIndex(pageWords)
    const phrase = units.slice(viewportIdx, viewportIdx + 5).map(unit => unit.text).join(' ')
    return findPhraseStartIndex(words, phrase)
  }

  function toggleRsvp() {
    setRsvpOpen(prev => !prev)
  }

  const prefetchGcpChunk = useCallback(async (queue: NonNullable<typeof gcpQueueRef.current>, chunkIndex: number) => {
    if (isEncrypted) return
    if (queue.aborted || chunkIndex >= queue.chunks.length) return
    if (queue.cache.has(chunkIndex) && queue.players.has(chunkIndex)) return
    const existing = queue.inflight.get(chunkIndex)
    if (existing) {
      await existing
      return
    }
    const controller = new AbortController()
    queue.abortControllers.push(controller)
    const chunk = queue.chunks[chunkIndex]
    const task = (async () => {
      try {
        if (!queue.cache.has(chunkIndex)) {
          const ssml = buildChunkSsml(chunk.text, chunk.voice, gcpVoices)
          const requestBodies = ssml
            ? [
              { ssml, voice: chunk.voice, rate: 1 },
              { text: chunk.text, voice: chunk.voice, rate: 1 },
            ]
            : [{ text: chunk.text, voice: chunk.voice, rate: 1 }]

          for (const body of requestBodies) {
            if (queue.aborted || queue.session !== ttsSessionRef.current) return
            const res = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: controller.signal,
            })
            if (!res.ok) continue
            const blob = await res.blob()
            if (queue.aborted || queue.session !== ttsSessionRef.current) return
            queue.cache.set(chunkIndex, URL.createObjectURL(blob))
            break
          }
        }

        const url = queue.cache.get(chunkIndex)
        if (!url || queue.players.has(chunkIndex)) return
        const audio = new Audio()
        audio.preload = 'auto'
        audio.src = url
        audio.playbackRate = Math.max(0.5, Math.min(2, speechRateRef.current))
        queue.players.set(chunkIndex, audio)
        await Promise.race([
          new Promise<void>(resolve => {
            if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
              resolve()
              return
            }
            const done = () => resolve()
            audio.addEventListener('canplaythrough', done, { once: true })
            audio.addEventListener('error', done, { once: true })
          }),
          new Promise<void>(resolve => setTimeout(resolve, 10000)),
        ])
      } catch {
        // Prefetch failures are handled when the chunk is needed for playback.
      } finally {
        queue.inflight.delete(chunkIndex)
      }
    })()
    queue.inflight.set(chunkIndex, task)
    await task
  }, [gcpVoices, isEncrypted])

  const playGcpChunk = useCallback(async (queue: NonNullable<typeof gcpQueueRef.current>, chunkIndex: number): Promise<boolean> => {
    if (queue.aborted || queue.session !== ttsSessionRef.current) return false
    if (chunkIndex >= queue.chunks.length) {
      setIsSpeaking(false)
      setIsTtsPaused(false)
      clearTtsHighlight()
      stopGcpQueue()
      return true
    }

    queue.index = chunkIndex
    const prefetchAhead = speechRateRef.current >= 1.5 ? 8 : 5
    for (let ahead = 0; ahead <= prefetchAhead; ahead += 1) {
      void prefetchGcpChunk(queue, chunkIndex + ahead)
    }

    setIsSpeaking(true)
    if (!queue.players.has(chunkIndex)) {
      for (let attempt = 0; attempt < 80 && !queue.aborted && queue.session === ttsSessionRef.current; attempt += 1) {
        await prefetchGcpChunk(queue, chunkIndex)
        if (queue.players.has(chunkIndex)) break
        await new Promise(resolve => setTimeout(resolve, 60))
      }
    }
    if (queue.aborted || queue.session !== ttsSessionRef.current) return false

    const audio = queue.players.get(chunkIndex)
    if (!audio) {
      return playGcpChunk(queue, chunkIndex + 1)
    }

    const chunk = queue.chunks[chunkIndex]
    const wordCount = chunk.endWord - chunk.startWord + 1
    let lastLocalIndex = -1
    let handedOff = false

    edgeAudioRef.current = audio
    audio.playbackRate = Math.max(0.5, Math.min(2, speechRateRef.current))
    setIsSpeaking(true)
    setIsTtsPaused(false)

    // Start immediately — next chunk may already be calling us during early handoff.
    const playStarted = audio.play().catch(() => false)

    const cleanupCurrent = () => {
      const url = queue.cache.get(chunkIndex)
      queue.players.delete(chunkIndex)
      queue.cache.delete(chunkIndex)
      if (url) URL.revokeObjectURL(url)
      audio.onended = null
      audio.ontimeupdate = null
      audio.onerror = null
      audio.onplaying = null
    }

    return await new Promise<boolean>(resolve => {
      const goNext = () => {
        if (handedOff) return
        handedOff = true
        audio.onended = null
        audio.ontimeupdate = null
        audio.onerror = null
        audio.onplaying = null
        // Kick next playback first, then tear down current to mask play() latency.
        const nextPlay = playGcpChunk(queue, chunkIndex + 1)
        try { audio.pause() } catch { /* ignore */ }
        cleanupCurrent()
        if (queue.aborted || queue.session !== ttsSessionRef.current) {
          resolve(false)
          return
        }
        void nextPlay.then(resolve)
      }

      audio.ontimeupdate = () => {
        if (queue.aborted || queue.session !== ttsSessionRef.current || handedOff) return
        const duration = audio.duration
        if (!Number.isFinite(duration) || duration <= 0) return
        const remaining = duration - audio.currentTime
        const localIdx = wordIndexAtProgress(wordCount, audio.currentTime / duration)
        if (localIdx >= 0 && localIdx !== lastLocalIndex) {
          for (let i = lastLocalIndex + 1; i <= localIdx; i += 1) {
            highlightTtsWordAt(chunk.startWord + i)
          }
          lastLocalIndex = localIdx
        }
        ttsPlaybackRef.current = {
          provider: 'google',
          timeMs: Math.round(audio.currentTime * 1000),
          durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : undefined,
          chunkStartWord: chunk.startWord,
          chunkEndWord: chunk.endWord,
        }

        void prefetchGcpChunk(queue, chunkIndex + 1)
        void prefetchGcpChunk(queue, chunkIndex + 2)
        const desired = Math.max(0.5, Math.min(2, speechRateRef.current))
        if (remaining < 1.2 && chunkIndex + 1 < queue.chunks.length && !queue.players.has(chunkIndex + 1)) {
          audio.playbackRate = Math.max(0.75, desired * 0.85)
        } else {
          audio.playbackRate = desired
        }

        const lead = Math.min(0.14, Math.max(0.05, 0.06 * desired))
        if (remaining <= lead && chunkIndex + 1 < queue.chunks.length && queue.players.has(chunkIndex + 1)) {
          goNext()
        }
      }

      audio.onplaying = () => {
        void prefetchGcpChunk(queue, chunkIndex + 1)
        void prefetchGcpChunk(queue, chunkIndex + 2)
        void prefetchGcpChunk(queue, chunkIndex + 3)
      }

      audio.onended = () => goNext()
      audio.onerror = () => goNext()

      void playStarted.then(ok => {
        if (ok === false) {
          setIsSpeaking(false)
          cleanupCurrent()
          resolve(false)
        }
      })
    })
  }, [prefetchGcpChunk])

  const speakTextGcp = useCallback(async (
    text: string,
    voice: string,
    units?: TtsWordUnit[],
    startWordIndex = 0,
  ) => {
    synth?.cancel()
    stopGcpQueue()
    clearTtsChunkPick()
    clearTtsHighlight()

    const planUnits = buildTtsPlaybackPlan(units)
    const allUnits = planUnits.length > 0
      ? planUnits
      : tokenizeTtsWords(joinHyphenatedBreaks(text)).map(token => ({
        text: token,
        normalized: token.toLowerCase(),
        spanKeys: [] as number[],
      }))

    const startWord = Math.max(0, Math.min(startWordIndex, Math.max(0, allUnits.length - 1)))
    const activeUnits = allUnits.slice(startWord)
    ttsHighlightCursorRef.current = startWord
    if (ttsPageWordsRef.current.length > 0) highlightTtsWordAt(startWord)

    const spokenText = activeUnits.map(unit => unit.text).join(' ').slice(0, 8000)
    speakingTextRef.current = spokenText

    // Larger chunks = fewer seams; early handoff needs fewer boundaries.
    const wordChunks = splitWordUnitsIntoChunks(activeUnits, 320).map(chunk => ({
      text: chunk.text,
      startWord: startWord + chunk.startWord,
      endWord: startWord + chunk.endWord,
      voice: resolveChunkVoice(gcpVoices, chunk.text, voice, language),
    }))

    if (wordChunks.length === 0) {
      setIsSpeaking(false)
      return false
    }

    const session = ++ttsSessionRef.current
    const queue = {
      session,
      chunks: wordChunks,
      index: 0,
      aborted: false,
      cache: new Map<number, string>(),
      players: new Map<number, HTMLAudioElement>(),
      inflight: new Map<number, Promise<void>>(),
      abortControllers: [] as AbortController[],
    }
    gcpQueueRef.current = queue
    setIsSpeaking(true)
    setIsTtsPaused(false)

    const warmCount = Math.min(wordChunks.length, speechRateRef.current >= 1.5 ? 8 : 5)
    for (let i = 0; i < warmCount; i += 1) void prefetchGcpChunk(queue, i)
    return playGcpChunk(queue, 0)
  }, [synth, prefetchGcpChunk, playGcpChunk, gcpVoices, language])

  const speakText = useCallback((text: string, units?: TtsWordUnit[], startWordIndex = 0) => {
    if (!synth) return
    stopGcpQueue()
    synth.cancel()
    clearTtsChunkPick()
    clearTtsHighlight()
    const planUnits = buildTtsPlaybackPlan(units)
    const allUnits = planUnits.length > 0
      ? planUnits
      : tokenizeTtsWords(joinHyphenatedBreaks(text)).map(token => ({
        text: token,
        normalized: token.toLowerCase(),
        spanKeys: [] as number[],
      }))
    const startWord = Math.max(0, Math.min(startWordIndex, Math.max(0, allUnits.length - 1)))
    const activeUnits = allUnits.slice(startWord)
    ttsHighlightCursorRef.current = startWord
    if (ttsPageWordsRef.current.length > 0) highlightTtsWordAt(startWord)
    const spokenText = activeUnits.map(unit => unit.text).join(' ')
    speakingTextRef.current = spokenText
    chunkOffsetRef.current = 0
    let spokenWordIndex = startWord - 1
    ttsPlaybackRef.current = { provider: 'browser' }

    const langVoice = getBestVoice(language)
    const maxLen = 4000
    let index = 0
    const speakChunk = () => {
      if (index >= spokenText.length) {
        setIsSpeaking(false)
        return
      }
      const chunk = spokenText.slice(index, index + maxLen)
      const utterance = new SpeechSynthesisUtterance(chunk)
      utterance.rate = speechRateRef.current
      utterance.lang = ttsLang
      if (langVoice) utterance.voice = langVoice
      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return
        spokenWordIndex += 1
        highlightTtsWordAt(spokenWordIndex)
      }
      utterance.onend = () => {
        index += maxLen
        chunkOffsetRef.current += maxLen
        speakChunk()
      }
      utterance.onerror = () => { setIsSpeaking(false); clearTtsHighlight() }
      setIsSpeaking(true)
      synth.speak(utterance)
    }
    speakChunk()
  }, [synth, speechRate, language, ttsLang, allVoices, selectedVoiceName])

  const stopSpeaking = useCallback(() => {
    ttsSessionRef.current += 1
    synth?.cancel()
    stopGcpQueue()
    clearTtsChunkPick()
    setIsSpeaking(false)
    setIsTtsPaused(false)
    setReadingCursor(cursor => createReadingCursor(currentPage, cursor.wordIndex, 'idle'))
    clearTtsHighlight()
  }, [currentPage, synth])

  const openAudioLinkedNote = useCallback(() => {
    const audioCursor = currentAudioCursor()
    if (!audioCursor) {
      toast(t('reader.audioNoteNoPosition'), 'info')
      return
    }
    setNoteEditor({ page: audioCursor.page, pageNote: false, initialContent: { audioCursor } })
    setRsvpOpen(false)
    setMobileToolCategory(null)
    setShowMoreTools(false)
  }, [readingCursor, t, toast])

  const pauseSpeaking = useCallback(() => {
    if (edgeAudioRef.current) {
      edgeAudioRef.current.pause()
      setIsSpeaking(false)
      setIsTtsPaused(true)
      return
    }
    if (synth?.speaking && !synth.paused) {
      synth.pause()
      setIsSpeaking(false)
      setIsTtsPaused(true)
    }
  }, [synth])

  const resumeSpeaking = useCallback(() => {
    if (edgeAudioRef.current) {
      void edgeAudioRef.current.play()
      setIsSpeaking(true)
      setIsTtsPaused(false)
      return
    }
    if (synth?.paused) {
      synth.resume()
      setIsSpeaking(true)
      setIsTtsPaused(false)
    }
  }, [synth])

  const ttsSessionActive = isSpeaking || isTtsPaused

  const isGcpVoice = selectedVoiceName.startsWith('gcp:')
  const useBrowserVoice = Boolean(selectedVoiceName) && !isGcpVoice

  function getVisiblePlaybackUnits(): TtsWordUnit[] {
    return buildReadingOrderUnits(collectVisibleSpanBoxes())
  }

  const speakPageTextFromWord = useCallback(async (startWordIndex = 0) => {
    const playbackPage = currentPageRef.current
    const units = getVisiblePlaybackUnits()
    let text = units.map(unit => unit.text).join(' ').slice(0, 8000)

    if (!text) {
      try {
        if (isEncrypted) {
          const model = await getEncryptedPageText(bookId, playbackPage)
          text = model?.text ? repairTurkishWordSpacing(joinHyphenatedBreaks(model.text)).slice(0, 8000) : ''
        } else {
          const res = await fetch(`/api/books/${bookId}/page-text?page=${playbackPage}`)
          const data = await res.json()
          text = typeof data?.text === 'string' ? repairTurkishWordSpacing(joinHyphenatedBreaks(data.text)).slice(0, 8000) : ''
        }
      } catch {
        text = ''
      }
    }

    if (!text) {
      const errText = 'Could not load page text.'
      if ((isEncrypted || useBrowserVoice) && synth) {
        speakText(errText)
        return
      }
      const autoVoice = resolveAutoGcpVoice(gcpVoices, errText, language)
      const voiceName = isGcpVoice
        ? selectedVoiceName.replace(/^gcp:\s*/, '')
        : autoVoice?.Name
      if (voiceName) {
        const ok = await speakTextGcp(errText, voiceName)
        if (!ok && synth) speakText(errText)
      } else if (synth) {
        speakText(errText)
      }
      return
    }

    if ((isEncrypted || useBrowserVoice) && synth) {
      speakText(text, units, startWordIndex)
      return
    }
    const autoVoice = resolveAutoGcpVoice(gcpVoices, text, language)
    const voiceName = isGcpVoice
      ? selectedVoiceName.replace(/^gcp:\s*/, '')
      : autoVoice?.Name
    if (voiceName) {
      const ok = await speakTextGcp(text, voiceName, units, startWordIndex)
      if (!ok && synth) speakText(text, units, startWordIndex)
      return
    }
    if (synth) speakText(text, units, startWordIndex)
  }, [synth, bookId, speakText, speakTextGcp, isEncrypted, isGcpVoice, useBrowserVoice, selectedVoiceName, gcpVoices, language])

  const enterTtsPickMode = useCallback((forceOpen = false) => {
    if (ttsPickMode && !forceOpen) {
      clearTtsChunkPick()
      return
    }
    const units = getVisiblePlaybackUnits()
    if (units.length === 0) {
      void speakPageTextFromWord(0)
      return
    }
    buildTtsPlaybackPlan(units)
    const chunks = splitWordUnitsIntoChunks(units, 320)
    clearTtsHighlight()
    clearTtsChunkPick()
    ttsPickChunksRef.current = chunks.map(chunk => ({
      startWord: chunk.startWord,
      endWord: chunk.endWord,
    }))
    setTtsChunksList(chunks)
    const rangeGroups: [Range[], Range[]] = [[], []]
    const registry = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void } }).highlights
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    const useRangeHighlights = Boolean(registry && HighlightConstructor)
    chunks.forEach((chunk, chunkIndex) => {
      const styleClass = chunkIndex % 2 === 0 ? 'tts-chunk-pick-a' : 'tts-chunk-pick-b'
      for (let word = chunk.startWord; word <= chunk.endWord; word += 1) {
        const pageWord = ttsPageWordsRef.current[word]
        if (!pageWord) continue
        if (useRangeHighlights && pageWord.ranges.length > 0) {
          rangeGroups[chunkIndex % 2].push(...pageWord.ranges.map(range => range.cloneRange()))
        } else {
          for (const span of pageWord.spans) {
            span.classList.add('tts-chunk-pick', styleClass)
            span.dataset.ttsChunk = String(chunkIndex)
          }
        }
      }
    })
    if (registry && HighlightConstructor) {
      registry.set('pdf-reader-tts-chunk-a', new HighlightConstructor(...rangeGroups[0]))
      registry.set('pdf-reader-tts-chunk-b', new HighlightConstructor(...rangeGroups[1]))
    }
    setTtsPickMode(true)
  }, [ttsPickMode, speakPageTextFromWord])

  const speakPageText = useCallback(() => {
    enterTtsPickMode()
  }, [enterTtsPickMode])

  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const askAi = useCallback(async () => {
    const q = aiQuestion.trim()
    if (!q) return
    setAiLoading(true)
    setAiAnswer('')
    if (isEncrypted) {
      setAiAnswer('Şifreli kitap içeriği gizliliğin için bulut AI hizmetine gönderilmez.')
      setAiLoading(false)
      return
    }
    try {
      const res = await fetch('/api/ask-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, question: q, currentPage }),
      })
      const data = await res.json()
      setAiAnswer(data.answer || 'No answer received.')
    } catch {
      setAiAnswer('Failed to reach the AI service.')
    } finally {
      setAiLoading(false)
    }
  }, [aiQuestion, bookId, currentPage, isEncrypted])

  const themeStyle = THEME_STYLES[theme]
  const activeTextModel = visiblePageTextModels[currentPage]
    || (pageTextModel?.page === currentPage ? pageTextModel.model : null)
  const readerShellStyle = {
    touchAction: 'pan-x pan-y',
    '--lib-accent': themeStyle.accent,
    '--reader-font-scale': fontScale,
    '--reader-line-height': lineHeight,
    '--reader-column-width': `${columnWidth}ch`,
  } as React.CSSProperties
  const togglePageNotes = useCallback(() => {
    setShowPageNotes(current => {
      const next = !current
      toast(t(next ? 'reader.pageNotesShown' : 'reader.pageNotesHidden'), 'info')
      return next
    })
  }, [t, toast])
  const displayBookTitle = cleanText(bookTitle || t('reader.titleFallback'))
  const displayBookAuthor = cleanText(bookAuthor)
  const notes = annotations.filter(item => item.type !== 'drawing')
  const drawingToolbarTop = focusMode ? (focusToolsVisible ? 56 : 12) : headerHeight + 12

  const existingPaths = useMemo(() => {
    return annotations.find(item => item.page === currentPage && item.type === 'drawing')?.content.paths || []
  }, [annotations, currentPage])

  const scaledExistingPaths = useMemo(() => {
    return existingPaths.map((path: DrawPath) => ({
      ...path,
      points: path.points.map((point: Point) => ({ ...point, x: point.x * scale, y: point.y * scale })),
      width: path.width * scale,
      fontSize: path.fontSize ? path.fontSize * scale : undefined,
    }))
  }, [existingPaths, scale])

  const existingPathsPage2 = useMemo(() => {
    return annotations.find(item => item.page === currentPage + 1 && item.type === 'drawing')?.content.paths || []
  }, [annotations, currentPage])

  const scaledExistingPathsPage2 = useMemo(() => {
    return existingPathsPage2.map((path: DrawPath) => ({
      ...path,
      points: path.points.map((point: Point) => ({ ...point, x: point.x * scale, y: point.y * scale })),
      width: path.width * scale,
      fontSize: path.fontSize ? path.fontSize * scale : undefined,
    }))
  }, [existingPathsPage2, scale])

  const textHighlights = useMemo(() => annotations.filter(item => item.type === 'highlight' && item.page === currentPage), [annotations, currentPage])
  const textHighlightsPage2 = useMemo(() => annotations.filter(item => item.type === 'highlight' && item.page === currentPage + 1), [annotations, currentPage])
  const latestHighlight = useMemo(() => (
    annotations
      .filter(item => item.type === 'highlight')
      .sort((a, b) => (new Date(b.created_at || 0).getTime() || b.id) - (new Date(a.created_at || 0).getTime() || a.id))[0]
  ), [annotations])

  const progressPercent = numPages ? Math.min(100, Math.round((currentPage / numPages) * 100)) : 0
  const pagesLeft = numPages ? Math.max(0, numPages - currentPage) : 0
  const pagesThisSession = Math.max(1, Math.abs(currentPage - sessionStartPage) + 1)
  const pagesThisSessionLabel = pageLabel(pagesThisSession)
  const pace = sidePanel === 'progress' && readingSeconds > 45 && pagesThisSession > 1 ? readingSeconds / pagesThisSession : null
  const savedPace = readingStats?.avg_seconds_per_page || null
  const effectivePace = pace || savedPace
  const etaMinutes = effectivePace ? Math.max(1, Math.round((pagesLeft * effectivePace) / 60)) : null
  const finishDays = effectivePace ? Math.ceil((pagesLeft * effectivePace) / 86400) : null
  const finishLabel = !finishDays ? '-' : finishDays <= 1 ? t('reader.finishToday') : t('reader.finishInDays', { days: finishDays })
  const avgPaceLabel = savedPace ? t('reader.minutesPerPage', { minutes: Math.max(0.1, Math.round((savedPace / 60) * 10) / 10) }) : '-'
  const lastSession = readingStats?.recent[0]
  const lastSessionLabel = lastSession ? new Date(lastSession.started_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : t('reader.noSessions')

  const deferredAnnotationSearch = useDeferredValue(annotationSearch)
  const filteredNotes = useMemo(() => {
    return filterAnnotations(annotations, {
      type: 'note',
      query: deferredAnnotationSearch,
      kind: noteKindFilter,
      tag: noteTagFilter,
      categoryId: noteCategoryFilter,
      currentPageOnly: notesCurrentPageOnly,
      currentPage,
      sort: noteSort,
    })
  }, [annotations, currentPage, deferredAnnotationSearch, noteCategoryFilter, noteKindFilter, noteSort, noteTagFilter, notesCurrentPageOnly])

  const filteredHighlights = useMemo(() => {
    const query = cleanText(deferredAnnotationSearch).toLocaleLowerCase(locale).trim()
    return annotations
      .filter(item => item.type === 'highlight')
      .filter(item => !query || cleanText(`${item.content.text || ''} ${item.content.note || ''}`).toLocaleLowerCase(locale).includes(query))
      .sort((a, b) => a.page - b.page)
  }, [annotations, deferredAnnotationSearch, locale])

  const availableNoteTags = useMemo(() => (
    normalizeAnnotationTags(annotations.flatMap(item => item.content.tags || []), 50)
  ), [annotations])

  const notePages = useMemo(() => Array.from(new Set(notes.map(item => item.page))), [notes])

  const loadReadingStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/sessions`)
      const data = await res.json()
      if (res.ok && data && Array.isArray(data.recent)) setReadingStats(data)
    } catch {}
  }, [bookId])

  useEffect(() => {
    const sharedSettings = {
      theme, scale, pageLayout, fitWidth, bigControls, showPageNotes,
      drawTool, drawColor, brushSize, drawOpacity, rotation, brightness,
      contrast, showThumbnailStrip, fontScale, lineHeight, columnWidth,
      readingRuler, focusLine, highContrast, eInkMode, readingDirection, reducedMotion, prefetchPages,
    }
    const bookSettings = {
      theme,
      scale,
      pageLayout,
      fitWidth,
      bigControls,
      currentPage,
      sidePanel,
      drawTool,
      drawColor,
      brushSize,
      drawOpacity,
      rotation,
      brightness,
      contrast,
      showThumbnailStrip,
      readingMode,
      rsvpWordIndex,
      ttsWordIndex,
      reflowScrollOffset,
      fontScale,
      lineHeight,
      columnWidth,
      readingRuler,
      focusLine,
      highContrast,
      eInkMode,
      readingDirection,
      reducedMotion,
      prefetchPages,
    }
    try {
      window.localStorage.setItem(THEME_STORAGE.reader, JSON.stringify(sharedSettings))
      window.localStorage.setItem(THEME_STORAGE.readerBook(bookId), JSON.stringify(bookSettings))
    } catch (e) {
      console.warn(e)
    }
  }, [bigControls, bookId, brightness, brushSize, columnWidth, contrast, currentPage, drawColor, drawOpacity, drawTool, eInkMode, fitWidth, focusLine, fontScale, highContrast, lineHeight, pageLayout, prefetchPages, readingDirection, readingMode, readingRuler, reducedMotion, reflowScrollOffset, rotation, rsvpWordIndex, scale, showPageNotes, showThumbnailStrip, sidePanel, theme, ttsWordIndex])

  useEffect(() => {
    function onAskAi() { setSidePanel('ask-ai') }
    window.addEventListener('opencode:ask-ai', onAskAi)
    return () => window.removeEventListener('opencode:ask-ai', onAskAi)
  }, [])

  useEffect(() => {
    if (isEncrypted) {
      void listEncryptedAnnotations(bookId).then(setAnnotations).catch(() => setAnnotations([]))
    } else {
      fetch(`/api/annotations?book_id=${bookId}`).then(res => res.json()).then(data => { if (Array.isArray(data)) setAnnotations(data) }).catch(() => {})
    }
    fetch('/api/annotation-categories').then(res => res.json()).then(data => { if (Array.isArray(data)) setAnnotationCategories(data) }).catch(() => {})
    if (isEncrypted) {
      void listEncryptedBookmarks(bookId).then(setBookmarks).catch(() => setBookmarks([]))
    } else {
      fetch(`/api/bookmarks?book_id=${bookId}`).then(res => res.json()).then(data => { if (Array.isArray(data)) setBookmarks(data) }).catch(() => {})
    }
    fetch(`/api/books/${bookId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ last_opened_at: new Date().toISOString() }) }).catch(() => {})
    const timer = window.setTimeout(() => {
      loadReadingStats()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [bookId, isEncrypted, loadReadingStats])

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    const main = readerRef.current
    if (!main) return

    const updateReaderWidth = () => setReaderWidth(Math.floor(main.getBoundingClientRect().width))
    const frame = window.requestAnimationFrame(updateReaderWidth)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateReaderWidth) : null
    observer?.observe(main)
    window.addEventListener('resize', updateReaderWidth)

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', updateReaderWidth)
    }
  }, [])


  useEffect(() => {
    if (!fitWidth || !pageSize.width || !readerWidth) return
    const frame = window.requestAnimationFrame(() => {
      const pagesShown = pageLayout === 'double' && currentPage < (numPages || currentPage) ? 2 : 1
      const gap = pagesShown > 1 ? 16 : 0
      const visualViewport = window.visualViewport
      const nextScale = calculateFitWidthScale({
        readerWidth,
        pageWidth: pageSize.width,
        pagesShown,
        gap,
        viewportWidth: Math.round(visualViewport?.width || window.innerWidth),
        viewportHeight: Math.round(visualViewport?.height || window.innerHeight),
        maxTouchPoints: navigator.maxTouchPoints || 0,
      })
      setScale(nextScale)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentPage, fitWidth, numPages, pageLayout, pageSize.width, readerWidth])

  useEffect(() => {
    if (focusMode) return

    const header = headerRef.current
    if (!header) return

    const updateHeaderHeight = () => {
      setHeaderHeight(Math.ceil(header.getBoundingClientRect().height))
    }

    const frame = window.requestAnimationFrame(updateHeaderHeight)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeaderHeight) : null
    observer?.observe(header)
    window.addEventListener('resize', updateHeaderHeight)

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', updateHeaderHeight)
    }
  }, [focusMode])

  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement && focusMode) {
        setFocusMode(false)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [focusMode])

  useEffect(() => {
    if (sidePanel === 'progress') {
      setReadingSeconds(readingSecondsRef.current)
    }
  }, [sidePanel])

  const saveReadingSession = useCallback((markSaved = true) => {
      if (sessionSavedRef.current) return
      const secs = readingSecondsRef.current
      if (secs > 5) {
        if (markSaved) sessionSavedRef.current = true
        fetch(`/api/books/${bookId}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_page: sessionStartPage,
            end_page: currentPageRef.current,
            pages_read: Math.max(1, Math.abs(currentPageRef.current - sessionStartPage) + 1),
            duration_seconds: secs,
            started_at: new Date(Date.now() - secs * 1000).toISOString(),
            ended_at: new Date().toISOString(),
          }),
          keepalive: true
        })
          .then(() => loadReadingStats())
          .catch(() => {})
      } else if (markSaved) {
        sessionSavedRef.current = true
      }
  }, [bookId, loadReadingStats, sessionStartPage])

  function stopReadingSession() {
    saveReadingSession(true)
    setSessionPaused(true)
    toast(t('reader.sessionStopped'), 'info')
  }

  function resumeReadingSession() {
    setSessionStartPage(currentPageRef.current)
    readingSecondsRef.current = 0
    setReadingSeconds(0)
    sessionSavedRef.current = false
    setSessionPaused(false)
  }

  useEffect(() => {
    const saveSession = () => saveReadingSession(true)
    window.addEventListener('beforeunload', saveSession)
    return () => {
      window.removeEventListener('beforeunload', saveSession)
      saveSession()
    }
  }, [saveReadingSession])

  const goToPage = useCallback((page: number) => {
    const nextPage = Math.max(1, Math.min(page, numPages || 9999))
    if (nextPage !== currentPageRef.current) {
      setReflowScrollOffset(0)
      setRsvpWordIndex(0)
      setTtsWordIndex(0)
      setReadingCursor(createReadingCursor(nextPage, 0, 'idle'))
    }
    setCurrentPage(nextPage)
    clearCanonicalSelection()
    onPageChange(nextPage)
  }, [clearCanonicalSelection, numPages, onPageChange])

  useEffect(() => {
    // Keep the visible input in sync after arrow keys/links move the page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPageInput(String(currentPage))
  }, [currentPage])

  const commitPageInput = useCallback((raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) {
      setPageInput(String(currentPage))
      return
    }
    const nextPage = Math.max(1, Math.min(parsed, numPages || 9999))
    setPageInput(String(nextPage))
    goToPage(nextPage)
  }, [currentPage, goToPage, numPages])

  useEffect(() => {
    if (!annotations.length) return
    const target = parseAnnotationDeepLink(window.location.href)
    if (!target || target.bookId !== Number(bookId)) return
    const annotation = annotations.find(item => item.id === target.annotationId)
    if (!annotation) return
    const frame = window.requestAnimationFrame(() => {
      goToPage(target.page)
      setFocusedAnnotationId(annotation.id)
      window.setTimeout(() => {
        readerRef.current?.querySelector(`[data-annotation-source="${annotation.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 350)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [annotations, bookId, goToPage])

  function clearDocSearchHighlight() {
    readerRef.current?.querySelectorAll('.pdf-search-highlight, .pdf-search-highlight-active').forEach(el => el.classList.remove('pdf-search-highlight', 'pdf-search-highlight-active'))
    const registry = typeof CSS === 'undefined'
      ? undefined
      : (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights
    registry?.delete('pdf-reader-search')
    registry?.delete('pdf-reader-search-active')
  }

  function highlightDocSearchOnPage(query: string, activeOccurrence = -1) {
    clearDocSearchHighlight()
    const normalized = normalizeSearchQuery(query)
    if (!normalized) return
    const pageRoot = readerRef.current?.querySelector(`.react-pdf__Page[data-page-number="${currentPage}"]`)?.parentElement
    const textLayer = pageRoot?.querySelector('.ocr-text-layer')
      || pageRoot?.querySelector('.react-pdf__Page__textContent')
    if (!textLayer) return
    const spans = Array.from(textLayer.querySelectorAll<HTMLElement>('span'))
    const searchRanges: Range[] = []
    const activeRanges: Range[] = []
    const highlightRegistry = typeof CSS === 'undefined'
      ? undefined
      : (CSS as unknown as {
          highlights?: { set: (name: string, value: unknown) => void }
        }).highlights
    const HighlightConstructor = (window as unknown as {
      Highlight?: new (...ranges: Range[]) => unknown
    }).Highlight
    const supportsRangeHighlights = Boolean(highlightRegistry && HighlightConstructor)
    let occurrenceCursor = 0
    let activeSpan: HTMLElement | null = null
    while (true) {
      const segments = mapTextMatchToSpanSegments(
        spans.map(span => span.textContent || ''),
        normalized,
        occurrenceCursor,
      )
      if (segments.length === 0) break
      for (const segment of segments) {
        const span = spans[segment.spanIndex]
        if (!span) continue
        const textNode = Array.from(span.childNodes).find(node => node.nodeType === Node.TEXT_NODE)
        if (supportsRangeHighlights && textNode) {
          const range = document.createRange()
          const maxOffset = textNode.textContent?.length || 0
          range.setStart(textNode, Math.min(segment.startOffset, maxOffset))
          range.setEnd(textNode, Math.min(segment.endOffset, maxOffset))
          searchRanges.push(range)
          if (occurrenceCursor === activeOccurrence) activeRanges.push(range.cloneRange())
        } else {
          span.classList.add('pdf-search-highlight')
        }
        if (occurrenceCursor === activeOccurrence) {
          if (!supportsRangeHighlights) span.classList.add('pdf-search-highlight-active')
          activeSpan ||= span
        }
      }
      occurrenceCursor += 1
    }
    if (supportsRangeHighlights && HighlightConstructor && highlightRegistry) {
      highlightRegistry.set('pdf-reader-search', new HighlightConstructor(...searchRanges))
      highlightRegistry.set('pdf-reader-search-active', new HighlightConstructor(...activeRanges))
    }
    if (activeSpan) {
      ;(activeSpan as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  const buildDocSearchIndex = useCallback(async (query: string) => {
    const normalized = normalizeSearchQuery(query)
    if (!normalized || normalized.length < 2 || !pdfDocRef.current?.getPage) {
      docSearchAbortRef.current?.abort()
      setDocSearchMatches([])
      setDocSearchIndex(0)
      return
    }

    const cacheKey = readerSearchCacheKey(bookId, query)
    const cached = docSearchCacheRef.current.get(cacheKey)
    if (cached) {
      setDocSearchMatches(cached)
      setDocSearchIndex(-1)
      return
    }

    docSearchAbortRef.current?.abort()
    const controller = new AbortController()
    docSearchAbortRef.current = controller
    setDocSearchLoading(true)
    try {
      const doc = pdfDocRef.current
      const totalPages = doc.numPages || numPages || 0
      const allMatches = await searchReaderDocument({
        query,
        pages: Array.from({ length: totalPages }, (_, index) => index + 1),
        signal: controller.signal,
        loadPage: async page => {
          let text = ''
          if (isEncrypted) {
            text = (await getEncryptedPageText(bookId, page))?.text || ''
          } else {
            const response = await fetch(`/api/books/${bookId}/page-text?page=${page}`, { signal: controller.signal })
            if (response.ok) {
              const data = await response.json()
              text = typeof data.text === 'string' ? data.text : ''
            }
          }
          if (!text) {
            const pdfPage = await doc.getPage?.(page)
            if (!pdfPage?.getTextContent) return ''
            const content = await pdfPage.getTextContent()
            text = buildPageText(content.items)
          }
          return text
        },
      })
      docSearchCacheRef.current.set(cacheKey, allMatches)
      setDocSearchMatches(allMatches)
      setDocSearchIndex(-1)
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        setDocSearchMatches([])
        setDocSearchIndex(-1)
      }
    } finally {
      if (docSearchAbortRef.current === controller) setDocSearchLoading(false)
    }
  }, [bookId, isEncrypted, numPages])

  const selectDocSearchResult = useCallback((index: number) => {
    if (index < 0 || index >= docSearchMatches.length) return
    const match = docSearchMatches[index]
    setDocSearchIndex(index)
    if (match) goToPage(match.page)
  }, [docSearchMatches, goToPage])

  const goToDocSearchMatch = useCallback((direction: 1 | -1) => {
    if (!docSearchMatches.length) return
    setDocSearchIndex(current => {
      const base = current < 0 ? (direction === 1 ? -1 : 0) : current
      const next = (base + direction + docSearchMatches.length) % docSearchMatches.length
      const match = docSearchMatches[next]
      if (match) goToPage(match.page)
      return next
    })
  }, [docSearchMatches, goToPage])

  useEffect(() => {
    if (!docSearchOpen) return
    const timer = window.setTimeout(() => { void buildDocSearchIndex(docSearchQuery) }, 250)
    return () => window.clearTimeout(timer)
  }, [buildDocSearchIndex, docSearchOpen, docSearchQuery])

  useEffect(() => {
    if (!docSearchOpen) {
      clearDocSearchHighlight()
      return
    }
    const activeMatch = docSearchIndex >= 0 ? docSearchMatches[docSearchIndex] : null
    const activeOccurrence = activeMatch && activeMatch.page === currentPage ? activeMatch.occurrenceOnPage : -1
    const timer = window.setTimeout(() => highlightDocSearchOnPage(docSearchQuery, activeOccurrence), 120)
    return () => window.clearTimeout(timer)
  }, [currentPage, docSearchOpen, docSearchQuery, scale, docSearchIndex, docSearchMatches])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.target instanceof Node) || !readerShellRef.current?.contains(event.target)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setDocSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    function onTogglePageNotes(event: KeyboardEvent) {
      if (
        event.target instanceof Node
        && readerShellRef.current?.contains(event.target)
        &&
        (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && event.key.toLowerCase() === 'n'
        && !isTypingTarget(event.target)
      ) {
        event.preventDefault()
        togglePageNotes()
      }
    }
    window.addEventListener('keydown', onTogglePageNotes)
    return () => window.removeEventListener('keydown', onTogglePageNotes)
  }, [togglePageNotes])

  useEffect(() => {
    if (!numPages || currentPage <= numPages) return
    const frame = window.requestAnimationFrame(() => goToPage(numPages))
    return () => window.cancelAnimationFrame(frame)
  }, [currentPage, goToPage, numPages])

  const goByStep = useCallback((direction: 1 | -1) => {
    goToPage(currentPage + direction * (pageLayout === 'double' ? 2 : 1))
  }, [currentPage, goToPage, pageLayout])

  const goByStepRef = useRef(goByStep)
  useEffect(() => { goByStepRef.current = goByStep }, [goByStep])

  const setManualScale = useCallback((updater: (value: number) => number) => {
    setFitWidth(false)
    setScale(value => clampScale(updater(value)))
  }, [])

  useEffect(() => {
    const eventStartedInReader = (event: Event) => {
      const reader = readerRef.current
      const target = event.target
      return !!(reader && target instanceof Node && reader.contains(target))
    }

    function claimReaderZoomEvent(event: Event) {
      event.preventDefault()
      event.stopPropagation()
    }

    function onWheelNative(event: WheelEvent) {
      if (!eventStartedInReader(event)) return
      if (!event.ctrlKey && !event.metaKey) return
      claimReaderZoomEvent(event)
      const factor = event.deltaY < 0 ? 1.08 : 0.92
      setManualScale(value => value * factor)
    }

    function onGestureStart(event: Event) {
      if (!eventStartedInReader(event)) return
      claimReaderZoomEvent(event)
      setFitWidth(false)
      pinchStartScale.current = scaleRef.current
      pinchZoomActive.current = true
      setIsPinching(false)
      setPinchScale(1)
    }

    function onGestureChange(event: Event) {
      if (!eventStartedInReader(event)) return
      claimReaderZoomEvent(event)
      const gestureScale = (event as WebKitGestureEvent).scale
      if (typeof gestureScale !== 'number' || !Number.isFinite(gestureScale) || gestureScale <= 0) return
      setFitWidth(false)
      setScale(clampScale(pinchStartScale.current * gestureScale))
    }

    function onGestureEnd(event: Event) {
      if (!eventStartedInReader(event)) return
      claimReaderZoomEvent(event)
      pinchZoomActive.current = false
      pinchStartScale.current = scaleRef.current
    }

    document.addEventListener('wheel', onWheelNative, { passive: false, capture: true })
    document.addEventListener('gesturestart', onGestureStart, { passive: false, capture: true })
    document.addEventListener('gesturechange', onGestureChange, { passive: false, capture: true })
    document.addEventListener('gestureend', onGestureEnd, { passive: false, capture: true })
    return () => {
      document.removeEventListener('wheel', onWheelNative, { capture: true })
      document.removeEventListener('gesturestart', onGestureStart, { capture: true })
      document.removeEventListener('gesturechange', onGestureChange, { capture: true })
      document.removeEventListener('gestureend', onGestureEnd, { capture: true })
    }
  }, [setManualScale])

  useEffect(() => {
    const syncTouchCount = (event: TouchEvent) => {
      touchActiveRef.current = event.touches.length
    }
    document.addEventListener('touchstart', syncTouchCount, { passive: true })
    document.addEventListener('touchend', syncTouchCount, { passive: true })
    document.addEventListener('touchcancel', syncTouchCount, { passive: true })
    return () => {
      document.removeEventListener('touchstart', syncTouchCount)
      document.removeEventListener('touchend', syncTouchCount)
      document.removeEventListener('touchcancel', syncTouchCount)
    }
  }, [])

  useEffect(() => {
    let tracking = false

    const touchPoint = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY })
    const centerOf = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    })
    const distanceOf = (touches: TouchList) => {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      return Math.hypot(dx, dy)
    }
    const eventStartedOnPdfPage = (event: TouchEvent) => {
      const reader = readerRef.current
      if (!reader) return false
      const target = event.target
      return target instanceof Element
        && reader.contains(target)
        && target.closest('.reader-pdf-page') !== null
    }
    let pinchRafId: number | null = null
    let pendingPinchScale: number | null = null

    const resetTouchGesture = () => {
      tracking = false
      swipeStart.current = null
      twoFingerCenter.current = null
      lastPinch.current = null
      pinchZoomActive.current = false
      pinchScaleRef.current = 1
      pinchStartScale.current = 1
      setIsPinching(false)
      setPinchScale(1)
    }

    function onTouchStart(event: TouchEvent) {
      if (!eventStartedOnPdfPage(event)) return
      if (event.touches.length === 1) {
        swipeStart.current = touchPoint(event.touches[0])
        return
      }
      if (event.touches.length !== 2) return

      tracking = true
      const center = centerOf(event.touches)
      swipeStart.current = center
      twoFingerCenter.current = center
      lastPinch.current = distanceOf(event.touches)
      pinchZoomActive.current = false
      pinchScaleRef.current = 1
      pinchStartScale.current = scaleRef.current
      setIsPinching(false)
      setPinchScale(1)
    }

    function onTouchMove(event: TouchEvent) {
      if (!tracking || event.touches.length !== 2 || lastPinch.current === null) return

      const center = centerOf(event.touches)
      const dist = distanceOf(event.touches)
      const delta = dist / lastPinch.current
      const start = swipeStart.current
      const centerTravel = start ? pointDistance(center, start) : 0
      const distanceTravel = Math.abs(dist - lastPinch.current)

      twoFingerCenter.current = center

      if (!pinchZoomActive.current) {
        const clearPinch = Math.abs(delta - 1) >= PINCH_ZOOM_THRESHOLD && distanceTravel > Math.max(8, centerTravel * 0.55)
        if (!clearPinch) return
        pinchZoomActive.current = true
        pinchStartScale.current = scaleRef.current
      }

      event.preventDefault()
      pinchScaleRef.current = delta
      setFitWidth(false)
      setIsPinching(false)
      setPinchScale(1)
      pendingPinchScale = Math.min(8, Math.max(0.5, +(pinchStartScale.current * delta).toFixed(2)))
      if (pinchRafId !== null) return
      pinchRafId = window.requestAnimationFrame(() => {
        pinchRafId = null
        if (pendingPinchScale !== null) {
          scaleRef.current = pendingPinchScale
          setScale(pendingPinchScale)
          pendingPinchScale = null
        }
      })
    }

    function onTouchEnd(event: TouchEvent) {
      if (!tracking) return
      if (event.touches.length >= 2) return

      const didZoom = pinchZoomActive.current
      const start = swipeStart.current
      const end = twoFingerCenter.current

      if (!didZoom && start && end) {
        const dx = end.x - start.x
        const dy = end.y - start.y
        if (Math.abs(dx) > TWO_FINGER_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx < 0) goByStepRef.current(1)
          else goByStepRef.current(-1)
        }
      }

      resetTouchGesture()
    }

    document.addEventListener('touchstart', onTouchStart, { passive: false })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', resetTouchGesture, { passive: true })

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', resetTouchGesture)
    }
  }, [])

  const enterFocusMode = useCallback(() => {
    setSidePanel(null)
    setMobileToolCategory(null)
    setFocusToolsVisible(true)
    setFocusMode(true)
    if (sessionPaused) resumeReadingSession()
  }, [sessionPaused])

  const exitFocusMode = useCallback(() => {
    setFocusMode(false)
    if (!sessionPaused) stopReadingSession()
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {})
    }
  }, [sessionPaused])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (rsvpOpen) return
      const target = e.target
      if (!(target instanceof Node) || !readerShellRef.current?.contains(target)) return
      if (isTypingTarget(target) || (target instanceof HTMLElement && target.closest('button, select, [role="dialog"]'))) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); goByStep(1) }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goByStep(-1) }
      if (e.key === 'Escape') {
        if (ttsPickMode) { clearTtsChunkPick(); e.preventDefault(); return }
        setPopup(null); setDrawMode(false); exitFocusMode()
      }
      if (e.key.toLowerCase() === 'f') {
        if (focusMode) exitFocusMode()
        else enterFocusMode()
      }
      if (e.key.toLowerCase() === 'd') { setDrawMode(value => !value); setPopup(null) }
      if (e.key.toLowerCase() === 'w') setFitWidth(value => !value)
      if (e.key === '1') setPageLayout('single')
      if (e.key === '2') setPageLayout(value => value === 'double' ? 'single' : 'double')
      if (e.key.toLowerCase() === 't') setBigControls(value => !value)
      if (e.key.toLowerCase() === 'r') { toggleRsvp(); e.preventDefault() }
      if (e.key === '+' || e.key === '=') setManualScale(value => Math.min(8, +(value + 0.15).toFixed(2)))
      if (e.key === '-') setManualScale(value => Math.max(0.5, +(value - 0.15).toFixed(2)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enterFocusMode, exitFocusMode, focusMode, goByStep, setManualScale, rsvpOpen, ttsPickMode])

  useEffect(() => {
    readerRef.current?.querySelectorAll('.tts-chunk-pick').forEach(el => {
      el.classList.remove('tts-chunk-pick', 'tts-chunk-pick-a', 'tts-chunk-pick-b')
      el.removeAttribute('data-tts-chunk')
    })
    const registry = (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights
    registry?.delete('pdf-reader-tts-active')
    registry?.delete('pdf-reader-tts-chunk-a')
    registry?.delete('pdf-reader-tts-chunk-b')
    ttsPickChunksRef.current = []
    const id = setTimeout(() => setTtsPickMode(false), 0)
    return () => clearTimeout(id)
  }, [currentPage])

  const resolveCanonicalPointerSelection = useCallback(() => {
    const interaction = selectionPointerRef.current
    const page = interaction.canonicalPage || interaction.modelPage
    if (!page) return null
    const model = visiblePageTextModels[page]
    if (!isCanonicalSelectionModelUsable(model)) return null
    const pageElement = readerRef.current?.querySelector<HTMLElement>(`.reader-pdf-page[data-page-number="${page}"]`)
    const pageRect = pageElement?.getBoundingClientRect()
    if (!pageElement || !pageRect || pageRect.width <= 0 || pageRect.height <= 0) return null
    const value = resolveCanonicalPdfSelection(model, {
      x: (interaction.startX - pageRect.left) / pageRect.width,
      y: (interaction.startY - pageRect.top) / pageRect.height,
    }, {
      x: (interaction.endX - pageRect.left) / pageRect.width,
      y: (interaction.endY - pageRect.top) / pageRect.height,
    }, rotation)
    return value ? { page, pageElement, pageRect, value } : null
  }, [rotation, visiblePageTextModels])

  const openCanonicalSelectionPopup = useCallback((resolved: {
    page: number
    pageRect: DOMRect
    value: CanonicalPdfSelection
  }, options: { mobilePlacement?: boolean; preserveNativeSelection?: boolean; anchorRect?: DOMRect | null } = {}) => {
    const { mobilePlacement = false, preserveNativeSelection = false, anchorRect = null } = options
    const displayRects = resolved.value.rects.map(rect => rotateNormalizedRect(rect, rotation))
    if (displayRects.length === 0) return
    const bounds = displayRects.reduce((acc, rect) => ({
      left: Math.min(acc.left, rect.left),
      top: Math.min(acc.top, rect.top),
      right: Math.max(acc.right, rect.left + rect.width),
      bottom: Math.max(acc.bottom, rect.top + rect.height),
    }), { left: 1, top: 1, right: 0, bottom: 0 })
    canonicalSelectionRef.current = { page: resolved.page, value: resolved.value }
    if (preserveNativeSelection) {
      // The platform is painting this selection and owns its drag handles.
      // Clearing the range or drawing our own overlay on top would freeze the
      // gesture on the word the reader first pressed.
      setCanonicalSelection(null)
    } else {
      setCanonicalSelection({ page: resolved.page, value: resolved.value })
      window.getSelection()?.removeAllRanges()
    }

    const isSmallPhoneViewport = mobilePlacement || isTouchSelectionSheetViewport(window.innerWidth, navigator.maxTouchPoints || 0, window.innerHeight)
    if (isSmallPhoneViewport) {
      setPopup({
        x: 12,
        y: Math.max(12, window.innerHeight - 430),
        text: resolved.value.text,
        page: resolved.page,
        rects: resolved.value.rects,
      })
      return
    }
    const toolbar = getSelectionToolbarPosition({
      selection: anchorRect ?? {
        left: resolved.pageRect.left + bounds.left * resolved.pageRect.width,
        top: resolved.pageRect.top + bounds.top * resolved.pageRect.height,
        width: Math.max(1, (bounds.right - bounds.left) * resolved.pageRect.width),
        height: Math.max(1, (bounds.bottom - bounds.top) * resolved.pageRect.height),
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      toolbarWidth: Math.min(608, window.innerWidth - 24),
      toolbarHeight: 44,
      gap: 12,
    })
    setPopup({
      x: toolbar.left,
      y: toolbar.top,
      text: resolved.value.text,
      page: resolved.page,
      rects: resolved.value.rects,
    })
  }, [rotation])

  const getCaretRangeAtPoint = useCallback((x: number, y: number) => {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y)
    const position = doc.caretPositionFromPoint?.(x, y)
    if (!position) return null
    const range = document.createRange()
    range.setStart(position.offsetNode, position.offset)
    range.collapse(true)
    return range
  }, [])

  const normalizeSelectionFromPointer = useCallback(() => {
    const interaction = selectionPointerRef.current
    if (!interaction.inTextLayer || interaction.endedAt === 0) return
    if (Date.now() - interaction.endedAt > 750) return
    const moved = Math.hypot(interaction.endX - interaction.startX, interaction.endY - interaction.startY)
    if (moved < 4) return

    // The text layer is aligned with the rendered glyphs, so the browser's own
    // selection is authoritative. Only fall back to rebuilding it from the two
    // pointer coordinates when the native selection failed to resolve to real
    // text inside a single text layer. Blindly overriding an already-correct
    // native selection is what re-introduces shifted / whole-chunk selections
    // (especially for touch drag-handle adjustments).
    const nativeSelection = window.getSelection()
    if (nativeSelection && nativeSelection.rangeCount > 0 && !nativeSelection.isCollapsed) {
      const nativeAnchor = nativeSelection.anchorNode
      const nativeFocus = nativeSelection.focusNode
      const nativeAnchorLayer = (nativeAnchor instanceof Element ? nativeAnchor : nativeAnchor?.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
      const nativeFocusLayer = (nativeFocus instanceof Element ? nativeFocus : nativeFocus?.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
      const nativeText = geometryAwareSelectionText(nativeSelection)
      const nativeIsUsable = !!nativeAnchorLayer
        && nativeAnchorLayer === nativeFocusLayer
        && nativeAnchor !== nativeAnchorLayer
        && nativeFocus !== nativeFocusLayer
        && nativeText.length > 1
      if (nativeIsUsable) return
    }

    const startRange = getCaretRangeAtPoint(interaction.startX, interaction.startY)
    const endRange = getCaretRangeAtPoint(interaction.endX, interaction.endY)
    if (!startRange || !endRange) return

    const startLayer = (startRange.startContainer instanceof Element ? startRange.startContainer : startRange.startContainer.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
    const endLayer = (endRange.startContainer instanceof Element ? endRange.startContainer : endRange.startContainer.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
    if (!startLayer || !endLayer || startLayer !== endLayer) return
    if (startRange.startContainer === startLayer || endRange.startContainer === endLayer) return

    const preciseRange = document.createRange()
    if (startRange.compareBoundaryPoints(Range.START_TO_START, endRange) <= 0) {
      preciseRange.setStart(startRange.startContainer, startRange.startOffset)
      preciseRange.setEnd(endRange.startContainer, endRange.startOffset)
    } else {
      preciseRange.setStart(endRange.startContainer, endRange.startOffset)
      preciseRange.setEnd(startRange.startContainer, startRange.startOffset)
    }

    const preciseText = cleanText(preciseRange.toString()).trim()
    if (preciseText.length <= 1 || preciseText.length > 450) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(preciseRange)
  }, [getCaretRangeAtPoint])

  async function addBookmark() {
    const existing = bookmarks.find(item => item.page === currentPage)
    if (existing) {
      if (isEncrypted) await deleteEncryptedBookmark(bookId, existing.id)
      else await fetch(`/api/bookmarks?id=${existing.id}`, { method: 'DELETE' })
      setBookmarks(prev => prev.filter(item => item.id !== existing.id))
      toast(t('reader.bookmarkRemoved'), 'info')
      return
    }
    const label = t('reader.pageOf', { current: currentPage, total: numPages || '?' })
    const bookmark = isEncrypted
      ? await saveEncryptedBookmark(bookId, currentPage, label)
      : await (async () => {
        const res = await fetch('/api/bookmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book_id: bookId, page: currentPage, label }),
        })
        return res.json() as Promise<BookmarkRow>
      })()
    setBookmarks(prev => [...prev, bookmark].sort((a, b) => a.page - b.page))
    toast(t('reader.bookmarkAdded'))
  }

  const openSelectionPopup = useCallback((mobilePlacement = false) => {
    if (drawMode) return
    // Rebuilding the range from pointer coordinates is a mouse-only fallback for
    // pages without a usable text model. Touch and stylus selections are driven
    // by platform gestures and must never be overwritten.
    if (selectionPointerRef.current.pointerType === 'mouse') normalizeSelectionFromPointer()
    const selection = window.getSelection()
    const text = geometryAwareSelectionText(selection)
    if (!selection || !text || text.length <= 1 || selection.rangeCount === 0) return

    const reader = readerRef.current
    const anchor = selection.anchorNode
    const focus = selection.focusNode
    if (!anchor || !focus) return
    const anchorInside = !!(reader && reader.contains(anchor))
    const focusInside = !!(reader && reader.contains(focus))
    if (!anchorInside || !focusInside) return

    const anchorPageElement = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest('[data-page-number]')
    const focusPageElement = (focus instanceof Element ? focus : focus.parentElement)?.closest('[data-page-number]')
    const anchorTextLayer = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
    const focusTextLayer = (focus instanceof Element ? focus : focus.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
    if (!anchorTextLayer || !focusTextLayer || anchorTextLayer !== focusTextLayer) return
    if (anchor === anchorTextLayer || focus === focusTextLayer) {
      selection.removeAllRanges()
      setPopup(null)
      return
    }
    if (!anchorPageElement || !focusPageElement || anchorPageElement !== focusPageElement) return

    const range = selection.getRangeAt(0)
    const pageElement = anchorPageElement
    const selectedPage = Number(pageElement?.getAttribute('data-page-number')) || currentPage
    const visiblePages = getVisiblePageNumbers(currentPage, pageLayout, numPages || currentPage)
    if (!visiblePages.includes(selectedPage)) return
    const pageRect = pageElement?.getBoundingClientRect()
    if (!pageRect || pageRect.width <= 0 || pageRect.height <= 0) return

    const rect = range.getBoundingClientRect()
    const rects = Array.from(range.getClientRects())
      .map(item => {
        const left = Math.max(item.left, pageRect.left)
        const right = Math.min(item.right, pageRect.right)
        const top = Math.max(item.top, pageRect.top)
        const bottom = Math.min(item.bottom, pageRect.bottom)
        return {
          left: (left - pageRect.left) / pageRect.width,
          top: (top - pageRect.top) / pageRect.height,
          width: (right - left) / pageRect.width,
          height: (bottom - top) / pageRect.height,
        }
      })
      .filter(item => item.width > 0.002 && item.height > 0.002)
    const mergedRects = mergeOverlappingHighlightRects(rects)
    if (mergedRects.length === 0) return
    const canonicalRects = rotation === 0
      ? mergedRects
      : mergedRects.map(item => rotateNormalizedRect(item, 360 - rotation))
    const union = mergedRects.reduce((acc, item) => ({
      left: Math.min(acc.left, item.left),
      top: Math.min(acc.top, item.top),
      right: Math.max(acc.right, item.left + item.width),
      bottom: Math.max(acc.bottom, item.top + item.height),
    }), { left: 1, top: 1, right: 0, bottom: 0 })
    const unionCoverage = Math.max(0, union.right - union.left) * Math.max(0, union.bottom - union.top)
    const textLayerText = cleanText(anchorTextLayer.textContent || '').trim()
    if (isOversizedPageSelection({
      text,
      textLayerText,
      rectsCount: mergedRects.length,
      unionCoverage,
      unionTop: union.top,
      unionBottom: union.bottom,
    })) {
      selection.removeAllRanges()
      setPopup(null)
      return
    }

    // Canonical word geometry gives clean copy text and highlight rects, but the
    // live selection stays exactly as the platform built it.
    const pageModel = visiblePageTextModels[selectedPage]
    if (isCanonicalSelectionModelUsable(pageModel)) {
      const canonicalFromRange = resolveCanonicalPdfSelectionFromRange(pageModel, range, pageRect, rotation)
      if (canonicalFromRange) {
        openCanonicalSelectionPopup({ page: selectedPage, pageRect, value: canonicalFromRange }, {
          mobilePlacement,
          preserveNativeSelection: true,
          anchorRect: rect,
        })
        return
      }
    }
    canonicalSelectionRef.current = null

    const isSmallPhoneViewport = mobilePlacement || isTouchSelectionSheetViewport(window.innerWidth, navigator.maxTouchPoints || 0, window.innerHeight)

    if (isSmallPhoneViewport) {
      setPopup({
        x: 12,
        y: Math.max(12, window.innerHeight - 430),
        text,
        page: selectedPage,
        rects: canonicalRects,
      })
      return
    }

    if (rect) {
      const toolbar = getSelectionToolbarPosition({
        selection: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        toolbarWidth: Math.min(608, window.innerWidth - 24),
        toolbarHeight: 44,
        gap: 12,
      })
      setPopup({ x: toolbar.left, y: toolbar.top, text, page: selectedPage, rects: canonicalRects })
    }
  }, [currentPage, drawMode, normalizeSelectionFromPointer, numPages, openCanonicalSelectionPopup, pageLayout, rotation, visiblePageTextModels])

  const handleMouseUp = useCallback(() => {
    openSelectionPopup(false)
  }, [openSelectionPopup])

  useEffect(() => {
    if (drawMode) return
    let timer: ReturnType<typeof setTimeout> | null = null

    let uiInteractionUntil = 0

    function markUiInteraction(event: Event) {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.selection-popover, [role="dialog"], .reader-toolbar, button, a, input, textarea, select')) {
        uiInteractionUntil = Date.now() + 1200
      }
    }

    function dismissSelectionPopup() {
      // Tapping an action button collapses the selection on touch platforms;
      // tearing the action bar down at that moment would swallow the tap.
      if (Date.now() < uiInteractionUntil) return
      if (canonicalSelectionRef.current) {
        canonicalSelectionRef.current = null
        setCanonicalSelection(null)
      }
      setPopup(current => (current ? null : current))
    }

    function scheduleSelectionPopup() {
      if (timer) clearTimeout(timer)
      const selection = window.getSelection()
      const reader = readerRef.current
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        // A collapsed selection means the reader tapped or clicked away, so the
        // action bar must not linger over text that is no longer selected.
        if (!selectionPointerRef.current.canonicalPage) {
          selectionVersionRef.current += 1
          dismissSelectionPopup()
        }
        return
      }
      const text = geometryAwareSelectionText(selection)
      if (!text || text.length <= 1) return

      const anchor = selection.anchorNode
      const focus = selection.focusNode
      if (!reader || !anchor || !focus || !reader.contains(anchor) || !reader.contains(focus)) return
      const anchorTextLayer = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
      const focusTextLayer = (focus instanceof Element ? focus : focus.parentElement)?.closest('.react-pdf__Page__textContent, .ocr-text-layer')
      if (!anchorTextLayer || !focusTextLayer || anchorTextLayer !== focusTextLayer || anchor === anchorTextLayer || focus === focusTextLayer) return

      const version = ++selectionVersionRef.current
      // While a finger is still down the reader is dragging the platform's
      // selection handles. Re-rendering then would collapse the selection, so
      // the action bar waits for the gesture to finish.
      if (touchActiveRef.current > 0) {
        pendingSelectionPopupRef.current = version
        return
      }
      pendingSelectionPopupRef.current = 0
      timer = setTimeout(() => {
        if (version === selectionVersionRef.current) openSelectionPopup(false)
      }, 80)
    }

    function runPendingSelectionPopup() {
      if (!pendingSelectionPopupRef.current) return
      pendingSelectionPopupRef.current = 0
      if (timer) clearTimeout(timer)
      const version = selectionVersionRef.current
      timer = setTimeout(() => {
        if (version === selectionVersionRef.current) openSelectionPopup(false)
      }, 60)
    }

    function preventNativeSelectionMenu(event: Event) {
      const reader = readerRef.current
      const target = event.target
      if (!(reader && target instanceof Node && reader.contains(target))) return
      // Chrome on Android cancels the long-press selection when its context
      // menu is suppressed, so only a mouse right click gets our own menu.
      const pointerType = (event as PointerEvent).pointerType
      const fromTouch = touchActiveRef.current > 0
        || pointerType === 'touch'
        || pointerType === 'pen'
        || (pointerType === undefined && selectionPointerRef.current.pointerType !== 'mouse')
      if (fromTouch) return
      const selection = window.getSelection()
      const text = cleanText(selection?.toString()).trim()
      if (text.length > 1) {
        event.preventDefault()
      }
    }

    document.addEventListener('selectionchange', scheduleSelectionPopup)
    document.addEventListener('contextmenu', preventNativeSelectionMenu)
    document.addEventListener('pointerdown', markUiInteraction, true)
    document.addEventListener('touchend', runPendingSelectionPopup, { passive: true })
    document.addEventListener('touchcancel', runPendingSelectionPopup, { passive: true })

    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('selectionchange', scheduleSelectionPopup)
      document.removeEventListener('contextmenu', preventNativeSelectionMenu)
      document.removeEventListener('pointerdown', markUiInteraction, true)
      document.removeEventListener('touchend', runPendingSelectionPopup)
      document.removeEventListener('touchcancel', runPendingSelectionPopup)
    }
  }, [drawMode, openSelectionPopup])

  useEffect(() => {
    function copyCorrectedReaderText(event: ClipboardEvent) {
      const reader = readerRef.current
      const canonical = canonicalSelectionRef.current
      if (reader && canonical?.value.text && readerShellRef.current?.contains(document.activeElement)) {
        if (!event.clipboardData) return
        event.preventDefault()
        event.clipboardData.setData('text/plain', canonical.value.text)
        return
      }
      const selection = window.getSelection()
      const anchor = selection?.anchorNode
      const focus = selection?.focusNode
      if (!reader || !anchor || !focus || !reader.contains(anchor) || !reader.contains(focus)) return
      const text = geometryAwareSelectionText(selection)
      if (!text || !event.clipboardData) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
    }
    document.addEventListener('copy', copyCorrectedReaderText)
    return () => document.removeEventListener('copy', copyCorrectedReaderText)
  }, [])


  const activeSavePromiseRef = useRef<Promise<unknown> | null>(null)
  const pendingSaveRef = useRef<{ paths: DrawPath[]; closeMode: boolean } | null>(null)

  async function saveDrawing(paths: DrawPath[], closeMode = true) {
    setIsSaving(true)
    if (activeSavePromiseRef.current) {
      pendingSaveRef.current = { paths, closeMode }
      return
    }

    const runSave = async (pathsToSave: DrawPath[], shouldClose: boolean) => {
      try {
        const existing = annotations.find(item => item.type === 'drawing' && item.page === currentPage)
        if (pathsToSave.length === 0) {
          if (existing) {
            if (isEncrypted) await deleteEncryptedAnnotation(bookId, existing.id)
            else await fetch(`/api/annotations?id=${existing.id}`, { method: 'DELETE' })
          }
          setAnnotations(prev => prev.filter(item => !(item.type === 'drawing' && item.page === currentPage)))
          if (shouldClose) setDrawMode(false)
          return
        }

        const annotation = isEncrypted
          ? await saveEncryptedAnnotation(bookId, {
            id: existing?.id,
            type: 'drawing',
            content: { paths: pathsToSave },
            page: currentPage,
          })
          : await (async () => {
            const res = await fetch('/api/annotations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ book_id: bookId, type: 'drawing', content: { paths: pathsToSave }, page: currentPage }),
            })
            const saved = await res.json()
            if (!res.ok || saved.error) throw new Error(saved.error || 'drawing save failed')
            return saved as Annotation
          })()
        setAnnotations(prev => [...prev.filter(item => !(item.type === 'drawing' && item.page === currentPage)), annotation])
        if (shouldClose) {
          setDrawMode(false)
          toast(t('reader.drawingSaved'))
        }
      } catch (err) {
        console.error("Save error:", err)
      } finally {
        if (pendingSaveRef.current) {
          const next = pendingSaveRef.current
          pendingSaveRef.current = null
          activeSavePromiseRef.current = runSave(next.paths, next.closeMode)
        } else {
          activeSavePromiseRef.current = null
          setIsSaving(false)
        }
      }
    }

    activeSavePromiseRef.current = runSave(paths, closeMode)
  }

  async function deleteAnnotation(id: number) {
    if (isEncrypted) await deleteEncryptedAnnotation(bookId, id)
    else await fetch(`/api/annotations?id=${id}`, { method: 'DELETE' })
    setAnnotations(prev => prev.filter(annotation => annotation.id !== id))
    setSelectedAnnotationIds(prev => prev.filter(item => item !== id))
  }

  async function bulkDeleteAnnotations() {
    const ids = [...selectedAnnotationIds]
    if (!ids.length) return
    await Promise.all(ids.map(id => deleteAnnotation(id).catch(() => undefined)))
    setSelectedAnnotationIds([])
    toast(t('reader.bulkAnnotationDeleted'), 'info')
  }

  async function bulkCategorizeAnnotations(categoryId: number | null) {
    const ids = [...selectedAnnotationIds]
    if (!ids.length) return
    try {
      const updates = annotations.filter(item => ids.includes(item.id)).map(async item => {
        const content = { ...item.content, categoryId }
        if (isEncrypted) return saveEncryptedAnnotation(bookId, { id: item.id, type: item.type, content, page: item.page })
        const response = await fetch('/api/annotations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, content }) })
        if (!response.ok) throw new Error('annotation category update failed')
        return response.json() as Promise<Annotation>
      })
      const saved = await Promise.all(updates)
      setAnnotations(current => current.map(item => saved.find(value => value.id === item.id) || item))
      toast(t('reader.bulkAnnotationUpdated'), 'info')
      setSelectedAnnotationIds([])
    } catch {
      toast(t('reader.bulkAnnotationFailed'), 'error')
    }
  }

  function openPageNoteEditor(page = currentPage) {
    setNoteEditor({ page, pageNote: true })
    setMobileToolCategory(null)
    setShowMoreTools(false)
  }

  function openAnnotationEditor(annotation: Annotation) {
    setNoteEditor({ annotation, page: annotation.page, pageNote: Boolean(annotation.content.pageNote) })
  }

  function startAreaNote() {
    setDrawMode(false)
    setPopup(null)
    setAreaSelectMode(true)
    setMobileToolCategory(null)
  }

  async function completeAreaNote(area: NonNullable<Annotation['content']['area']>, previewDataUrl: string) {
    setAreaSelectMode(false)
    setAreaUploadBusy(true)
    try {
      const canonicalArea = rotation === 0 ? area : rotateNormalizedRect(area, 360 - rotation)
      const previewUrl = isEncrypted
        ? await putEncryptedAnnotationPreview(bookId, previewDataUrl)
        : await (async () => {
          const res = await fetch('/api/annotation-assets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book_id: bookId, data_url: previewDataUrl }),
          })
          const data = await res.json()
          if (!res.ok || !data.previewUrl) throw new Error(data.error || 'area preview save failed')
          return data.previewUrl as string
        })()
      setNoteEditor({
        page: currentPage,
        pageNote: false,
        initialContent: {
          snapshot: {
            rect: canonicalArea,
            previewUrl,
            kind: 'region',
          },
        },
      })
    } catch (error) {
      console.error('[reader-area-note]', error)
      toast(t('reader.snapshotFailed'), 'error')
    } finally {
      setAreaUploadBusy(false)
    }
  }

  function startSourceCollection() {
    setSourceCollection([])
    setSourceCollectMode(true)
    setDrawMode(false)
    setMobileToolCategory(null)
  }

  function addCollectedSource(source: AnnotationSource) {
    setSourceCollection(current => {
      const key = `${source.page}:${cleanText(source.text || '')}:${JSON.stringify(source.rects || source.area || {})}`
      if (current.some(item => `${item.page}:${cleanText(item.text || '')}:${JSON.stringify(item.rects || item.area || {})}` === key)) return current
      return [...current, source]
    })
    toast(t('reader.sourceAdded'), 'info')
  }

  function createMultiSourceNote() {
    if (!sourceCollection.length) return
    setNoteEditor({
      page: sourceCollection[0].page,
      pageNote: false,
      initialContent: { sources: sourceCollection },
    })
    setSourceCollectMode(false)
  }

  function cancelSourceCollection() {
    setSourceCollectMode(false)
    setSourceCollection([])
  }

  async function saveAnnotationEditor(content: Partial<Annotation['content']>) {
    if (!noteEditor) return
    setNoteSaving(true)
    try {
      const isEdit = Boolean(noteEditor.annotation)
      const saved = isEncrypted
        ? await saveEncryptedAnnotation(bookId, {
          id: noteEditor.annotation?.id,
          type: 'note',
          content,
          page: noteEditor.page,
        })
        : await (async () => {
          const res = await fetch('/api/annotations', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit
          ? { id: noteEditor.annotation?.id, content }
          : { book_id: bookId, type: 'note', content, page: noteEditor.page }),
          })
          const value = await res.json()
          if (!res.ok || value.error) throw new Error(value.error || 'annotation save failed')
          return value as Annotation
        })()
      setAnnotations(current => (
        isEdit
          ? current.map(item => item.id === saved.id ? saved : item)
          : [...current, saved]
      ))
      if (content.audioNoteSessionId !== undefined && content.audioNoteTimestampMs !== undefined) {
        await audioRecorderRef.current?.attachAnnotationMarker(
          saved.id,
          content.audioNoteSessionId,
          content.audioNoteTimestampMs,
          content.audioNoteMarkerPage || noteEditor.page,
        ).catch(() => toast(t('reader.audioNotesUploadFailed'), 'error'))
      }
      setFocusedAnnotationId(saved.id)
      setNoteEditor(null)
    } finally {
      setNoteSaving(false)
    }
  }

  function openAudioRecordingNote(sessionId: number | string, timestampMs: number, markerPage: number) {
    setNoteEditor({
      page: markerPage,
      pageNote: false,
      initialContent: {
        audioNoteSessionId: sessionId,
        audioNoteTimestampMs: timestampMs,
        audioNoteMarkerPage: markerPage,
      },
    })
    setSidePanel(null)
  }

  function showAnnotationOnPage(annotation: Annotation, sourceIndex?: number) {
    const source = typeof sourceIndex === 'number' ? annotation.content.sources?.[sourceIndex] : undefined
    const targetPage = source?.page || annotation.page
    goToPage(targetPage)
    setFocusedAnnotationId(annotation.id)
    setSidePanel(null)
    window.setTimeout(() => {
      const element = readerRef.current?.querySelector(`[data-annotation-source="${annotation.id}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 350)
  }

  function resumeFromAudioNote(annotation: Annotation) {
    const cursor = normalizeAudioCursor(annotation.content.audioCursor)
    if (!cursor) return
    goToPage(cursor.page)
    setTtsWordIndex(cursor.wordIndex)
    setRsvpWordIndex(cursor.wordIndex)
    setReadingCursor(createReadingCursor(cursor.page, cursor.wordIndex, cursor.source))
    setSidePanel(null)
    if (cursor.source === 'rsvp') {
      setRsvpOpen(true)
      return
    }
    setRsvpOpen(false)
    window.setTimeout(() => { void speakPageTextFromWord(cursor.wordIndex) }, cursor.page === currentPage ? 0 : 350)
  }

  async function copyAnnotationLink(annotation: Annotation, sourceIndex?: number) {
    const source = typeof sourceIndex === 'number' ? annotation.content.sources?.[sourceIndex] : undefined
    const link = buildAnnotationDeepLink(bookId, source?.page || annotation.page, annotation.id, sourceIndex)
    const absolute = new URL(link, window.location.origin).toString()
    const copied = await copyTextToClipboard(absolute)
    toast(copied ? t('reader.linkCopied') : 'Bağlantı panoya kopyalanamadı.', copied ? 'info' : 'error')
  }

  async function undoLastHighlight() {
    if (!latestHighlight) return
    await deleteAnnotation(latestHighlight.id)
    toast(t('selection.highlightRemoved'), 'info')
  }

  async function deleteCurrentPageHighlights() {
    const pageHighlights = annotations.filter(item => item.type === 'highlight' && item.page === currentPage)
    if (!pageHighlights.length) return
    await Promise.all(pageHighlights.map(item => (
      isEncrypted
        ? deleteEncryptedAnnotation(bookId, item.id)
        : fetch(`/api/annotations?id=${item.id}`, { method: 'DELETE' }).then(() => undefined)
    )))
    setAnnotations(prev => prev.filter(item => !(item.type === 'highlight' && item.page === currentPage)))
    toast(t('selection.highlightRemoved'), 'info')
  }

  function unscaleDrawPath(path: DrawPath): DrawPath {
    return {
      ...path,
      points: path.points.map(point => ({ ...point, x: point.x / scale, y: point.y / scale })),
      width: path.width / scale,
      fontSize: path.fontSize ? path.fontSize / scale : undefined,
    }
  }

  function exportAnnotations() {
    const highlights = annotations.filter(item => item.type === 'highlight')
    const noteItems = annotations.filter(item => item.type === 'note')
    const lines = [
      '# PDF Reading Notes',
      '',
      `Book: ${displayBookTitle}`,
      `Exported: ${new Date().toLocaleString()}`,
      '',
      '## Highlights',
      ...highlights
        .sort((a, b) => a.page - b.page)
        .flatMap(item => [
          `### Page ${item.page}`,
          item.content.text ? `> ${cleanText(item.content.text)}` : '',
          cleanText(item.content.note || ''),
          '',
        ]),
      '## Notes',
      ...noteItems
        .sort((a, b) => a.page - b.page)
        .flatMap(item => [
          `### Page ${item.page}`,
          item.content.text ? `> ${cleanText(item.content.text)}` : '',
          cleanText(item.content.note || ''),
          '',
        ]),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pdf-notes-${bookId}.md`
    link.click()
    URL.revokeObjectURL(url)
    toast(t('reader.notesExported'), 'info')
  }

  function exportHighlightsJson() {
    const payload = {
      bookId,
      title: displayBookTitle,
      exportedAt: new Date().toISOString(),
      highlights: annotations
        .filter(item => item.type === 'highlight' || item.type === 'note')
        .map(item => ({
          id: item.id,
          type: item.type,
          page: item.page,
          text: cleanText(item.content.text || ''),
          note: cleanText(item.content.note || ''),
          createdAt: item.created_at || null,
        })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `pdf-highlights-${bookId}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast(t('reader.notesExported'), 'info')
  }

  function exportAnnotatedPdf() {
    if (isEncrypted) {
      toast('Şifreli kitaplar sunucu tabanlı PDF dışa aktarmaya gönderilmez. Notlarını yerel JSON/Markdown olarak dışa aktarabilirsin.', 'info')
      return
    }
    window.location.href = `/api/books/${bookId}/export`
  }

  async function renderPageForOcr(pageNumber: number) {
    const pdfPage = await pdfDocRef.current?.getPage?.(pageNumber)
    const fallbackCanvas = pageNumber === currentPage ? firstPageCanvasRef.current : secondPageCanvasRef.current
    if (!pdfPage) return fallbackCanvas

    const viewport = pdfPage.getViewport({
      scale: Math.max(2.4, Math.min(3.2, scale * 2.2)),
      rotation,
    })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return fallbackCanvas

    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await pdfPage.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise
    return canvas
  }

  async function getOcrWorker() {
    if (ocrWorkerRef.current) return ocrWorkerRef.current
    if (!ocrWorkerPromiseRef.current) {
      const Tesseract = await import('tesseract.js')
      const creationGeneration = ocrGenerationRef.current
      const creationPromise = Tesseract.createWorker('eng+tur', 1, {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/core',
        langPath: '/tesseract/lang',
        logger: () => {},
      }).then(async worker => {
        if (creationGeneration !== ocrGenerationRef.current) {
          await worker.terminate().catch(() => {})
          throw new DOMException('OCR cancelled', 'AbortError')
        }
        ocrWorkerRef.current = worker
        return worker
      }).finally(() => {
        if (ocrWorkerPromiseRef.current === creationPromise) ocrWorkerPromiseRef.current = null
      })
      ocrWorkerPromiseRef.current = creationPromise
    }
    return ocrWorkerPromiseRef.current
  }

  async function terminateOcrWorker() {
    ocrGenerationRef.current += 1
    const worker = ocrWorkerRef.current
    ocrWorkerRef.current = null
    ocrWorkerPromiseRef.current = null
    if (worker) await worker.terminate().catch(() => {})
  }

  async function recognizeCanvasLocally(canvas: HTMLCanvasElement, generation = ocrGenerationRef.current) {
    const run = async () => {
      if (generation !== ocrGenerationRef.current) throw new DOMException('OCR cancelled', 'AbortError')
      const worker = await getOcrWorker()
      if (generation !== ocrGenerationRef.current) throw new DOMException('OCR cancelled', 'AbortError')
      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      })
      const result = await worker.recognize(
        canvas,
        {},
        { text: true, tsv: true, blocks: true },
      )
      if (generation !== ocrGenerationRef.current) throw new DOMException('OCR cancelled', 'AbortError')
      return {
        text: result.data.text || '',
        tsv: result.data.tsv || '',
      }
    }
    const queued = ocrQueueRef.current.then(run, run)
    ocrQueueRef.current = queued.catch(() => {})
    return queued
  }

  useEffect(() => {
    // Page/rotation changes invalidate in-flight OCR geometry. Terminating the
    // shared worker is the only reliable way to stop Tesseract CPU work.
    void terminateOcrWorker()
    pageRecoveryJobsRef.current.clear()
  }, [currentPage, rotation])

  useEffect(() => () => {
    void terminateOcrWorker()
  }, [])

  async function persistPageTextModel(page: number, model: PageTextModel) {
    // Rotated OCR geometry is display-specific. Never let it replace the
    // canonical, unrotated cache (server or device-local).
    if (rotation !== 0) return
    if (isEncrypted) {
      await putEncryptedPageText(bookId, page, model)
      return
    }
    const response = await fetch(`/api/books/${bookId}/page-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, model }),
    })
    if (!response.ok) throw new Error(`page text cache failed: ${response.status}`)
  }

  async function recoverCurrentPageText(page: number) {
    const existing = pageRecoveryJobsRef.current.get(page)
    if (existing) return existing

    const job = (async () => {
      setPageTextRecoveryBusy(true)
      const generation = ocrGenerationRef.current
      try {
        const canvas = await renderPageForOcr(page)
        if (!canvas || generation !== ocrGenerationRef.current) return
        const result = await recognizeCanvasLocally(canvas, generation)
        const model = buildOcrPageTextModel(result.tsv, {
          width: canvas.width,
          height: canvas.height,
        }, {
          engine: 'tesseract.js',
          engineVersion: '7',
          languages: ['eng', 'tur'],
          dpi: 300,
          rotation,
        })
        if (!model.text.trim() || model.words.length === 0) return
        await persistPageTextModel(page, model)
        if (generation !== ocrGenerationRef.current) return
        setVisiblePageTextModels(current => ({ ...current, [page]: model }))
        if (page === currentPage) {
          setPageTextModel({ page, model })
          setReflowPageText({ page, text: model.text, blocks: model.blocks })
        }
      } catch (error) {
        if ((error as DOMException)?.name !== 'AbortError') {
          console.error('[reader-text-recovery]', error)
        }
      } finally {
        pageRecoveryJobsRef.current.delete(page)
        setPageTextRecoveryBusy(pageRecoveryJobsRef.current.size > 0)
      }
    })()
    pageRecoveryJobsRef.current.set(page, job)
    return job
  }

  useEffect(() => {
    let cancelled = false
    if (!pageRenderReady || pageTextModel?.page === currentPage) return

    void (async () => {
      try {
        const page = await pdfDocRef.current?.getPage?.(currentPage)
        if (!page?.getTextContent || cancelled) return
        const [content, viewport] = await Promise.all([
          page.getTextContent(),
          Promise.resolve(page.getViewport({ scale: 1, rotation: 0 })),
        ])
        if (cancelled) return
        const model = buildNativePageTextModel(content.items, viewport, {
          engine: 'pdfjs',
          engineVersion: pdfjs.version,
          rotation: 0,
        })
        setPageTextModel({ page: currentPage, model })
        setVisiblePageTextModels(current => ({ ...current, [currentPage]: model }))
        if (model.text.trim()) {
          setReflowPageText({ page: currentPage, text: model.text, blocks: model.blocks })
        }
        if (model.needsOcr) await recoverCurrentPageText(currentPage)
      } catch (error) {
        console.error('[reader-native-text-model]', error)
      }
    })()
    return () => { cancelled = true }
  }, [currentPage, pageRenderReady, pageTextModel, rotation])

  useEffect(() => {
    if (pageLayout !== 'double' || currentPage >= numPages || !secondPageRenderReady) return
    const pageNumber = currentPage + 1
    let cancelled = false
    void (async () => {
      try {
        if (isEncrypted) {
          const cached = await getEncryptedPageText(bookId, pageNumber)
          if (!cancelled && cached) {
            setVisiblePageTextModels(current => ({ ...current, [pageNumber]: cached }))
            return
          }
        }
        if (!isEncrypted && rotation === 0) {
          const response = await fetch(`/api/books/${bookId}/page-text?page=${pageNumber}`)
          if (response.ok) {
            const data = await response.json()
            const cached = data.model && typeof data.model === 'object' ? data.model as PageTextModel : null
            if (!cancelled && cached?.source === 'ocr') {
              setVisiblePageTextModels(current => ({ ...current, [pageNumber]: cached }))
              return
            }
          }
        }
        const page = await pdfDocRef.current?.getPage?.(pageNumber)
        if (!page?.getTextContent || cancelled) return
        const [content, viewport] = await Promise.all([
          page.getTextContent(),
          Promise.resolve(page.getViewport({ scale: 1, rotation: 0 })),
        ])
        if (cancelled) return
        const model = buildNativePageTextModel(content.items, viewport, {
          engine: 'pdfjs',
          engineVersion: pdfjs.version,
          rotation: 0,
        })
        setVisiblePageTextModels(current => ({ ...current, [pageNumber]: model }))
        if (model.needsOcr) await recoverCurrentPageText(pageNumber)
      } catch (error) {
        if (!cancelled && (error as DOMException)?.name !== 'AbortError') {
          console.error('[reader-second-page-text-model]', error)
        }
      }
    })()
    return () => { cancelled = true }
  }, [bookId, currentPage, isEncrypted, numPages, pageLayout, rotation, secondPageRenderReady])

  async function runOcrCurrentPage() {
    if (ocrBusy) return
    setOcrBusy(true)
    setOcrText('')
    try {
      const canvas = await renderPageForOcr(currentPage)
      if (!canvas) throw new Error('OCR canvas unavailable')
      const local = await recognizeCanvasLocally(canvas)
      const model = buildOcrPageTextModel(local.tsv, {
        width: canvas.width,
        height: canvas.height,
      }, {
        engine: 'tesseract.js',
        engineVersion: '7',
        languages: ['eng', 'tur'],
        dpi: 300,
        rotation,
      })
      if (!model.text.trim() || model.words.length === 0) {
        setOcrText(repairTurkishWordSpacing(cleanText(local.text).trim()) || 'OCR metin bulamadı.')
        return
      }
      await persistPageTextModel(currentPage, model)
      setPageTextModel({ page: currentPage, model })
      setReflowPageText({ page: currentPage, text: model.text, blocks: model.blocks })
      setOcrText(model.text)
    } catch (error) {
      console.error('[reader-ocr]', error)
      setOcrText('OCR çalıştırılamadı. Bağlantıyı ve sayfanın net göründüğünü kontrol et.')
    } finally {
      setOcrBusy(false)
    }
  }

  async function lockLibrary() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }

  async function setPageAsCover() {
    if (isEncrypted) {
      toast('Şifreli kitabın sayfa görüntüsü sunucuya kapak olarak yüklenmez.', 'info')
      return
    }
    const source = firstPageCanvasRef.current
    if (!source) return
    const canvas = document.createElement('canvas')
    const targetWidth = 280
    const ratio = targetWidth / source.width
    canvas.width = targetWidth
    canvas.height = Math.round(source.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const thumbnail = canvas.toDataURL('image/jpeg', 0.8)
    await fetch(`/api/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thumbnail }),
    })
    toast(t('reader.coverSaved'), 'info')
  }

  const readerCommands = useMemo(() => [
    { id: 'next-page', label: t('reader.nextPage'), scope: 'reader' as const, shortcut: '→', run: () => goToPage(currentPage + 1), keywords: ['ileri', 'next'] },
    { id: 'previous-page', label: t('reader.previousPage'), scope: 'reader' as const, shortcut: '←', run: () => goToPage(currentPage - 1), keywords: ['geri', 'previous'] },
    { id: 'continuous-mode', label: t('reader.continuousMode'), hint: t('reader.continuousModeHint'), scope: 'reader' as const, run: () => selectReadingMode('continuous'), keywords: ['scroll', 'akış'] },
    { id: 'pdf-mode', label: t('reader.pdfMode'), hint: t('reader.pdfModeHint'), scope: 'reader' as const, run: () => selectReadingMode('pdf'), keywords: ['canvas', 'tek sayfa'] },
    { id: 'reflow-mode', label: t('reader.reflowMode'), hint: t('reader.reflowModeHint'), scope: 'reader' as const, run: () => selectReadingMode('reflow'), keywords: ['text', 'metin', 'akışkan'] },
    { id: 'navigator', label: t('reader.navigator'), scope: 'reader' as const, run: () => setSidePanel('navigator'), keywords: ['outline', 'thumbnails', 'scrubber'] },
    { id: 'quality', label: t('reader.textQualityCenter'), scope: 'reader' as const, run: () => setSidePanel('quality'), keywords: ['ocr', 'quality', 'metin'] },
    { id: 'study', label: t('reader.studyCockpit'), scope: 'reader' as const, run: () => setSidePanel('study'), keywords: ['ai', 'dictionary', 'translate'] },
    { id: 'notes', label: t('reader.notesPanel'), scope: 'reader' as const, run: () => setSidePanel('notes'), keywords: ['annotation', 'highlight'] },
    { id: 'search', label: t('reader.docSearch.open'), scope: 'reader' as const, shortcut: '⌘F', run: () => setDocSearchOpen(true), keywords: ['find', 'ara'] },
    { id: 'rsvp', label: t('reader.rsvpToggle'), scope: 'reader' as const, run: toggleRsvp, keywords: ['speed', 'quick'] },
    { id: 'focus', label: t('reader.focusMode'), scope: 'reader' as const, run: enterFocusMode, keywords: ['fullscreen', 'zen'] },
    { id: 'ocr', label: t('reader.rebuildText'), scope: 'reader' as const, run: () => { void runOcrCurrentPage() }, keywords: ['scan', 'ocr'] },
    { id: 'reading-ruler', label: 'Toggle reading ruler', scope: 'reader' as const, run: () => setReadingRuler(value => !value), keywords: ['focus line', 'ergonomics'] },
  ], [currentPage, enterFocusMode, goToPage, selectReadingMode, t, toggleRsvp])

  useEffect(() => {
    function onCommandShortcut(event: KeyboardEvent) {
      if (!readerShellRef.current?.contains(event.target as Node)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !isTypingTarget(event.target)) {
        event.preventDefault()
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onCommandShortcut)
    return () => window.removeEventListener('keydown', onCommandShortcut)
  }, [])

  function themeLabel(item: ReaderTheme) {
    if (item === 'midnight') return t('reader.theme.dark')
    if (item === 'slate') return t('reader.theme.slate')
    if (item === 'paper') return t('reader.theme.light')
    if (item === 'sepia') return t('reader.theme.sepia')
    return THEME_STYLES[item].label
  }

  function renderThemePicker(large = false) {
    const CurrentIcon = THEME_STYLES[theme].icon
    const options: ReaderTheme[] = ['midnight', 'paper', 'sepia', 'seoul']
    return (
      <div className="relative shrink-0">
        <IconButton
          label={t('reader.theme', { name: themeLabel(theme) })}
          active={showThemePicker}
          onClick={() => setShowThemePicker(value => !value)}
          large={large}
          className={showThemePicker ? themeStyle.active : themeStyle.button}
        >
          <CurrentIcon size={16} />
        </IconButton>
        {showThemePicker && (
          <div className={`reader-floating-menu fixed inset-x-3 z-[300] w-auto rounded-2xl border p-1.5 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-40 ${themeStyle.panel}`}>
            {options.map(item => {
              const ThemeIcon = THEME_STYLES[item].icon
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setTheme(item)
                    setShowThemePicker(false)
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition ${theme === item ? themeStyle.active : themeStyle.button}`}
                >
                  <ThemeIcon size={14} />
                  <span>{themeLabel(item)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  function renderMoreTools(large = false) {
    const nextReadingMode: ReaderMode = readingMode === 'pdf' ? 'continuous' : readingMode === 'continuous' ? 'reflow' : 'pdf'
    const readingModeLabel = readingMode === 'pdf'
      ? t('reader.continuousMode')
      : readingMode === 'continuous'
        ? t('reader.reflowMode')
        : t('reader.pdfMode')
    return (
      <div className="relative shrink-0">
        <IconButton label={t('reader.moreTools')} active={showMoreTools} onClick={() => setShowMoreTools(value => !value)} large={large} className={showMoreTools ? themeStyle.active : themeStyle.button}>
          <MoreHorizontal size={17} />
        </IconButton>
        {showMoreTools && (
          <div className={`reader-floating-menu fixed inset-x-3 z-[300] grid w-auto grid-cols-2 gap-1 rounded-2xl border p-1.5 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-52 sm:grid-cols-1 ${themeStyle.panel}`}>
            <button onClick={() => { setPageLayout(value => value === 'double' ? 'single' : 'double'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs sm:hidden ${themeStyle.button}`}><Columns2 size={15} />{pageLayout === 'double' ? t('reader.singlePage') : t('reader.doublePage')}</button>
            <button
              type="button"
              aria-pressed={readingMode !== 'pdf'}
              onClick={() => { selectReadingMode(nextReadingMode); setShowMoreTools(false) }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${readingMode !== 'pdf' ? themeStyle.active : themeStyle.button}`}
            >
              <BookOpen size={15} />
              {readingModeLabel}
            </button>
            <button onClick={() => { setSidePanel(sidePanel === 'progress' ? null : 'progress'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs sm:hidden ${themeStyle.button}`}><SlidersHorizontal size={15} />{t('reader.progressPanel')}</button>
            <button onClick={() => { setSidePanel(sidePanel === 'navigator' ? null : 'navigator'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${sidePanel === 'navigator' ? themeStyle.active : themeStyle.button}`}><ListOrdered size={15} />{t('reader.navigator')}</button>
            <button onClick={() => { setSidePanel(sidePanel === 'quality' ? null : 'quality'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${sidePanel === 'quality' ? themeStyle.active : themeStyle.button}`}><Contrast size={15} />{t('reader.textQualityCenter')}</button>
            <button onClick={() => { setSidePanel(sidePanel === 'study' ? null : 'study'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${sidePanel === 'study' ? themeStyle.active : themeStyle.button}`}><SparklesIcon />{t('reader.studyCockpit')}</button>
            <button onClick={() => { closeAllOtherPanels('sidePanel'); setSidePanel(sidePanel === 'audio-notes' ? null : 'audio-notes'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${sidePanel === 'audio-notes' ? themeStyle.active : themeStyle.button}`}><Mic size={15} />{t('reader.audioNotes')}</button>
            <button onClick={() => { window.location.assign(`/compare?a=${bookId}`); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><Columns2 size={15} />Yan yana karşılaştır</button>
            <button onClick={() => { setSidePanel(sidePanel === 'notes' ? null : 'notes'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs sm:hidden ${themeStyle.button}`}><StickyNote size={15} />{t('reader.notesPanel')}</button>
            <button
              type="button"
              aria-pressed={showPageNotes}
              onClick={() => { togglePageNotes(); setShowMoreTools(false) }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${showPageNotes ? themeStyle.active : themeStyle.button}`}
            >
              {showPageNotes ? <Eye size={15} /> : <EyeOff size={15} />}
              <span className="min-w-0 flex-1">{t('reader.togglePageNotes')}</span>
              <kbd className={`rounded border px-1 py-0.5 text-[9px] ${themeStyle.subtle}`}>⌘⇧N</kbd>
            </button>
            <button onClick={() => { setSidePanel(sidePanel === 'highlights' ? null : 'highlights'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs sm:hidden ${themeStyle.button}`}><Highlighter size={15} />{t('reader.highlightsPanel')}</button>
            <button onClick={() => { setSidePanel(sidePanel === 'bookmarks' ? null : 'bookmarks'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs sm:hidden ${themeStyle.button}`}><PanelRightOpen size={15} />{t('reader.bookmarksPanel')}</button>
            <button onClick={() => { enterFocusMode(); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs sm:hidden ${themeStyle.button}`}><Maximize2 size={15} />{t('reader.focusMode')}</button>
            <button onClick={() => { setPageAsCover(); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><ImageIcon size={15} />{t('reader.setCover')}</button>
            <button onClick={() => { exportAnnotations(); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><Download size={15} />{t('reader.exportNotes')}</button>
            <button onClick={() => { exportHighlightsJson(); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><Download size={15} />{t('reader.exportHighlightsJson')}</button>
            <button onClick={() => { setDocSearchOpen(true); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><Search size={15} />{t('reader.docSearch.open')}</button>
            <button onClick={() => { exportAnnotatedPdf(); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><Download size={15} />{t('reader.annotatedDownload')}</button>
            <button onClick={() => { runOcrCurrentPage(); setShowMoreTools(false) }} disabled={ocrBusy || pageTextRecoveryBusy} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`} aria-label={t('reader.rebuildText')}><SparklesIcon />{t('reader.rebuildText')}</button>
            <button onClick={() => { toggleRsvp(); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${rsvpOpen ? themeStyle.active : themeStyle.button}`}>
              <svg width='15' height='15' viewBox='0 0 24 24' fill='currentColor'><path d='M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z'/></svg>
              {t('reader.rsvpToggle')}
            </button>
            <button onClick={() => { window.location.href = '/api/backup' }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><Archive size={15} />{t('reader.savedBackup')}</button>
            <button onClick={() => { setShowBugReport(true); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${themeStyle.button}`}><Bug size={15} />{t('bug.title')}</button>
            <button onClick={lockLibrary} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"><LogOut size={15} />{t('profile.logout')}</button>
            {pdfOutline.length > 0 && <button onClick={() => { setSidePanel(sidePanel === 'outline' ? null : 'outline'); setShowMoreTools(false) }} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs ${sidePanel === 'outline' ? themeStyle.active : themeStyle.button}`}><BookOpen size={15} />{t('reader.outline')}</button>}
          </div>
        )}
      </div>
    )
  }

  function mobileCategoryButton(category: 'view' | 'markup' | 'tools', icon: ReactNode, label: string) {
    const active = mobileToolCategory === category
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={() => {
          setSidePanel(null)
          setShowThemePicker(false)
          setShowMoreTools(false)
          setMobileToolCategory(active ? null : category)
        }}
        className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 py-1.5 text-[11px] font-semibold transition ${active ? themeStyle.active : themeStyle.button}`}
      >
        {icon}
        <span className="hidden sm:inline truncate">{label}</span>
      </button>
    )
  }

  function mobileSheetButton(label: string, icon: ReactNode, onClick: () => void, active = false, disabled = false) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`flex min-h-12 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold disabled:opacity-40 ${active ? themeStyle.active : themeStyle.button}`}
      >
        {icon}
        <span>{label}</span>
      </button>
    )
  }

  function readerModeButton(mode: ReaderMode, label: string, icon: ReactNode, hint: string) {
    const active = readingMode === mode
    return (
      <button
        type="button"
        aria-pressed={active}
        title={hint}
        onClick={() => selectReadingMode(mode)}
        className={`flex min-w-0 items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] font-semibold transition ${active ? themeStyle.active : themeStyle.button}`}
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </button>
    )
  }

  function renderCategoryItems(category: 'view' | 'markup' | 'tools', close: () => void) {
    if (category === 'view') {
      return (
        <>
          {mobileSheetButton(t('reader.zoomOut'), <ZoomOut size={16} />, () => setManualScale(value => Math.max(0.5, +(value - 0.15).toFixed(2))))}
          {mobileSheetButton(t('reader.zoomIn'), <ZoomIn size={16} />, () => setManualScale(value => Math.min(8, +(value + 0.15).toFixed(2))))}
          {mobileSheetButton(t('reader.fitWidth'), <Ruler size={16} />, () => setFitWidth(value => !value), fitWidth)}
          {mobileSheetButton(pageLayout === 'double' ? t('reader.singlePage') : t('reader.doublePage'), <Columns2 size={16} />, () => setPageLayout(value => value === 'double' ? 'single' : 'double'), pageLayout === 'double')}
          {mobileSheetButton(t('reader.tabletMode'), <TabletSmartphone size={16} />, () => setBigControls(value => !value), bigControls)}
          <div className={`col-span-2 mt-1 border-t pt-2 text-[11px] font-bold uppercase ${themeStyle.subtle}`}>{t('reader.theme', { name: '' })}</div>
          {(['midnight', 'paper', 'sepia', 'seoul'] as ReaderTheme[]).map(item => {
            const ThemeIcon = THEME_STYLES[item].icon
            return <div key={item}>{mobileSheetButton(themeLabel(item), <ThemeIcon size={16} />, () => setTheme(item), theme === item)}</div>
          })}
        </>
      )
    }
    if (category === 'markup') {
      return (
        <>
          {mobileSheetButton(t('reader.addPageNote'), <StickyNote size={16} />, () => { openPageNoteEditor(); close() })}
          {mobileSheetButton(t('reader.addSnapshot'), <ImageIcon size={16} />, () => { startAreaNote(); close() }, areaSelectMode, areaUploadBusy)}
          {mobileSheetButton(t('reader.multiSourceNote'), <Plus size={16} />, () => { startSourceCollection(); close() }, sourceCollectMode)}
          {mobileSheetButton(t('reader.notesPanel'), <StickyNote size={16} />, () => { setSidePanel(sidePanel === 'notes' ? null : 'notes'); close() }, sidePanel === 'notes')}
          {mobileSheetButton(t('reader.highlightsPanel'), <Highlighter size={16} />, () => { setSidePanel(sidePanel === 'highlights' ? null : 'highlights'); close() }, sidePanel === 'highlights')}
          {mobileSheetButton(t('reader.bookmarksPanel'), <PanelRightOpen size={16} />, () => { setSidePanel(sidePanel === 'bookmarks' ? null : 'bookmarks'); close() }, sidePanel === 'bookmarks')}
          {mobileSheetButton(t('reader.progressPanel'), <SlidersHorizontal size={16} />, () => { setSidePanel(sidePanel === 'progress' ? null : 'progress'); close() }, sidePanel === 'progress')}
          {mobileSheetButton(t('reader.navigator'), <ListOrdered size={16} />, () => { setSidePanel(sidePanel === 'navigator' ? null : 'navigator'); close() }, sidePanel === 'navigator')}
          {mobileSheetButton(t('reader.textQualityCenter'), <Contrast size={16} />, () => { setSidePanel(sidePanel === 'quality' ? null : 'quality'); close() }, sidePanel === 'quality')}
          {mobileSheetButton(t('reader.studyCockpit'), <SparklesIcon />, () => { setSidePanel(sidePanel === 'study' ? null : 'study'); close() }, sidePanel === 'study')}
          {mobileSheetButton(t('reader.audioNotes'), <Mic size={16} />, () => { setSidePanel(sidePanel === 'audio-notes' ? null : 'audio-notes'); close() }, sidePanel === 'audio-notes')}
          {pdfOutline.length > 0 && mobileSheetButton(t('reader.outline'), <BookOpen size={16} />, () => { setSidePanel(sidePanel === 'outline' ? null : 'outline'); close() }, sidePanel === 'outline')}
        </>
      )
    }
    return (
      <>
        <div className={`px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${themeStyle.subtle}`}>{t('reader.readingModeSection')}</div>
        <div className="grid grid-cols-3 gap-1">
          {readerModeButton('pdf', t('reader.pdfMode'), <FileText size={14} />, t('reader.pdfModeHint'))}
          {readerModeButton('continuous', t('reader.continuousMode'), <BookOpen size={14} />, t('reader.continuousModeHint'))}
          {readerModeButton('reflow', t('reader.reflowMode'), <AlignJustify size={14} />, t('reader.reflowModeHint'))}
        </div>
        <div className={`mt-1 border-t pt-2 px-2 text-[10px] font-bold uppercase tracking-[0.14em] ${themeStyle.subtle}`}>{t('reader.toolsSection')}</div>
        {mobileSheetButton(t('reader.togglePageNotes'), showPageNotes ? <Eye size={16} /> : <EyeOff size={16} />, () => { togglePageNotes(); close() }, showPageNotes)}
        {mobileSheetButton(sessionPaused ? t('reader.resumeSession') : t('reader.stopSession'), sessionPaused ? <Play size={16} /> : <Pause size={16} />, sessionPaused ? resumeReadingSession : stopReadingSession, sessionPaused)}
        {mobileSheetButton(t('reader.setCover'), <ImageIcon size={16} />, setPageAsCover)}
        {mobileSheetButton(t('reader.exportNotes'), <Download size={16} />, exportAnnotations)}
        {mobileSheetButton(t('reader.annotatedDownload'), <Download size={16} />, exportAnnotatedPdf)}
        {mobileSheetButton('OCR', <SparklesIcon />, runOcrCurrentPage, false, ocrBusy)}
        {mobileSheetButton(t('reader.docSearch.open'), <Search size={16} />, () => { setDocSearchOpen(true); close() }, docSearchOpen)}
        {mobileSheetButton(t('reader.commandPalette'), <ListOrdered size={16} />, () => { setCommandPaletteOpen(true); close() })}
        {mobileSheetButton(t('reader.exportHighlightsJson'), <Download size={16} />, exportHighlightsJson)}
        {ttsSessionActive
          ? mobileSheetButton(isTtsPaused ? t('reader.ttsResume') : t('reader.ttsPause'), isTtsPaused ? <Play size={16} /> : <Pause size={16} />, () => { if (isTtsPaused) resumeSpeaking(); else pauseSpeaking() }, true)
          : mobileSheetButton(ttsPickMode ? t('reader.ttsPickHint') : t('reader.tts'), <Volume2 size={16} />, speakPageText, ttsPickMode)}
        {ttsPickMode && mobileSheetButton(t('reader.ttsPickFromStart'), <Play size={16} />, () => { clearTtsChunkPick(); void speakPageTextFromWord(0) })}
        {ttsPickMode && mobileSheetButton(t('common.cancel'), <X size={16} />, clearTtsChunkPick)}
        {ttsSessionActive && mobileSheetButton('Bölüm Seç', <ListOrdered size={16} />, () => { enterTtsPickMode(true); close() }, ttsPickMode)}
        {ttsSessionActive && mobileSheetButton(t('reader.ttsStop'), <StopCircle size={16} />, stopSpeaking, true)}
        {ttsSessionActive && mobileSheetButton(t('reader.audioNoteAtPosition'), <StickyNote size={16} />, openAudioLinkedNote)}
        {ttsSessionActive && (
          <div className="col-span-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
            <span className={themeStyle.subtle}>{t('reader.ttsRate')}:</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={speechRate}
              onChange={e => {
                const next = Number(e.target.value)
                speechRateRef.current = next
                setSpeechRate(next)
                if (edgeAudioRef.current) {
                  edgeAudioRef.current.playbackRate = Math.max(0.5, Math.min(2, next))
                }
              }}
              className="flex-1"
            />
            <span className={themeStyle.subtle}>{speechRate.toFixed(1)}x</span>
          </div>
        )}
          <div className={`col-span-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${themeStyle.button}`}>
            <span className={themeStyle.subtle}>{t('reader.rsvpStart')}:</span>
            <select
              value={playbackStartMode}
              onChange={e => setPlaybackStartMode(e.target.value as TtsStartMode)}
              className="flex-1 bg-transparent border-0 outline-none text-xs text-right font-semibold cursor-pointer max-w-[170px] truncate text-inherit"
            >
              <option value="viewport" className="bg-[#101010] text-[#f8f8f8]">{t('reader.startViewport')}</option>
              <option value="selection" className="bg-[#101010] text-[#f8f8f8]">{t('reader.startSelection')}</option>
              <option value="page-start" className="bg-[#101010] text-[#f8f8f8]">{t('reader.startPage')}</option>
            </select>
          </div>
          <div className={`col-span-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${themeStyle.button}`}>
            <span className={themeStyle.subtle}>{t('reader.tts')}:</span>
            <select value={selectedVoiceName || ''} onChange={e => setSelectedVoiceName(e.target.value)} className="flex-1 bg-transparent border-0 outline-none text-xs text-right font-semibold cursor-pointer max-w-[170px] truncate text-inherit">
              <option value="" className="bg-[#101010] text-[#f8f8f8]">{t('reader.voiceAuto')}</option>
              {preferredGcpVoices.length > 0 && (
                <optgroup label={`--- ${t('reader.googleVoices')} ---`} className="bg-[#101010] text-[#f8f8f8]">
                  {preferredGcpVoices.map(v => (
                    <option key={v.Name} value={`gcp:${v.Name}`} className="bg-[#101010] text-[#f8f8f8]">🎧 {v.FriendlyName || v.Name}</option>
                  ))}
                </optgroup>
              )}
              {otherGcpVoices.length > 0 && (
                <optgroup label={`--- ${t('reader.allLanguages')} ---`} className="bg-[#101010] text-[#f8f8f8]">
                  {otherGcpVoices.map(v => (
                    <option key={v.Name} value={`gcp:${v.Name}`} className="bg-[#101010] text-[#f8f8f8]">🎧 {v.FriendlyName || v.Name}</option>
                  ))}
                </optgroup>
              )}
              {langVoices.length > 0 && (
                <optgroup label={`--- ${t('reader.browserVoices')} ---`} className="bg-[#101010] text-[#f8f8f8]">
                  {langVoices.map(v => <option key={v.name} value={v.name} className="bg-[#101010] text-[#f8f8f8]">{v.name.replace(/\(.*?\)/g,'').trim()}</option>)}
                </optgroup>
              )}
            </select>
          </div>
        {mobileSheetButton(t('reader.askAi'), <SparklesIcon />, () => { setSidePanel(sidePanel === 'ask-ai' ? null : 'ask-ai'); setMobileToolCategory(null) }, sidePanel === 'ask-ai')}
        {mobileSheetButton('Yan yana karşılaştır', <Columns2 size={16} />, () => window.location.assign(`/compare?a=${bookId}`))}
        {mobileSheetButton(t('reader.savedBackup'), <Archive size={16} />, () => { window.location.href = '/api/backup' })}
        <div className="col-span-2 w-full">
          <LanguageSwitcher
            compact
            className="w-full justify-between"
            isDark={theme !== 'seoul' && theme !== 'paper'}
            buttonClass={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${themeStyle.button}`}
            panelClass={`language-floating-menu fixed inset-x-3 z-[400] overflow-hidden rounded-lg border p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.72)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-40 ${themeStyle.panel}`}
          />
        </div>
        {mobileSheetButton(t('profile.logout'), <LogOut size={16} />, lockLibrary)}
        {mobileSheetButton(t('bug.title'), <Bug size={16} />, () => { setShowBugReport(true); setMobileToolCategory(null) })}
        {!loadError && mobileSheetButton(t('reader.nativeViewer'), <ExternalLink size={16} />, () => setForceNativeViewer(true))}
      </>    
    )
  }

  function renderDesktopCategory(category: 'view' | 'markup' | 'tools', icon: ReactNode, label: string) {
    const active = mobileToolCategory === category
    return (
      <div className="relative hidden shrink-0 sm:block">
        <button type="button" onClick={() => { setSidePanel(null); setMobileToolCategory(active ? null : category) }} className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${active ? themeStyle.active : themeStyle.button}`}>
          {icon}<span>{label}</span><ChevronDown size={13} className={active ? 'rotate-180' : ''} />
        </button>
        {active && (
          <div
            className={`absolute right-0 top-full z-[300] mt-2 border p-1.5 shadow-2xl ${themeStyle.panel} ${
              category === 'tools'
                ? 'reader-tool-menu flex max-h-[min(70dvh,40rem)] flex-col gap-1 overflow-y-auto overscroll-contain pr-1 w-[20rem] rounded-2xl menu-pop'
                  : category === 'markup'
                  ? 'flex flex-col gap-1 w-64 rounded-2xl menu-pop'
                  : 'grid w-64 grid-cols-2 gap-1 rounded-2xl menu-pop'
            }`}
          >
            {renderCategoryItems(category, () => setMobileToolCategory(null))}
          </div>
        )}
      </div>
    )
  }

  function renderMobileCategorySheet() {
    if (!mobileToolCategory) return null
    return (
      <div className="fixed inset-0 z-[250] sm:hidden" onClick={() => setMobileToolCategory(null)}>
        <div className="absolute inset-0 bg-black/45" />
        <div className={`mobile-reader-sheet absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-2xl border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-20px_70px_rgba(0,0,0,0.55)] sheet-enter ${themeStyle.panel}`} onClick={event => event.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <p className={`text-sm font-bold ${themeStyle.text}`}>
              {mobileToolCategory === 'view' ? t('reader.category.view') : mobileToolCategory === 'markup' ? t('reader.category.markup') : t('reader.category.tools')}
            </p>
            <button type="button" onClick={() => setMobileToolCategory(null)} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.close')}><X size={16} /></button>
          </div>

          <div className={`grid gap-2 ${mobileToolCategory === 'view' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {renderCategoryItems(mobileToolCategory, () => setMobileToolCategory(null))}
          </div>
        </div>
      </div>
    )
  }

  function renderContinuousPage(page: number) {
    const size = pageSizes[page]
    const pageHighlights = annotations.filter(item => item.type === 'highlight' && item.page === page)
    const pageNotes = annotations.filter(item => item.type === 'note' && (item.page === page || item.content.sources?.some(source => source.page === page)))
    const paths = annotations.find(item => item.type === 'drawing' && item.page === page)?.content.paths || []
    const scaledPaths = paths.map(path => ({
      ...path,
      points: path.points.map(point => ({ ...point, x: point.x * scale, y: point.y * scale })),
      width: path.width * scale,
      fontSize: path.fontSize ? path.fontSize * scale : undefined,
    }))
    return (
      <div
        className={`relative inline-block max-w-full ${visiblePageTextModels[page]?.source === 'ocr' ? 'ocr-selection-active' : ''}`}
        style={{
          width: size?.width ? Math.round(size.width * scale) : 'auto',
          height: size?.height ? Math.round(size.height * scale) : 'auto',
        }}
      >
        <Page
          pageNumber={page}
          scale={scale}
          rotate={rotation}
          className="reader-pdf-page overflow-hidden rounded-sm shadow-[0_22px_90px_rgba(0,0,0,0.4)]"
          renderAnnotationLayer
          renderTextLayer
          onLoadSuccess={pdfPage => {
            const viewport = pdfPage.getViewport({ scale: 1, rotation })
            setPageSizes(current => ({ ...current, [page]: { width: viewport.width, height: viewport.height } }))
            if (page === currentPage) setPageSize({ width: viewport.width, height: viewport.height })
          }}
          onRenderSuccess={() => { if (page === currentPage) setPageRenderReady(value => value + 1) }}
          onRenderTextLayerSuccess={() => {
            window.setTimeout(() => normalizePdfTextLayerReadingOrder(readerRef.current?.querySelector(`[data-page-number="${page}"] .react-pdf__Page__textContent`) || null), 80)
          }}
        />
        {visiblePageTextModels[page]?.source === 'ocr' && (
          <OcrTextLayer model={visiblePageTextModels[page]} label={t('reader.ocrSelectionLayer')} page={page} />
        )}
        <CanonicalSelectionOverlay selection={canonicalSelection?.page === page ? canonicalSelection.value : null} rotation={rotation} color={themeStyle.accent} />
        <MemoTextHighlightOverlay annotations={pageHighlights} onDelete={deleteAnnotation} rotation={rotation} />
        {showPageNotes && (
          <MemoInlineNoteOverlay annotations={pageNotes} themeStyle={themeStyle} focusedId={focusedAnnotationId} page={page} rotation={rotation} />
        )}
        {!drawMode && scaledPaths.length > 0 && size?.width && (
          <DrawingOverlay width={Math.round(size.width * scale)} height={Math.round(size.height * scale)} paths={scaledPaths} />
        )}
      </div>
    )
  }

  const returnToPdfJsReader = useCallback(() => {
    setForceNativeViewer(false)
    setLoadError(false)
    onForceRefresh?.()
  }, [onForceRefresh])

  if (forceNativeViewer) {
    return (
      <div data-reader-theme={theme} className={`flex h-full flex-col overflow-hidden ${themeStyle.shell}`} style={readerShellStyle}>
        <div className={`flex items-center gap-2 border-b px-3 py-2 ${themeStyle.header}`}>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className={`rounded-lg border p-2 ${themeStyle.button}`}><ChevronLeft size={18} /></button>
          <input type="number" min={1} max={numPages || undefined} value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={e => commitPageInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitPageInput(e.currentTarget.value) }} className="w-16 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-center text-sm outline-none" aria-label="Sayfaya git" />
          <button onClick={() => goToPage(currentPage + 1)} className={`rounded-lg border p-2 ${themeStyle.button}`}><ChevronRight size={18} /></button>
          <span className="text-xs text-amber-300">{t('reader.nativeViewer')}</span>
          <button onClick={returnToPdfJsReader} className="ml-1 rounded bg-violet-500/20 px-2 py-0.5 text-[11px] font-semibold text-violet-300 hover:bg-violet-500/30 transition">
            {t('reader.returnToPdfJs')}
          </button>
          <a href={resolvedRawFileUrl || resolvedFileUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-blue-300 underline">{t('reader.openPdf')}</a>
        </div>
        <div className="relative flex-1 overflow-hidden">
          <iframe src={`${resolvedRawFileUrl || resolvedFileUrl}#page=${currentPage}`} title="PDF" className="absolute inset-0 h-full w-full border-0" />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={readerShellRef}
      data-reader-theme={theme}
      data-reader-mode={readingMode}
      data-reader-high-contrast={highContrast ? 'true' : 'false'}
      data-reader-eink={eInkMode ? 'true' : 'false'}
      className={`reader-v3-shell flex h-full flex-col overflow-hidden ${themeStyle.shell} ${reducedMotion ? 'reader-reduced-motion' : ''}`}
      style={readerShellStyle}
      tabIndex={-1}
      onPointerDownCapture={event => {
        const target = event.target
        if (target instanceof Element && !target.closest('input, textarea, select, button, [contenteditable="true"]')) {
          readerShellRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      <ReaderCommandPalette
        open={commandPaletteOpen}
        commands={readerCommands}
        themeStyle={themeStyle}
        title={t('reader.commandPalette')}
        placeholder={t('reader.commandPlaceholder')}
        emptyLabel={t('reader.noCommands')}
        onClose={() => setCommandPaletteOpen(false)}
      />
      <div className="pointer-events-none fixed right-3 top-[max(4rem,env(safe-area-inset-top))] z-[120]">
        <ReaderOfflineStatus themeStyle={themeStyle} syncPending={conflicts.length} prefetching={prefetching} onRetry={() => { void triggerSync() }} />
      </div>
      <AudioNoteRecorder
        ref={audioRecorderRef}
        bookId={bookId}
        page={currentPage}
        isEncrypted={isEncrypted}
        open={sidePanel === 'audio-notes'}
        themeStyle={themeStyle}
        onClose={() => setSidePanel(null)}
        onGoToPage={goToPage}
        onOpenAnnotation={annotationId => {
          const annotation = annotations.find(item => item.id === annotationId)
          if (annotation) showAnnotationOnPage(annotation)
        }}
        onOpenNoteAtMarker={openAudioRecordingNote}
      />
      {(readingRuler || focusLine) && rulerY > 0 && (
        <div
          className={`pointer-events-none fixed inset-x-0 z-[90] ${readingRuler ? 'h-8 -translate-y-1/2 border-y border-amber-200/25 bg-amber-200/[0.06]' : 'h-px bg-amber-300/80 shadow-[0_0_18px_rgba(251,191,36,0.8)]'}`}
          style={{ top: rulerY }}
          aria-hidden="true"
        />
      )}
      {/* Next's CSS optimizer currently drops the standards-based ::highlight()
          rules. Keeping them in the rendered document preserves exact range
          painting without giving search/TTS ownership of the text-layer DOM. */}
      <style>{`
        ::highlight(pdf-reader-search) {
          background: rgba(229, 9, 20, 0.28);
          color: transparent;
        }
        ::highlight(pdf-reader-search-active) {
          background: rgba(255, 176, 32, 0.62);
          color: transparent;
          text-decoration: underline 1px rgba(255, 176, 32, 0.9);
        }
        ::highlight(pdf-reader-tts-active) {
          background: rgba(250, 204, 21, 0.72);
          color: transparent;
          text-decoration: underline 1px rgba(250, 204, 21, 0.95);
        }
        ::highlight(pdf-reader-tts-chunk-a) {
          background: rgba(229, 9, 20, 0.18);
          color: transparent;
        }
        ::highlight(pdf-reader-tts-chunk-b) {
          background: rgba(37, 99, 235, 0.17);
          color: transparent;
        }
        .reader-reduced-motion *,
        .reader-reduced-motion *::before,
        .reader-reduced-motion *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }
        .reader-v3-shell[data-reader-high-contrast="true"] .react-pdf__Page__textContent span,
        .reader-v3-shell[data-reader-high-contrast="true"] .ocr-text-layer span {
          text-shadow: 0 0 1px currentColor;
        }
        .reader-v3-shell[data-reader-eink="true"] .reader-canvas {
          filter: grayscale(1) contrast(1.12) !important;
        }
        .reader-v3-shell[data-reader-eink="true"] * {
          box-shadow: none !important;
          text-shadow: none !important;
          backdrop-filter: none !important;
        }
        .continuous-reader-placeholder {
          background: linear-gradient(90deg, rgba(255,255,255,0.025), rgba(255,255,255,0.08), rgba(255,255,255,0.025));
          border: 1px solid rgba(255,255,255,0.06);
        }
      `}</style>
      <PdfInDocSearch
        open={docSearchOpen}
        query={docSearchQuery}
        matches={docSearchMatches}
        activeIndex={docSearchIndex}
        loading={docSearchLoading}
        onQueryChange={setDocSearchQuery}
        onClose={() => { setDocSearchOpen(false); clearDocSearchHighlight() }}
        onNext={() => goToDocSearchMatch(1)}
        onPrev={() => goToDocSearchMatch(-1)}
        onSelectResult={selectDocSearchResult}
        isDark={theme !== 'seoul' && theme !== 'paper'}
      />
      {!focusMode && (
        <header ref={headerRef} className={`reader-chrome-bar reader-header relative z-[100] shrink-0 overflow-visible border-b px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-3 sm:py-1.5 ${themeStyle.header}`}>
          <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_9.25rem] items-center gap-2 sm:hidden">
            {onBack && (
              <IconButton label={t('reader.backToLibrary')} onClick={onBack} large className={`${themeStyle.button} shrink-0`}>
                <ArrowLeft size={16} />
              </IconButton>
            )}
            {!onBack && <div />}
            <div className="min-w-0">
              <p className={`truncate text-xs font-semibold ${themeStyle.text}`}>{displayBookTitle}</p>
              <p className={`truncate text-[10px] ${themeStyle.subtle}`}>{displayBookAuthor || t('reader.pageOf', { current: currentPage, total: numPages || '?' })}</p>
            </div>
            <div className={`flex min-w-0 items-center justify-end gap-0.5 rounded-lg border p-0.5 ${themeStyle.button}`}>
              <IconButton label={t('reader.previousPage')} onClick={() => goByStep(-1)} disabled={currentPage <= 1} large className="border-transparent bg-transparent">
                <ChevronLeft size={15} />
              </IconButton>
              <input type="number" min={1} max={numPages || undefined} value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={e => commitPageInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitPageInput(e.currentTarget.value) }} className="h-11 min-h-11 w-11 min-w-11 rounded-md border border-transparent bg-black/10 text-center text-xs outline-none" style={{ color: themeStyle.text }} aria-label="Sayfaya git" />
              <IconButton label={t('reader.nextPage')} onClick={() => goByStep(1)} disabled={!!numPages && currentPage >= numPages} large className="border-transparent bg-transparent">
                <ChevronRight size={15} />
              </IconButton>
            </div>
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-1 sm:hidden">
            <IconButton label={t('reader.drawingTools')} active={drawMode} onClick={() => { setDrawMode(value => !value); setPopup(null) }} large className={drawMode ? themeStyle.active : themeStyle.button}><Pencil size={15} /></IconButton>
            <IconButton label={t('reader.toggleBookmark')} active={!!bookmarks.find(item => item.page === currentPage)} onClick={addBookmark} large className={bookmarks.find(item => item.page === currentPage) ? themeStyle.active : themeStyle.button}>
              {bookmarks.find(item => item.page === currentPage) ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
            </IconButton>
            <IconButton label={t('reader.rsvpToggle')} active={rsvpOpen} onClick={toggleRsvp} large className={rsvpOpen ? themeStyle.active : themeStyle.button}>
              <svg width='15' height='15' viewBox='0 0 24 24' fill='currentColor'><path d='M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z'/></svg>
            </IconButton>
            <IconButton label={t('reader.focusMode')} onClick={enterFocusMode} large className={themeStyle.button}><Maximize2 size={15} /></IconButton>
            
            <div className="h-6 w-[1px] bg-white/10 shrink-0 mx-0.5" />

            <div className="flex flex-1 items-center gap-1 min-w-0">
              {mobileCategoryButton('view', <BookOpen size={14} />, t('reader.category.view'))}
              {mobileCategoryButton('markup', <Pencil size={14} />, t('reader.category.markup'))}
              {mobileCategoryButton('tools', <MoreHorizontal size={14} />, t('reader.category.tools'))}
            </div>
          </div>

          <div className="reader-toolbar hidden items-center justify-between gap-2 pb-1 sm:flex sm:flex-wrap sm:overflow-visible sm:pb-0">
            {/* Grup 1: Geri & Kitap Metaverisi */}
            <div className="flex items-center gap-2 min-w-0 max-w-[32vw]">
              {onBack && (
                <IconButton label={t('reader.backToLibrary')} onClick={onBack} className={themeStyle.button}>
                  <ArrowLeft size={18} />
                </IconButton>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  {bookThumbnail && <img src={getAssetUrl(bookThumbnail)} alt="" className="h-7 w-5 shrink-0 rounded-sm object-cover" />}
                  <p className={`truncate text-xs font-bold ${themeStyle.text}`}>{displayBookTitle}</p>
                  <span className={`rounded-full border px-1.5 py-0.2 text-[10px] font-bold ${themeStyle.active}`}>{progressPercent}%</span>
                </div>
                <p className={`truncate text-[10px] ${themeStyle.subtle}`}>
                  {displayBookAuthor ? `${displayBookAuthor} • ` : ''}{t('reader.pageOf', { current: currentPage, total: numPages || '?' })}
                </p>
              </div>
            </div>

            <div className="h-6 w-px bg-white/10 shrink-0" />

            {/* Grup 2: Sayfa Gezinme & İşaret Araçları */}
            <div className="flex items-center gap-1">
              <div className={`flex items-center gap-0.5 rounded-xl border p-0.5 ${themeStyle.button}`}>
                <IconButton label={t('reader.previousPage')} onClick={() => goByStep(-1)} disabled={currentPage <= 1} large={bigControls} className="border-transparent bg-transparent">
                  <ChevronLeft size={16} />
                </IconButton>
                <input
                  type="number"
                  min={1}
                  max={numPages || undefined}
                  value={pageInput}
                  onChange={e => setPageInput(e.target.value)}
                  onBlur={e => commitPageInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitPageInput(e.currentTarget.value) }}
                  className="h-7 w-12 rounded-lg border border-transparent bg-black/10 text-center text-xs font-bold outline-none"
                  aria-label="Sayfaya git"
                />
                <IconButton label={t('reader.nextPage')} onClick={() => goByStep(1)} disabled={!!numPages && currentPage >= numPages} large={bigControls} className="border-transparent bg-transparent">
                  <ChevronRight size={16} />
                </IconButton>
              </div>

              <IconButton label={t('reader.drawingTools')} active={drawMode} onClick={() => { closeAllOtherPanels(); setDrawMode(value => !value); setPopup(null) }} large={bigControls} className={drawMode ? themeStyle.active : themeStyle.button}>
                <Pencil size={16} />
              </IconButton>
              <IconButton label={t('reader.toggleBookmark')} active={!!bookmarks.find(item => item.page === currentPage)} onClick={addBookmark} large={bigControls} className={bookmarks.find(item => item.page === currentPage) ? themeStyle.active : themeStyle.button}>
                {bookmarks.find(item => item.page === currentPage) ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
              </IconButton>
              <IconButton label={t('reader.rsvpToggle')} active={rsvpOpen} onClick={toggleRsvp} large={bigControls} className={rsvpOpen ? themeStyle.active : themeStyle.button}>
                <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor'><path d='M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z'/></svg>
              </IconButton>
              <IconButton label={t('reader.focusMode')} onClick={enterFocusMode} large={bigControls} className={themeStyle.button}>
                <Maximize2 size={16} />
              </IconButton>
            </div>

            <div className="h-6 w-px bg-white/10 shrink-0" />

            {/* Grup 3: Ekran & Döndürme Ayarları */}
            <div className="flex items-center gap-1">
              <IconButton
                label="Sayfa Döndür (90°)"
                onClick={() => {
                  clearCanonicalSelection()
                  setPopup(null)
                  setVisiblePageTextModels({})
                  setPageTextModel(null)
                  setRotation((r: 0 | 90 | 180 | 270) => ((r || 0) + 90) % 360 as 0 | 90 | 180 | 270)
                }}
                large={bigControls}
                className={rotation !== 0 ? themeStyle.active : themeStyle.button}
              >
                <RotateCw size={16} />
              </IconButton>

              <div className="relative">
                <IconButton
                  label="Görünüm & Ekran Ayarları"
                  active={showDisplaySettings}
                  onClick={() => {
                    closeAllOtherPanels('displaySettings')
                    setShowDisplaySettings((v: boolean) => !v)
                  }}
                  large={bigControls}
                  className={showDisplaySettings ? themeStyle.active : themeStyle.button}
                >
                  <Sliders size={16} />
                </IconButton>

                {showDisplaySettings && (
                  <div className={`absolute right-0 top-full mt-2 z-[300] w-64 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl ${themeStyle.panel}`}>
                    <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5 border-b border-white/10 pb-2">
                      <Sun size={14} className="text-amber-400" /> Ekran Parlaklık & Kontrast
                    </h4>
                    
                    <div className="space-y-3 text-xs">
                      <div>
                        <div className="flex justify-between mb-1 text-slate-300">
                          <span>Parlaklık:</span>
                          <span className="font-semibold">{Math.round((brightness || 1) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="1.0"
                          step="0.05"
                          value={brightness || 1}
                          onChange={e => setBrightness(Number(e.target.value))}
                          className="w-full accent-[#e50914] cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1 text-slate-300">
                          <span>Kontrast:</span>
                          <span className="font-semibold">{Math.round((contrast || 1) * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.7"
                          max="1.5"
                          step="0.05"
                          value={contrast || 1}
                          onChange={e => setContrast(Number(e.target.value))}
                          className="w-full accent-[#e50914] cursor-pointer"
                        />
                      </div>

                      <div className="border-t border-white/10 pt-2 space-y-1.5">
                        <button
                          onClick={() => setPageLayout(value => value === 'double' ? 'single' : 'double')}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${pageLayout === 'double' ? themeStyle.active : themeStyle.button}`}
                        >
                          <span className="flex items-center gap-2"><Columns2 size={14} /> İki Sayfalı Görünüm</span>
                          <span className="text-[10px] font-bold">{pageLayout === 'double' ? 'AÇIK' : 'KAPALI'}</span>
                        </button>

                        <button
                          onClick={() => setShowThumbnailStrip(v => !v)}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${showThumbnailStrip ? themeStyle.active : themeStyle.button}`}
                        >
                          <span className="flex items-center gap-2"><LayoutGrid size={14} /> Sayfa Şeridi</span>
                          <span className="text-[10px] font-bold">{showThumbnailStrip ? 'AÇIK' : 'KAPALI'}</span>
                        </button>
                        <div className="border-t border-white/10 pt-2">
                          <ReaderAccessibilityTools
                            themeStyle={themeStyle}
                            readingRuler={readingRuler}
                            focusLine={focusLine}
                            highContrast={highContrast}
                            eInkMode={eInkMode}
                            reducedMotion={reducedMotion}
                            fontScale={fontScale}
                            lineHeight={lineHeight}
                            columnWidth={columnWidth}
                            readingDirection={readingDirection}
                            onDirectionChange={setReadingDirection}
                            labels={{
                              readingRuler: t('reader.accessibility.readingRuler'),
                              focusLine: t('reader.accessibility.focusLine'),
                              highContrast: t('reader.accessibility.highContrast'),
                              eInkMode: t('reader.accessibility.eInkMode'),
                              reducedMotion: t('reader.accessibility.reducedMotion'),
                              textSize: t('reader.accessibility.textSize'),
                              lineHeight: t('reader.accessibility.lineHeight'),
                              columnWidth: t('reader.accessibility.columnWidth'),
                              readingDirection: t('reader.accessibility.readingDirection'),
                              auto: t('reader.accessibility.auto'),
                              ltr: t('reader.accessibility.ltr'),
                              rtl: t('reader.accessibility.rtl'),
                              on: t('reader.accessibility.on'),
                              off: t('reader.accessibility.off'),
                            }}
                            onToggle={key => {
                              if (key === 'readingRuler') setReadingRuler(value => !value)
                              if (key === 'focusLine') setFocusLine(value => !value)
                              if (key === 'highContrast') setHighContrast(value => !value)
                              if (key === 'eInkMode') setEInkMode(value => !value)
                              if (key === 'reducedMotion') setReducedMotion(value => !value)
                            }}
                            onNumberChange={(key, value) => {
                              if (key === 'fontScale') setFontScale(value)
                              if (key === 'lineHeight') setLineHeight(value)
                              if (key === 'columnWidth') setColumnWidth(value)
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="h-6 w-px bg-white/10 shrink-0" />

            {/* Grup 4: Arama, Okuma & Menüler */}
            <div className="flex items-center gap-1">
              <IconButton label={t('reader.commandPalette')} onClick={() => setCommandPaletteOpen(true)} className={themeStyle.button}>
                <ListOrdered size={16} />
              </IconButton>
              <IconButton
                label={docSearchOpen ? t('reader.docSearch.open') : t('reader.docSearch.open')}
                onClick={() => {
                  closeAllOtherPanels('docSearch')
                  setDocSearchOpen(value => !value)
                }}
                large={bigControls}
                className={docSearchOpen ? themeStyle.active : themeStyle.button}
              >
                <Search size={16} />
              </IconButton>
              <IconButton
                label={ttsSessionActive ? (isTtsPaused ? t('reader.ttsResume') : t('reader.ttsPause')) : ttsPickMode ? t('reader.ttsPickHint') : t('reader.tts')}
                onClick={() => {
                  if (ttsSessionActive) {
                    if (isTtsPaused) resumeSpeaking()
                    else pauseSpeaking()
                  } else {
                    void speakPageText()
                  }
                }}
                large={bigControls}
                className={ttsSessionActive || ttsPickMode ? themeStyle.active : themeStyle.button}
              >
                {ttsSessionActive ? (isTtsPaused ? <Play size={16} /> : <Pause size={16} />) : <Volume2 size={16} />}
              </IconButton>
              {ttsSessionActive && (
                <IconButton
                  label="Bölüm Seç"
                  onClick={() => enterTtsPickMode(true)}
                  large={bigControls}
                  className={ttsPickMode ? themeStyle.active : themeStyle.button}
                >
                  <ListOrdered size={16} />
                </IconButton>
              )}
              {ttsSessionActive && (
                <IconButton label={t('reader.audioNoteAtPosition')} onClick={openAudioLinkedNote} large={bigControls} className={themeStyle.button}>
                  <StickyNote size={16} />
                </IconButton>
              )}
              {ttsSessionActive && (
                <IconButton label={t('reader.ttsStop')} onClick={stopSpeaking} large={bigControls} className={themeStyle.active}>
                  <StopCircle size={16} />
                </IconButton>
              )}
              {renderDesktopCategory('view', <BookOpen size={15} />, t('reader.category.view'))}
              {renderDesktopCategory('markup', <Pencil size={15} />, t('reader.category.markup'))}
              {renderDesktopCategory('tools', <MoreHorizontal size={15} />, t('reader.category.tools'))}
            </div>
          </div>

          <div className="mt-2 px-1 sm:mt-2 sm:px-0">
            <div className={`relative h-2.5 rounded-full ${theme === 'seoul' || theme === 'paper' ? 'liquid-glass-progress-bg-light' : 'liquid-glass-progress-bg'}`}>
              <div className="liquid-glass-progress-fill" style={{ width: `${progressPercent}%`, '--progress-color': themeStyle.accent, '--progress-glow': themeStyle.accentGlow } as React.CSSProperties} />
              {bookmarks.map(item => (
                <button
                  key={item.id}
                  onClick={() => goToPage(item.page)}
                  className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-yellow-300 shadow"
                  style={{ left: `${numPages ? Math.max(0, Math.min(100, (item.page / numPages) * 100)) : 0}%` }}
                  title={t('reader.bookmarkPage', { page: item.page })}
                />
              ))}
              {notePages.map(page => (
                <button
                  key={page}
                  onClick={() => goToPage(page)}
                  className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-violet-200/90"
                  style={{ left: `${numPages ? Math.max(0, Math.min(100, (page / numPages) * 100)) : 0}%` }}
                  title={t('reader.notesOnPage', { page })}
                />
              ))}
            </div>
          </div>
        </header>
      )}

      {focusMode && (
        <>
          {!focusToolsVisible ? (
            <button
              onClick={() => setFocusToolsVisible(true)}
              className={`fixed left-1/2 top-[calc(env(safe-area-inset-top)+8px)] z-50 -translate-x-1/2 flex items-center gap-1 rounded-full border px-4 py-1.5 text-xs shadow-2xl backdrop-blur-xl ${themeStyle.button}`}
              title={t('reader.showTools')}
            >
              <ChevronDown size={12} />
              {t('reader.showTools')}
            </button>
          ) : (
            <div className={`focus-reader-toolbar fixed inset-x-0 top-0 z-[100] overflow-visible border-b shadow-2xl pt-[max(0.25rem,env(safe-area-inset-top))] pb-1 ${themeStyle.header}`}>
              <div className="flex flex-wrap items-center justify-between gap-1 px-2 py-1.5 sm:justify-center sm:gap-4">
                <div className={`flex items-center gap-0.5 rounded-lg border p-0.5 ${themeStyle.button}`}>
                  <IconButton label={t('reader.previousPage')} onClick={() => goByStep(-1)} disabled={currentPage <= 1} large className="border-transparent bg-transparent"><ChevronLeft size={15} /></IconButton>
                  <input type="number" min={1} max={numPages || undefined} value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={e => commitPageInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitPageInput(e.currentTarget.value) }} className="h-11 min-h-11 w-11 min-w-11 rounded-md border border-transparent bg-black/10 text-center text-xs outline-none" style={{ color: themeStyle.text }} aria-label="Sayfaya git" />
                  <IconButton label={t('reader.nextPage')} onClick={() => goByStep(1)} disabled={!!numPages && currentPage >= numPages} large className="border-transparent bg-transparent"><ChevronRight size={15} /></IconButton>
                </div>
                <div className="flex items-center gap-1 sm:gap-4">
                  <IconButton label={t('reader.drawingTools')} active={drawMode} onClick={() => { setDrawMode(value => !value); setPopup(null) }} large className={drawMode ? themeStyle.active : themeStyle.button}><Pencil size={15} /></IconButton>
                  <IconButton label={t('reader.toggleBookmark')} active={!!bookmarks.find(item => item.page === currentPage)} onClick={addBookmark} large className={bookmarks.find(item => item.page === currentPage) ? themeStyle.active : themeStyle.button}>{bookmarks.find(item => item.page === currentPage) ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}</IconButton>
                  <button
                    onClick={() => setFocusToolsVisible(false)}
                    className={`rounded-lg border p-1.5 ${themeStyle.button}`}
                    aria-label={t('reader.hideTools')}
                    title={t('reader.hideTools')}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button onClick={exitFocusMode} className={`rounded-lg border px-2.5 py-1.5 text-xs ${themeStyle.button}`}>{t('reader.exitFocus')}</button>
                </div>
              </div>
              <div className="flex gap-1 px-2 pb-1 sm:justify-center sm:gap-4 sm:pb-2">
                <div className="flex w-full gap-1 sm:hidden">
                  {mobileCategoryButton('view', <BookOpen size={14} />, t('reader.category.view'))}
                  {mobileCategoryButton('markup', <Pencil size={14} />, t('reader.category.markup'))}
                  {mobileCategoryButton('tools', <MoreHorizontal size={14} />, t('reader.category.tools'))}
                </div>
                {renderDesktopCategory('view', <BookOpen size={15} />, t('reader.category.view'))}
                {renderDesktopCategory('markup', <Pencil size={15} />, t('reader.category.markup'))}
                {renderDesktopCategory('tools', <MoreHorizontal size={15} />, t('reader.category.tools'))}
              </div>
            </div>
          )}
        </>
      )}

      {renderMobileCategorySheet()}

      {ttsPickMode && (
        <div className={`fixed inset-x-3 z-[280] flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:left-1/2 sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2 ${themeStyle.panel}`} style={{ top: Math.max(12, headerHeight + 8) }}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
            <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <p className={`truncate font-semibold ${themeStyle.text}`}>
              Sayfada {ttsChunksList.length} bölüm vurgulandı. Tıklayın veya seçin:
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {ttsChunksList.length > 0 && (
              <button
                type="button"
                onClick={() => setShowTtsSectionList(true)}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-semibold text-amber-400 border-amber-400/40 hover:bg-amber-400/10 ${themeStyle.button}`}
              >
                <ListOrdered size={14} />
                Bölüm Listesi ({ttsChunksList.length})
              </button>
            )}
            {readingCursor.wordIndex > 0 && (
              <button type="button" onClick={() => { clearTtsChunkPick(); void speakPageTextFromWord(readingCursor.wordIndex) }} className={`rounded-lg border px-2.5 py-1.5 font-medium ${themeStyle.active}`}>
                {t('reader.continueReading')}
              </button>
            )}
            <button type="button" onClick={() => { clearTtsChunkPick(); void speakPageTextFromWord(0) }} className={`rounded-lg border px-2.5 py-1.5 font-medium ${themeStyle.button}`}>
              {t('reader.ttsPickFromStart')}
            </button>
            <button type="button" onClick={clearTtsChunkPick} className={`rounded-lg border p-1.5 ${themeStyle.button}`} aria-label={t('common.cancel')}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {showTtsSectionList && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className={`w-full max-w-lg overflow-hidden rounded-2xl border p-4 shadow-2xl ${themeStyle.panel}`}>
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <ListOrdered size={18} className="text-amber-400" />
                <h3 className={`font-semibold text-sm ${themeStyle.text}`}>Dinleme Bölümleri ({ttsChunksList.length})</h3>
              </div>
              <button onClick={() => setShowTtsSectionList(false)} className={`rounded-lg p-1.5 ${themeStyle.button}`}>
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {ttsChunksList.map((chunk, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    clearTtsChunkPick()
                    void speakPageTextFromWord(chunk.startWord)
                  }}
                  className={`w-full text-left rounded-xl border p-3 text-xs transition-all hover:scale-[1.01] hover:border-amber-400/50 ${themeStyle.button}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-md border border-amber-400/20">Bölüm {idx + 1}</span>
                    <span className="text-[10px] opacity-60">{chunk.text.split(' ').length} kelime</span>
                  </div>
                  <p className={`line-clamp-3 leading-relaxed font-serif ${themeStyle.text}`}>{`"${chunk.text}"`}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {theme === 'midnight' || theme === 'slate' ? (
        <style>{`
          .reader-pdf-page .react-pdf__Page__canvas {
            filter: invert(1) hue-rotate(180deg);
            -webkit-backface-visibility: hidden;
            backface-visibility: hidden;
            -webkit-transform: translate3d(0, 0, 0);
            transform: translate3d(0, 0, 0);
            will-change: filter, transform;
          }
          .tts-highlight {
            background: #facc15 !important;
            color: #000000 !important;
            border-radius: 3px;
            box-shadow: 0 0 0 3px #facc15, 0 4px 14px rgba(0,0,0,0.4) !important;
            z-index: 99 !important;
            position: relative !important;
            opacity: 1 !important;
            -webkit-text-fill-color: #000000 !important;
          }
          .tts-chunk-pick {
            cursor: pointer !important;
            border-radius: 3px;
            transition: background 0.15s ease, box-shadow 0.15s ease;
          }
          .tts-chunk-pick:hover {
            background: rgba(250, 204, 21, 0.35) !important;
            box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.75) !important;
            border-radius: 3px;
          }
          .tts-pick-mode .react-pdf__Page__textContent {
            pointer-events: auto !important;
          }
          .tts-pick-mode .react-pdf__Page__textContent span {
            pointer-events: auto !important;
          }
          .pdf-search-highlight {
            background: rgba(229, 9, 20, 0.42) !important;
            border-radius: 2px;
            box-shadow: 0 0 0 1px rgba(229, 9, 20, 0.35);
          }
        `}</style>
      ) : (
        <style>{`
          .tts-highlight {
            background: rgba(255, 200, 0, 0.35) !important;
            border-radius: 2px;
          }
          .tts-chunk-pick {
            cursor: pointer !important;
            border-radius: 2px;
          }
          .tts-chunk-pick-a {
            background: rgba(229, 9, 20, 0.16) !important;
            box-shadow: inset 0 0 0 1px rgba(229, 9, 20, 0.28);
          }
          .tts-chunk-pick-b {
            background: rgba(37, 99, 235, 0.14) !important;
            box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.25);
          }
          .tts-pick-mode .react-pdf__Page__textContent {
            pointer-events: auto !important;
          }
          .tts-pick-mode .react-pdf__Page__textContent span {
            pointer-events: auto !important;
          }
        `}</style>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main
          ref={readerRef}
          aria-label={t('reader.titleFallback')}
          data-canonical-selection-active={canonicalSelection ? 'true' : 'false'}
          className={`reader-canvas reader-canvas-stage relative flex flex-1 flex-col overflow-auto p-1.5 pb-20 sm:p-5 sm:pb-5 ${themeStyle.canvas}${ttsPickMode ? ' tts-pick-mode' : ''}`}
          style={{ filter: `brightness(${brightness || 1}) contrast(${contrast || 1})` }}
          onClick={(event) => {
            const target = event.target
            if (!(target instanceof Element)) return
            const span = target.closest('[data-tts-chunk]') || target.closest('.react-pdf__Page__textContent span, .ocr-text-layer span')
            if (!(span instanceof HTMLElement)) return
            if (ttsPickMode || ttsSessionActive) {
              let startWord = 0
              if (span.dataset.ttsChunk) {
                const chunkIndex = Number(span.dataset.ttsChunk)
                const chunk = ttsPickChunksRef.current[chunkIndex]
                if (chunk) startWord = chunk.startWord
              } else {
                const wordIndex = ttsPageWordsRef.current.findIndex(item => item.spans.includes(span))
                if (wordIndex >= 0) {
                  const chunk = ttsPickChunksRef.current.find(item => wordIndex >= item.startWord && wordIndex <= item.endWord)
                  startWord = chunk?.startWord ?? wordIndex
                }
              }
              event.preventDefault()
              event.stopPropagation()
              clearTtsChunkPick()
              void speakPageTextFromWord(startWord)
            }
          }}
          onPointerDown={(event) => {
            if (ttsPickMode || ttsSessionActive) {
              const target = event.target
              if (target instanceof Element && (target.closest('[data-tts-chunk]') || target.closest('.react-pdf__Page__textContent span, .ocr-text-layer span'))) {
                return
              }
            }
            const target = event.target
            if (drawMode || !(target instanceof Element)) return
            if (target.closest('[role="dialog"], .selection-popover, .reader-toolbar, button, a, input, textarea, select')) {
              return
            }
            const textContentEl = target.closest('.react-pdf__Page__textContent, .ocr-text-layer')
            const inTextLayer = !!(textContentEl && target !== textContentEl)
            const page = Number(textContentEl?.closest('[data-page-number]')?.getAttribute('data-page-number')) || null
            const model = page ? visiblePageTextModels[page] : null
            const canonicalMode = inTextLayer && page
              ? getCanonicalPointerSelectionMode({
                pointerType: event.pointerType,
                button: event.button,
                isPrimary: event.isPrimary,
                model,
              })
              : 'native'
            const useCanonicalSelection = canonicalMode === 'immediate'
            selectionPointerRef.current = {
              startedAt: Date.now(),
              endedAt: 0,
              pointerType: event.pointerType,
              pointerId: event.pointerId,
              inTextLayer,
              modelPage: inTextLayer && page && isCanonicalSelectionModelUsable(model) ? page : null,
              canonicalPage: useCanonicalSelection ? page : null,
              startX: event.clientX,
              startY: event.clientY,
              endX: event.clientX,
              endY: event.clientY,
            }
            if (useCanonicalSelection) {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              event.currentTarget.dataset.canonicalSelectionActive = 'true'
              canonicalSelectionRef.current = null
              setCanonicalSelection(null)
              setPopup(null)
              window.getSelection()?.removeAllRanges()
              return
            }
            if (inTextLayer) {
              // Fingers and styluses keep the platform's long press, double tap
              // and handle dragging. Only the drag overlay is cleared here; the
              // range itself stays untouched so those gestures can continue.
              if (canonicalSelectionRef.current) setCanonicalSelection(null)
              return
            }
            // Click/touch outside text layer on blank background: dismiss active selection & popup
            window.getSelection()?.removeAllRanges()
            canonicalSelectionRef.current = null
            setCanonicalSelection(null)
            setPopup(null)
          }}
          onPointerMove={(event) => {
            const interaction = selectionPointerRef.current
            if (!interaction.startedAt || interaction.endedAt !== 0) return
            selectionPointerRef.current = {
              ...interaction,
              endX: event.clientX,
              endY: event.clientY,
            }
            if (interaction.canonicalPage) {
              const moved = Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY)
              if (moved < 3) return
              event.preventDefault()
              const resolved = resolveCanonicalPointerSelection()
              if (resolved) {
                const nextSelection = { page: resolved.page, value: resolved.value }
                canonicalSelectionRef.current = nextSelection
                setCanonicalSelection(nextSelection)
              }
            }
          }}
          onPointerUp={(e) => {
            const interaction = selectionPointerRef.current
            const completedInteraction = { ...interaction, endedAt: Date.now(), pointerType: e.pointerType, endX: e.clientX, endY: e.clientY }
            selectionPointerRef.current = completedInteraction
            if (completedInteraction.canonicalPage) {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
              const moved = Math.hypot(e.clientX - interaction.startX, e.clientY - interaction.startY)
              const resolved = moved >= 4 ? resolveCanonicalPointerSelection() : null
              if (resolved) openCanonicalSelectionPopup(resolved)
              else {
                canonicalSelectionRef.current = null
                setCanonicalSelection(null)
                e.currentTarget.dataset.canonicalSelectionActive = 'false'
              }
              return
            }
            if (e.pointerType !== 'touch' && e.pointerType !== 'pen') {
              handleMouseUp()
            }
          }}
          onPointerCancel={(event) => {
            const wasCanonicalDrag = selectionPointerRef.current.canonicalPage !== null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            selectionPointerRef.current = { ...selectionPointerRef.current, endedAt: Date.now(), canonicalPage: null }
            // Touch pointers are cancelled whenever the platform takes the
            // gesture over for scrolling or selection, so only an interrupted
            // mouse drag should discard the selection.
            if (!wasCanonicalDrag) return
            canonicalSelectionRef.current = null
            setCanonicalSelection(null)
            event.currentTarget.dataset.canonicalSelectionActive = 'false'
          }}
        >
          <div className="sticky top-2 z-[75] ml-auto mr-2 flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[10px] shadow-lg backdrop-blur-md" role="status" aria-live="polite">
            <span className={themeStyle.subtle}>
              {activeTextModel
                ? `${t(activeTextModel.source === 'ocr' ? 'reader.textSourceOcr' : 'reader.textSourceNative')} · ${t('reader.textQuality')} ${Math.round(activeTextModel.quality * 100)}%`
                : pageTextRecoveryBusy ? t('reader.textRecoveryRunning') : t('reader.reflowNoText')}
            </span>
            {readingCursor.source !== 'idle' && <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-amber-100">{readingCursor.source.toUpperCase()} · {readingCursor.wordIndex + 1}</span>}
            <button
              type="button"
              onClick={() => { void runOcrCurrentPage() }}
              disabled={ocrBusy || pageTextRecoveryBusy}
              className={`rounded-full border px-2 py-0.5 font-semibold disabled:opacity-50 ${themeStyle.button}`}
              aria-label={t('reader.rebuildText')}
              title={activeTextModel?.provenance.engineVersion
                ? `${activeTextModel.provenance.engine} ${activeTextModel.provenance.engineVersion}`
                : activeTextModel?.provenance.engine || t('reader.rebuildText')}
            >
              {t('reader.rebuildText')}
            </button>
          </div>
          {readingMode === 'reflow' ? (
            <ReflowReader
              bookId={bookId}
              currentPage={currentPage}
              themeStyle={themeStyle}
              accent={themeStyle.accent}
              t={t as (key: string) => string}
              pageText={activeReflowPage}
              disableRemoteFetch={isEncrypted}
              initialScrollOffset={reflowScrollOffset}
              onScrollPositionChange={setReflowScrollOffset}
              onTextSelection={(text, x, y) => setPopup({ x, y, text, page: currentPage, rects: [] })}
              readerFontScale={fontScale}
              readerLineHeight={lineHeight}
              readerColumnWidth={columnWidth}
              reducedMotion={reducedMotion}
              readingDirection={readingDirection}
              onExitTextFlow={() => selectReadingMode('pdf')}
            />
          ) : readingMode === 'continuous' ? (
            <Document
              key={resolvedFileUrl}
              file={resolvedFileUrl}
              options={PDF_DOCUMENT_OPTIONS}
              onLoadSuccess={(doc) => {
                setLoadError(false)
                setNumPages(doc.numPages)
                fetch(`/api/books/${bookId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ total_pages: doc.numPages }) }).catch(() => {})
                pdfDocRef.current = doc as unknown as PdfDocumentRef
                try {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ;(doc as any).getOutline?.().then((outline: Array<{ title: string; dest: unknown; items?: unknown[] }> | null) => {
                    setPdfOutline(outline || [])
                  }).catch(() => setPdfOutline([]))
                } catch { setPdfOutline([]) }
              }}
              onLoadError={(error) => {
                console.error('[PDFReader] Continuous document load failed:', error)
                setLoadError(true)
              }}
              loading={(
                <div className="mx-auto mt-16 flex w-full max-w-xs flex-col items-center gap-4 px-4">
                  <div className={`aspect-[3/4] w-full max-w-[16rem] rounded-lg ${themeStyle.panel} skeleton-shimmer opacity-60`} />
                  <div className="reader-pdf-loading-bar w-full" />
                  <p className={`text-center text-sm ${themeStyle.subtle}`}>{t('reader.loadingPdf')}</p>
                </div>
              )}
              error={(
                <div className="mx-auto mt-20 flex max-w-sm flex-col items-center gap-3 px-4 text-center">
                  <p className="text-sm text-red-400">{t('reader.loadFailed')}</p>
                  <button
                    type="button"
                    onClick={returnToPdfJsReader}
                    className="rounded-lg bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/30"
                  >
                    {t('reader.retryLoad')}
                  </button>
                </div>
              )}
            >
              <ContinuousReader
                totalPages={numPages}
                currentPage={currentPage}
                onPageChange={goToPage}
                scrollRootRef={readerRef}
                renderPage={renderContinuousPage}
                estimatedPageHeight={pageSize.width && pageSize.height ? Math.round(pageSize.height) + 32 : 920}
                reduceMotion={reducedMotion}
              />
            </Document>
          ) : (
          <div className="flex min-h-full min-w-full flex-col">
            <div className="flex-1" />
            <div 
              className="mx-auto w-fit"
              style={{ transform: isPinching ? `scale(${pinchScale})` : 'none', transformOrigin: 'center top', willChange: isPinching ? 'transform' : 'auto' }}
            >
              <Document
                key={resolvedFileUrl}
                file={resolvedFileUrl}
                options={PDF_DOCUMENT_OPTIONS}
                onLoadSuccess={(doc) => {
                  setLoadError(false)
                  setNumPages(doc.numPages)
                  fetch(`/api/books/${bookId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ total_pages: doc.numPages }) }).catch(() => {})
                  // Store doc ref for later outline navigation
                  pdfDocRef.current = doc as unknown as PdfDocumentRef
                  // Load PDF outline/TOC
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ;(doc as any).getOutline?.().then((outline: Array<{ title: string; dest: unknown; items?: unknown[] }> | null) => {
                      setPdfOutline(outline || [])
                    }).catch(() => setPdfOutline([]))
                  } catch { setPdfOutline([]) }
                }}
                onLoadError={(error) => {
                  console.error('[PDFReader] Document load failed:', error)
                  setLoadError(true)
                }}
                loading={(
                  <div className="mx-auto mt-16 flex w-full max-w-xs flex-col items-center gap-4 px-4">
                    <div className={`aspect-[3/4] w-full max-w-[16rem] rounded-lg ${themeStyle.panel} skeleton-shimmer opacity-60`} />
                    <div className="reader-pdf-loading-bar w-full" />
                    <p className={`text-center text-sm ${themeStyle.subtle}`}>{t('reader.loadingPdf')}</p>
                  </div>
                )}
                error={(
                  <div className="mx-auto mt-20 flex max-w-sm flex-col items-center gap-3 px-4 text-center">
                    <p className="text-sm text-red-400">{t('reader.loadFailed')}</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={returnToPdfJsReader}
                        className="rounded-lg bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/30"
                      >
                        {t('reader.retryLoad')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setForceNativeViewer(true)}
                        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                      >
                        {t('reader.useNativeViewer')}
                      </button>
                    </div>
                  </div>
                )}
              >
                {showThumbnailStrip && readingMode === 'pdf' && numPages > 0 && (
                  <div className={`mb-5 flex gap-2 overflow-x-auto rounded-2xl border p-2 ${themeStyle.panel}`} aria-label="Page thumbnails">
                    {Array.from({ length: Math.min(9, numPages) }, (_, index) => {
                      const start = Math.min(Math.max(1, currentPage - 4), Math.max(1, numPages - 8))
                      const page = start + index
                      return (
                        <button key={page} type="button" onClick={() => goToPage(page)} className={`relative shrink-0 overflow-hidden rounded-lg border p-1 transition ${page === currentPage ? themeStyle.active : themeStyle.button}`} aria-label={t('reader.pageOf', { current: page, total: numPages })}>
                          <Page pageNumber={page} scale={0.11} renderAnnotationLayer={false} renderTextLayer={false} loading={<div className="h-24 w-16" />} />
                          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/65 px-1 text-[9px] font-bold text-white">{page}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className={`flex items-start justify-center gap-4 ${pageLayout === 'double' ? 'flex-row' : 'flex-col'}`}>
                  <div 
                    className={`relative inline-block ${visiblePageTextModels[currentPage]?.source === 'ocr' ? 'ocr-selection-active' : ''}`}
                    style={{
                      width: pageSize.width ? Math.round(pageSize.width * scale) : 'auto',
                      height: pageSize.height ? Math.round(pageSize.height * scale) : 'auto'
                    }}
                  >
                    <Page
                      pageNumber={currentPage}
                      scale={scale}
                      rotate={rotation}
                      canvasRef={firstPageCanvasRef}
                      className="reader-pdf-page overflow-hidden rounded-sm shadow-[0_22px_90px_rgba(0,0,0,0.4)]"
                      renderAnnotationLayer
                      renderTextLayer
                      onLoadSuccess={page => {
                        const viewport = page.getViewport({ scale: 1, rotation })
                        setPageSize({ width: viewport.width, height: viewport.height })
                        setPageSizes(current => ({ ...current, [currentPage]: { width: viewport.width, height: viewport.height } }))
                      }}
                      onRenderSuccess={() => setPageRenderReady(value => value + 1)}
                      onRenderTextLayerSuccess={normalizePrimaryTextLayer}
                    />

                    {visiblePageTextModels[currentPage]?.source === 'ocr' && (
                      <OcrTextLayer model={visiblePageTextModels[currentPage]} label={t('reader.ocrSelectionLayer')} page={currentPage} />
                    )}
                    <CanonicalSelectionOverlay selection={canonicalSelection?.page === currentPage ? canonicalSelection.value : null} rotation={rotation} color={themeStyle.accent} />
                    {pageTextRecoveryBusy && (
                      <div className={`pointer-events-none absolute left-1/2 top-3 z-[70] -translate-x-1/2 rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur-md ${themeStyle.panel}`}>
                        {t('reader.textRecoveryRunning')}
                      </div>
                    )}

                    {areaSelectMode && (
                      <AreaNoteSelector
                        canvasRef={firstPageCanvasRef}
                        accent={themeStyle.accent}
                        cancelLabel={t('common.cancel')}
                        onComplete={completeAreaNote}
                        onCancel={() => setAreaSelectMode(false)}
                      />
                    )}

                    <MemoTextHighlightOverlay annotations={textHighlights} onDelete={deleteAnnotation} rotation={rotation} />
                    {showPageNotes && (
                      <MemoInlineNoteOverlay
                        annotations={annotations.filter(item => item.type === 'note' && (item.page === currentPage || item.content.sources?.some(source => source.page === currentPage)))}
                        themeStyle={themeStyle}
                        focusedId={focusedAnnotationId}
                        page={currentPage}
                        isLeftPage={pageLayout === 'double'}
                        rotation={rotation}
                      />
                    )}

                    {!drawMode && scaledExistingPaths.length > 0 && pageSize.width > 0 && (
                      <DrawingOverlay
                        width={Math.round(pageSize.width * scale)}
                        height={Math.round(pageSize.height * scale)}
                        paths={scaledExistingPaths}
                      />
                    )}
                    {drawMode && pageSize.width > 0 && (
                      <DrawingCanvas
                        key={`canvas-${currentPage}`}
                        width={Math.round(pageSize.width * scale)}
                        height={Math.round(pageSize.height * scale)}
                      color={drawColor}
                      brushSize={brushSize}
                      opacity={drawTool === 'highlighter' ? Math.min(drawOpacity, 0.45) : drawOpacity}
                      tool={drawTool}
                      onToolChange={setDrawTool}
                      onColorChange={setDrawColor}
                      onBrushSizeChange={setBrushSize}
                      onOpacityChange={setDrawOpacity}
                      toolbarTop={drawingToolbarTop}
                      theme={theme}
                      existingPaths={scaledExistingPaths}
                      isSaving={isSaving}
                      onSave={scaled => saveDrawing(scaled.map(unscaleDrawPath))}
                      onAutoSave={scaled => saveDrawing(scaled.map(unscaleDrawPath), false)}
                      onCancel={() => setDrawMode(false)}
                    />
                  )}
                </div>

                  {pageLayout === 'double' && currentPage < (numPages || currentPage) && (
                    <div
                      className={`relative inline-block ${visiblePageTextModels[currentPage + 1]?.source === 'ocr' ? 'ocr-selection-active' : ''}`}
                      style={{
                        width: pageSizes[currentPage + 1]?.width ? Math.round(pageSizes[currentPage + 1].width * scale) : 'auto',
                        height: pageSizes[currentPage + 1]?.height ? Math.round(pageSizes[currentPage + 1].height * scale) : 'auto'
                      }}
                    >
                      <Page
                        pageNumber={currentPage + 1}
                        scale={scale}
                        rotate={rotation}
                        canvasRef={secondPageCanvasRef}
                        className="reader-pdf-page overflow-hidden rounded-sm shadow-[0_22px_90px_rgba(0,0,0,0.4)]"
                        renderAnnotationLayer
                        renderTextLayer
                        onLoadSuccess={page => {
                          const viewport = page.getViewport({ scale: 1, rotation })
                          setPageSizes(current => ({ ...current, [currentPage + 1]: { width: viewport.width, height: viewport.height } }))
                        }}
                        onRenderSuccess={() => setSecondPageRenderReady(value => value + 1)}
                        onRenderTextLayerSuccess={normalizeSecondaryTextLayer}
                      />
                      {visiblePageTextModels[currentPage + 1]?.source === 'ocr' && (
                        <OcrTextLayer model={visiblePageTextModels[currentPage + 1]} label={t('reader.ocrSelectionLayer')} page={currentPage + 1} />
                      )}
                      <CanonicalSelectionOverlay selection={canonicalSelection?.page === currentPage + 1 ? canonicalSelection.value : null} rotation={rotation} color={themeStyle.accent} />
                      <MemoTextHighlightOverlay annotations={textHighlightsPage2} onDelete={deleteAnnotation} rotation={rotation} />
                      {showPageNotes && (
                        <MemoInlineNoteOverlay
                          annotations={annotations.filter(item => item.type === 'note' && (item.page === currentPage + 1 || item.content.sources?.some(source => source.page === currentPage + 1)))}
                          themeStyle={themeStyle}
                          focusedId={focusedAnnotationId}
                          page={currentPage + 1}
                          rotation={rotation}
                        />
                      )}
                      {scaledExistingPathsPage2.length > 0 && Boolean(pageSizes[currentPage + 1]?.width) && (
                        <DrawingOverlay
                          width={Math.round(pageSizes[currentPage + 1].width * scale)}
                          height={Math.round(pageSizes[currentPage + 1].height * scale)}
                          paths={scaledExistingPathsPage2}
                        />
                      )}
                    </div>
                  )}
                </div>
              </Document>
            </div>
            <div className="flex-1" />
          </div>
          )}
        </main>

        {sidePanel && sidePanel !== 'audio-notes' && (
          <aside className={`panel-slide-in absolute inset-y-0 right-0 z-[105] w-full overflow-y-auto border-l p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:relative sm:inset-auto sm:w-[23rem] ${themeStyle.panel}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className={`text-xs uppercase tracking-[0.18em] ${themeStyle.subtle}`}>{t(`reader.panel.${sidePanel}` as Parameters<typeof t>[0])}</p>
                <p className={`text-lg font-semibold ${themeStyle.text}`}>
                  {sidePanel === 'progress' 
                    ? t('reader.readingCockpit') 
                    : sidePanel === 'notes' 
                    ? t('common.notes') 
                    : sidePanel === 'highlights' 
                    ? t('selection.highlight') 
                    : sidePanel === 'outline' 
                    ? t('reader.outline') 
                    : sidePanel === 'ask-ai' 
                    ? t('reader.askAi') 
                    : sidePanel === 'navigator'
                    ? t('reader.navigator')
                    : sidePanel === 'quality'
                    ? t('reader.textQualityCenter')
                    : sidePanel === 'study'
                    ? t('reader.studyCockpit')
                    : t('common.bookmarks')}
                </p>
              </div>
              <button onClick={() => setSidePanel(null)} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.close')}>
                <X size={16} />
              </button>
            </div>

            {sidePanel === 'navigator' && (
              <ReaderNavigationCockpit
                currentPage={currentPage}
                totalPages={numPages}
                bookmarks={bookmarks}
                annotations={annotations}
                outline={pdfOutline}
                themeStyle={{ ...themeStyle, accent: themeStyle.accent }}
                pageLabel={pageLabel}
                onPageChange={goToPage}
                onOpenOutline={() => setSidePanel('outline')}
                onOpenNotes={() => setSidePanel('notes')}
                showThumbnails={showThumbnailStrip}
                onToggleThumbnails={() => setShowThumbnailStrip(value => !value)}
              />
            )}

            {sidePanel === 'quality' && (
              <ReaderQualityCenter
                model={activeTextModel}
                recoveryBusy={ocrBusy || pageTextRecoveryBusy}
                encrypted={isEncrypted}
                themeStyle={themeStyle}
                labels={{
                  title: t('reader.textQualityCenter'),
                  native: t('reader.textSourceNative'),
                  ocr: t('reader.textSourceOcr'),
                  quality: t('reader.textQuality'),
                  revision: t('reader.textRevision'),
                  engine: t('reader.textEngine'),
                  rebuild: t('reader.rebuildText'),
                  encrypted: t('reader.encryptedTextLocalOnly'),
                  unavailable: t('reader.reflowNoText'),
                  recovery: t('reader.textRecoveryRunning'),
                  copyCleanText: t('reader.copyCleanText'),
                }}
                text={activeReflowPage?.text || ''}
                onRebuild={() => { void runOcrCurrentPage() }}
                onCopy={() => { void copyTextToClipboard(activeReflowPage?.text || '').then(ok => toast(ok ? t('selection.copied') : t('reader.copyFailed'), ok ? 'info' : 'error')) }}
              />
            )}

            {sidePanel === 'study' && (
              <div className="space-y-3">
                <p className={`text-xs ${themeStyle.subtle}`}>{t('reader.studyCockpitHint')}</p>
                {popup?.text ? (
                  <div className="rounded-xl border border-violet-300/20 bg-violet-300/10 p-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-violet-200">{t('reader.studySelection')}</p>
                    <p className="line-clamp-5 text-sm leading-relaxed text-violet-50">“{cleanText(popup.text)}”</p>
                  </div>
                ) : <p className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs ${themeStyle.subtle}`}>{t('reader.studySelectHint')}</p>}
                <button type="button" onClick={() => setSidePanel('ask-ai')} className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${themeStyle.button}`}>{t('reader.askAi')}</button>
                <button type="button" onClick={() => { setSidePanel('ask-ai'); setAiQuestion(`${t('reader.studyPromptPrefix')} ${popup?.text ? `“${cleanText(popup.text)}”` : currentPage}`) }} className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm font-semibold ${themeStyle.button}`}>{t('reader.studyExplainPage')}</button>
                <p className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs ${themeStyle.subtle}`}>{t('reader.studyCitation', { page: currentPage })}</p>
              </div>
            )}

            {sidePanel === 'progress' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-sm font-medium">{t('reader.whereLeft')}</p>
                    <span className="rounded-full px-2 py-1 text-xs" style={{ color: themeStyle.accent, backgroundColor: `${themeStyle.accent}33` }}>{progressPercent}%</span>
                  </div>
                  <p className="text-3xl font-bold">{t('reader.pageOf', { current: currentPage, total: numPages || '?' })}</p>
                  <p className={`mt-1 text-sm ${themeStyle.subtle}`}>{t('reader.pagesLeft', { count: pagesLeft })} {etaMinutes ? `- ${t('reader.aboutMinutes', { minutes: etaMinutes })}` : ''}</p>
                  <input type="range" min={1} max={Math.max(1, numPages || 1)} value={currentPage} onChange={e => goToPage(Number(e.target.value))} className="mt-4 w-full" style={{ accentColor: themeStyle.accent }} />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className={`text-[11px] uppercase tracking-wide ${themeStyle.subtle}`}>{t('reader.lastSession')}</p>
                      <p className="mt-1 text-sm font-semibold">{lastSessionLabel}</p>
                    </div>
                    <div>
                      <p className={`text-[11px] uppercase tracking-wide ${themeStyle.subtle}`}>{t('reader.finishEstimate')}</p>
                      <p className="mt-1 text-sm font-semibold">{finishLabel}</p>
                    </div>
                    <div>
                      <p className={`text-[11px] uppercase tracking-wide ${themeStyle.subtle}`}>{t('reader.today')}</p>
                      <p className="mt-1 text-sm font-semibold">{pageLabel(readingStats?.today.pages || 0)} - {compactDuration(readingStats?.today.seconds || 0)}</p>
                    </div>
                    <div>
                      <p className={`text-[11px] uppercase tracking-wide ${themeStyle.subtle}`}>{t('reader.avgPace')}</p>
                      <p className="mt-1 text-sm font-semibold">{avgPaceLabel}</p>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className={`text-[11px] uppercase tracking-wide ${themeStyle.subtle}`}>{t('reader.last7')}</p>
                      <span className="text-xs font-medium">{t('reader.pagesPerDay', { count: readingStats?.daily_pages || 0 })}</span>
                    </div>
                    {readingStats?.recent.length ? (
                      <div className="space-y-2">
                        {readingStats.recent.slice(0, 4).map(item => (
                          <button
                            key={item.id}
                            onClick={() => goToPage(item.end_page)}
                            className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-white/[0.06]"
                          >
                            <span className="truncate">{new Date(item.started_at).toLocaleDateString(locale)} - {item.start_page} - {item.end_page}</span>
                            <span className={themeStyle.subtle}>{pageLabel(item.pages_read)} / {compactDuration(item.duration_seconds)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={`text-xs ${themeStyle.subtle}`}>{t('reader.noSessions')}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <Clock3 size={16} className={themeStyle.subtle} />
                    <p className={`mt-2 text-xs ${themeStyle.subtle}`}>{t('reader.session')}</p>
                    <p className="mt-1 text-lg font-semibold">
                      <ReadingSessionLabel paused={sessionPaused} active={sidePanel === 'progress'} secondsRef={readingSecondsRef} onTick={setReadingSeconds} />
                    </p>
                  </div>
                  {[
                    [t('reader.thisSession'), pagesThisSessionLabel, BookOpen],
                    [t('common.bookmarks'), String(bookmarks.length), Bookmark],
                    [t('common.notes'), String(notes.length), StickyNote],
                  ].map(([label, value, Icon]) => (
                    <div key={label as string} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      <Icon size={16} className={themeStyle.subtle} />
                      <p className={`mt-2 text-xs ${themeStyle.subtle}`}>{label as string}</p>
                      <p className="mt-1 text-lg font-semibold">{value as string}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <p className={`mb-3 text-xs uppercase tracking-wide ${themeStyle.subtle}`}>{t('reader.quickJumps')}</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => goToPage(1)} className={`min-h-10 rounded-lg border px-3 py-2 text-xs ${themeStyle.button}`}>{t('reader.start')}</button>
                    <button onClick={() => goToPage(Math.max(1, Math.round((numPages || currentPage) / 2)))} className={`min-h-10 rounded-lg border px-3 py-2 text-xs ${themeStyle.button}`}>{t('reader.middle')}</button>
                    <button onClick={() => goToPage(numPages || currentPage)} className={`min-h-10 rounded-lg border px-3 py-2 text-xs ${themeStyle.button}`}>{t('reader.end')}</button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                    <button onClick={sessionPaused ? resumeReadingSession : stopReadingSession} className={`min-h-10 rounded-lg border px-3 py-2 text-xs ${sessionPaused ? themeStyle.active : themeStyle.button}`}>
                      {sessionPaused ? t('reader.resumeSession') : t('reader.stopSession')}
                    </button>
                    <button onClick={undoLastHighlight} disabled={!latestHighlight} className={`min-h-10 rounded-lg border px-3 py-2 text-xs disabled:opacity-40 ${themeStyle.button}`}>{t('reader.undoHighlight')}</button>
                    <button onClick={deleteCurrentPageHighlights} disabled={!textHighlights.length} className={`min-h-10 rounded-lg border px-3 py-2 text-xs disabled:opacity-40 ${themeStyle.button}`}>{t('reader.clearPageHighlights')}</button>
                  </div>
                </div>
              </div>
            )}

            {sidePanel === 'notes' && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => openPageNoteEditor()}
                  className="liquid-glass-btn-primary flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-white"
                >
                  <Plus size={16} />
                  {t('reader.addPageNote')}
                </button>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${themeStyle.subtle}`} />
                    <input value={annotationSearch} onChange={e => setAnnotationSearch(e.target.value)} placeholder={t('reader.searchNotes')} className="w-full rounded-xl py-2 pl-9 pr-3 text-sm outline-none transition-all duration-200 liquid-glass-input placeholder:text-slate-500" />
                  </div>
                  <button onClick={exportAnnotations} className={`rounded-xl border px-3 transition active:scale-95 ${themeStyle.button}`} aria-label={t('reader.exportNotes')}>
                    <Download size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={noteKindFilter}
                    onChange={event => setNoteKindFilter(event.target.value as AnnotationKindFilter)}
                    className={`min-h-10 rounded-xl border px-2 text-xs outline-none ${themeStyle.button}`}
                    aria-label={t('reader.filterNoteKind')}
                  >
                    <option value="all">{t('reader.filterAllNotes')}</option>
                    <option value="page">{t('reader.filterPageNotes')}</option>
                    <option value="source">{t('reader.filterSourceNotes')}</option>
                    <option value="area">{t('reader.filterAreaNotes')}</option>
                    <option value="snapshot">{t('reader.filterSnapshotNotes')}</option>
                    <option value="multi">{t('reader.filterMultiNotes')}</option>
                  </select>
                  <select
                    value={noteSort}
                    onChange={event => setNoteSort(event.target.value as AnnotationSort)}
                    className={`min-h-10 rounded-xl border px-2 text-xs outline-none ${themeStyle.button}`}
                    aria-label={t('reader.sortNotes')}
                  >
                    <option value="page-asc">{t('reader.sortByPage')}</option>
                    <option value="created-desc">{t('reader.sortNewest')}</option>
                    <option value="updated-desc">{t('reader.sortUpdated')}</option>
                  </select>
                  <select
                    value={noteTagFilter}
                    onChange={event => setNoteTagFilter(event.target.value)}
                    className={`min-h-10 rounded-xl border px-2 text-xs outline-none ${themeStyle.button}`}
                    aria-label={t('reader.filterTag')}
                  >
                    <option value="">{t('reader.allTags')}</option>
                    {availableNoteTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                  </select>
                  <select
                    value={noteCategoryFilter || ''}
                    onChange={event => setNoteCategoryFilter(event.target.value ? Number(event.target.value) : null)}
                    className={`min-h-10 rounded-xl border px-2 text-xs outline-none ${themeStyle.button}`}
                    aria-label={t('reader.filterCategory')}
                  >
                    <option value="">{t('reader.allCategories')}</option>
                    {annotationCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  <button
                    type="button"
                    aria-pressed={notesCurrentPageOnly}
                    onClick={() => setNotesCurrentPageOnly(value => !value)}
                    className={`min-h-10 rounded-xl border px-2 text-xs font-semibold ${notesCurrentPageOnly ? themeStyle.active : themeStyle.button}`}
                  >
                    {t('reader.currentPageOnly')}
                  </button>
                </div>
                <div className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 ${themeStyle.button}`}>
                  <button type="button" onClick={() => setSelectedAnnotationIds(filteredNotes.map(item => item.id))} className="rounded-lg px-2 py-1 text-[10px] font-semibold">{t('reader.selectVisibleAnnotations')}</button>
                  <button type="button" onClick={() => setSelectedAnnotationIds([])} className="rounded-lg px-2 py-1 text-[10px] font-semibold">{t('reader.clearAnnotationSelection')}</button>
                  <span className={`ml-auto text-[10px] ${themeStyle.subtle}`}>{t('reader.selectedAnnotations', { count: selectedAnnotationIds.length })}</span>
                  <select defaultValue="" onChange={event => { if (event.target.value) void bulkCategorizeAnnotations(Number(event.target.value)); event.currentTarget.value = '' }} disabled={!selectedAnnotationIds.length} className={`min-h-8 rounded-lg border px-2 text-[10px] ${themeStyle.button}`} aria-label={t('reader.bulkCategory')}>
                    <option value="">{t('reader.bulkCategory')}</option>
                    {annotationCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  <button type="button" onClick={() => { void bulkDeleteAnnotations() }} disabled={!selectedAnnotationIds.length} className="rounded-lg border border-red-400/25 px-2 py-1 text-[10px] font-semibold text-red-300 disabled:opacity-40">{t('reader.bulkDeleteAnnotations')}</button>
                </div>
                {filteredNotes.length === 0 ? (
                  <p className={`rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm ${themeStyle.subtle}`}>{t('reader.noNotes')}</p>
                ) : (
                  filteredNotes.map(item => (
                    <div key={item.id} className={`group relative rounded-2xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md border-violet-500/25 bg-gradient-to-br from-violet-500/8 to-violet-500/2 ${selectedAnnotationIds.includes(item.id) ? 'ring-2 ring-violet-300/60' : ''}`}>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <input type="checkbox" checked={selectedAnnotationIds.includes(item.id)} onChange={() => setSelectedAnnotationIds(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} aria-label={t('reader.selectAnnotation')} className="h-4 w-4 shrink-0" />
                          <button onClick={() => showAnnotationOnPage(item)} className="truncate text-left text-xs font-semibold opacity-70 hover:opacity-100 transition-opacity">
                            {item.content.pageNote ? `${t('reader.addPageNote')} · ` : ''}{t('reader.pageOf', { current: item.page, total: numPages || '?' })}
                          </button>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => showAnnotationOnPage(item)} className="rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-white transition-colors" aria-label={t('reader.showOnPage')} title={t('reader.showOnPage')}>
                            <ArrowUpRight size={15} />
                          </button>
                          <button onClick={() => copyAnnotationLink(item)} className="rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-white transition-colors" aria-label={t('reader.copyNoteLink')} title={t('reader.copyNoteLink')}>
                            <Copy size={15} />
                          </button>
                          <button onClick={() => openAnnotationEditor(item)} className="rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-white transition-colors" aria-label={t('reader.editNote')} title={t('reader.editNote')}>
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => deleteAnnotation(item.id)} className="rounded-lg p-1 text-slate-500 hover:bg-red-500/15 hover:text-red-300 transition-colors" aria-label={t('common.delete')}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      {item.content.text && <p className={`text-xs italic leading-relaxed border-l-2 pl-2 border-violet-500/30 ${themeStyle.subtle}`}>&quot;{cleanText(item.content.text)}&quot;</p>}
                      {(item.content.snapshot?.previewUrl || item.content.area?.previewUrl) && (
                        <button type="button" onClick={() => showAnnotationOnPage(item)} className="mt-2 block w-full overflow-hidden rounded-xl border border-white/10 bg-black/15 p-1.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={item.content.snapshot?.previewUrl || item.content.area?.previewUrl} alt={t('reader.snapshotPreview')} className="max-h-32 w-full rounded-lg object-contain" />
                        </button>
                      )}
                      {item.content.note && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{cleanText(item.content.note)}</p>}
                      {normalizeAudioCursor(item.content.audioCursor) && (() => {
                        const cursor = normalizeAudioCursor(item.content.audioCursor)!
                        return (
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className={`rounded-full border px-2 py-1 ${themeStyle.button}`}>{audioCursorLabel(cursor)}{audioCursorTime(cursor) ? ` · ${audioCursorTime(cursor)}` : ''}</span>
                            <button type="button" onClick={() => resumeFromAudioNote(item)} className={`rounded-lg border px-2 py-1 font-semibold ${themeStyle.active}`}>
                              {cursor.source === 'rsvp' ? t('reader.audioNoteJump') : t('reader.audioNoteResume')}
                            </button>
                          </div>
                        )
                      })()}
                      {item.content.categoryId && annotationCategories.find(category => category.id === item.content.categoryId) && (() => {
                        const category = annotationCategories.find(candidate => candidate.id === item.content.categoryId)!
                        return (
                          <button type="button" onClick={() => setNoteCategoryFilter(category.id)} className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold ${themeStyle.button}`}>
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color }} />
                            {category.name}
                          </button>
                        )
                      })()}
                      {item.content.sources && item.content.sources.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {item.content.sources.map((source, index) => (
                            <button
                              key={`${item.id}-source-${index}`}
                              type="button"
                              onClick={() => showAnnotationOnPage(item, index)}
                              className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${themeStyle.button}`}
                            >
                              {t('reader.sourceNumber', { number: index + 1 })} · {t('common.pageShort')} {source.page}
                            </button>
                          ))}
                        </div>
                      )}
                      {normalizeAnnotationTags(item.content.tags).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {normalizeAnnotationTags(item.content.tags).map(tag => (
                            <button key={tag} type="button" onClick={() => setNoteTagFilter(tag)} className={`rounded-full border px-2 py-0.5 text-[10px] ${themeStyle.button}`}>
                              {tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {sidePanel === 'highlights' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${themeStyle.subtle}`} />
                    <input value={annotationSearch} onChange={e => setAnnotationSearch(e.target.value)} placeholder={t('reader.searchNotes')} className="w-full rounded-xl py-2 pl-9 pr-3 text-sm outline-none transition-all duration-200 liquid-glass-input placeholder:text-slate-500" />
                  </div>
                  <button onClick={exportAnnotations} className={`rounded-xl border px-3 transition active:scale-95 ${themeStyle.button}`} aria-label={t('reader.exportNotes')}>
                    <Download size={16} />
                  </button>
                </div>
                <div className={`flex items-center gap-2 rounded-xl border p-2 ${themeStyle.button}`}>
                  <button type="button" onClick={() => setSelectedAnnotationIds(filteredHighlights.map(item => item.id))} className="rounded-lg px-2 py-1 text-[10px] font-semibold">{t('reader.selectVisibleAnnotations')}</button>
                  <button type="button" onClick={() => setSelectedAnnotationIds([])} className="rounded-lg px-2 py-1 text-[10px] font-semibold">{t('reader.clearAnnotationSelection')}</button>
                  <span className={`ml-auto text-[10px] ${themeStyle.subtle}`}>{t('reader.selectedAnnotations', { count: selectedAnnotationIds.length })}</span>
                  <button type="button" onClick={() => { void bulkDeleteAnnotations() }} disabled={!selectedAnnotationIds.length} className="rounded-lg border border-red-400/25 px-2 py-1 text-[10px] font-semibold text-red-300 disabled:opacity-40">{t('reader.bulkDeleteAnnotations')}</button>
                </div>
                {filteredHighlights.length === 0 ? (
                  <p className={`rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm ${themeStyle.subtle}`}>{t('reader.noNotes')}</p>
                ) : (
                  filteredHighlights.map(item => (
                    <div key={item.id} className={`group relative rounded-2xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${selectedAnnotationIds.includes(item.id) ? 'ring-2 ring-amber-300/60' : ''}`} style={{ borderColor: `${item.content.color || '#facc15'}33`, background: `linear-gradient(135deg, ${item.content.color || '#facc15'}12, ${item.content.color || '#facc15'}04)` }}>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2"><input type="checkbox" checked={selectedAnnotationIds.includes(item.id)} onChange={() => setSelectedAnnotationIds(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} aria-label={t('reader.selectAnnotation')} className="h-4 w-4" /><button onClick={() => goToPage(item.page)} className="text-left text-xs font-semibold opacity-70 hover:opacity-100 transition-opacity">{t('reader.pageOf', { current: item.page, total: numPages || '?' })}</button></div>
                        <button onClick={() => deleteAnnotation(item.id)} className="rounded-lg p-1 text-slate-500 hover:bg-red-500/15 hover:text-red-300 transition-colors" aria-label={t('common.delete')}><Trash2 size={15} /></button>
                      </div>
                      {item.content.text && (
                        <p className="text-sm leading-relaxed" style={{ borderLeft: `2.5px solid ${item.content.color || '#facc15'}`, paddingLeft: '8px' }}>
                          {cleanText(item.content.text)}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {sidePanel === 'bookmarks' && (
              <div className="space-y-2">
                {bookmarks.length === 0 ? (
                  <p className={`rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm ${themeStyle.subtle}`}>{t('reader.noBookmarks')}</p>
                ) : (
                  bookmarks.map(item => (
                    <div key={item.id} className="flex items-center gap-2 rounded-xl border border-yellow-300/20 bg-yellow-300/10 px-3 py-2">
                      <button onClick={() => goToPage(item.page)} className="flex-1 text-left text-sm font-medium text-yellow-100">{t('reader.pageOf', { current: item.page, total: numPages || '?' })}</button>
                      <button onClick={async () => { if (isEncrypted) await deleteEncryptedBookmark(bookId, item.id); else await fetch(`/api/bookmarks?id=${item.id}`, { method: 'DELETE' }); setBookmarks(prev => prev.filter(bookmark => bookmark.id !== item.id)) }} className="rounded-lg p-1 text-yellow-200/60 hover:bg-red-500/15 hover:text-red-300" aria-label={t('common.delete')}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {sidePanel === 'ask-ai' && (
              <div className="space-y-3">
                <p className={`text-xs font-semibold uppercase tracking-wide ${themeStyle.subtle}`}>{t('reader.askAi')}</p>
                <p className={`text-xs ${themeStyle.subtle}`}>{t('reader.askAiContextSent', { page: currentPage })}</p>
                <textarea
                  value={aiQuestion}
                  onChange={e => setAiQuestion(e.target.value)}
                  placeholder={t('reader.askAiPlaceholder')}
                  className="h-24 w-full resize-none rounded-xl border border-white/10 bg-white/[0.06] p-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400/60"
                />
                <button
                  onClick={askAi}
                  disabled={aiLoading || !aiQuestion.trim()}
                  className={`w-full rounded-xl px-3 py-2 text-sm font-semibold ${aiLoading || !aiQuestion.trim() ? 'bg-slate-700 text-slate-400' : 'bg-violet-600 text-white hover:bg-violet-500'}`}
                >
                  {aiLoading ? '...' : t('reader.askAiSend')}
                </button>
                {aiAnswer && (
                  <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-relaxed">
                    {aiAnswer}
                  </div>
                )}
              </div>
            )}

            {sidePanel === 'outline' && (
              <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
                {pdfOutline.length === 0 ? (
                  <p className={`rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm ${themeStyle.subtle}`}>{t('reader.noOutline')}</p>
                ) : (
                  pdfOutline.map((item, index) => (
                    <button
                      key={index}
                      onClick={async () => {
                        if (!item.dest || !pdfDocRef.current) return
                        try {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const docAny = pdfDocRef.current as any
                          let explicitDest = item.dest
                          if (typeof item.dest === 'string') {
                            explicitDest = await docAny.getDestination(item.dest)
                          }
                          if (typeof explicitDest === 'number') {
                            goToPage(explicitDest)
                            return
                          }
                          if (Array.isArray(explicitDest) && explicitDest[0]) {
                            const pageRef = explicitDest[0]
                            if (typeof pageRef === 'object' && pageRef !== null && 'num' in pageRef) {
                              const pageIndex = await docAny.getPageIndex(pageRef)
                              if (typeof pageIndex === 'number') {
                                goToPage(pageIndex + 1)
                                return
                              }
                            }
                            if (typeof pageRef === 'number') {
                              goToPage(pageRef + 1)
                              return
                            }
                          }
                        } catch (err) {
                          console.warn('Failed to resolve TOC destination:', err)
                        }
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.07] transition-colors ${themeStyle.text}`}
                    >
                      <ChevronRight size={13} className="shrink-0 opacity-40" />
                      <span className="min-w-0 truncate">{item.title}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {popup && (
        <SelectionPopup
          x={popup.x}
          y={popup.y}
          selectedText={popup.text}
          selectedRects={popup.rects}
          bookId={bookId}
          currentPage={popup.page}
          onClose={() => {
            setPopup(null)
            canonicalSelectionRef.current = null
            setCanonicalSelection(null)
          }}
          onAnnotationSaved={annotation => setAnnotations(prev => [...prev, annotation])}
          onToast={toast}
          onCollectSource={sourceCollectMode ? addCollectedSource : undefined}
          isEncrypted={isEncrypted}
          onSaveAnnotation={isEncrypted ? input => saveEncryptedAnnotation(bookId, input) : undefined}
          onSaveWord={isEncrypted ? input => saveEncryptedWord(bookId, input).then(() => undefined) : undefined}
        />
      )}
      {sourceCollectMode && (
        <div className={`fixed bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+4.5rem))] left-1/2 z-[180] w-[min(34rem,calc(100vw-1rem))] -translate-x-1/2 rounded-2xl border p-3 shadow-[0_20px_70px_rgba(0,0,0,0.45)] ${themeStyle.panel}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-bold ${themeStyle.text}`}>{t('reader.multiSourceNote')}</p>
              <p className={`text-xs ${themeStyle.subtle}`}>{t('reader.collectedSourceCount', { count: sourceCollection.length })}</p>
            </div>
            <button type="button" onClick={cancelSourceCollection} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.cancel')}>
              <X size={15} />
            </button>
          </div>
          {sourceCollection.length > 0 && (
            <div className="mt-2 flex max-h-24 gap-2 overflow-x-auto pb-1">
              {sourceCollection.map((source, index) => (
                <div key={`${source.page}-${index}`} className="min-w-32 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{t('common.pageShort')} {source.page}</span>
                    <button type="button" onClick={() => setSourceCollection(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('common.delete')}><X size={12} /></button>
                  </div>
                  <p className={`mt-1 line-clamp-2 ${themeStyle.subtle}`}>{cleanText(source.text || '')}</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={cancelSourceCollection} className={`min-h-10 flex-1 rounded-xl border px-3 text-xs font-semibold ${themeStyle.button}`}>{t('common.cancel')}</button>
            <button type="button" onClick={createMultiSourceNote} disabled={!sourceCollection.length} className="liquid-glass-btn-primary min-h-10 flex-1 rounded-xl px-3 text-xs font-bold text-white disabled:opacity-40">{t('reader.writeCombinedNote')}</button>
          </div>
        </div>
      )}
      {noteEditor && (
        <AnnotationEditor
          bookId={bookId}
          page={noteEditor.page}
          annotation={noteEditor.annotation}
          initialContent={noteEditor.initialContent}
          pageNote={noteEditor.pageNote}
          themeStyle={themeStyle}
          saving={noteSaving}
          categories={annotationCategories}
          onManageCategories={() => setShowCategoryManager(true)}
          onSave={saveAnnotationEditor}
          onClose={() => setNoteEditor(null)}
        />
      )}
      {showCategoryManager && (
        <AnnotationCategoryManager
          categories={annotationCategories}
          themeStyle={themeStyle}
          onChange={categories => {
            setAnnotationCategories(categories)
            if (noteCategoryFilter && !categories.some(category => category.id === noteCategoryFilter)) setNoteCategoryFilter(null)
            if (isEncrypted) void listEncryptedAnnotations(bookId).then(setAnnotations).catch(() => {})
            else fetch(`/api/annotations?book_id=${bookId}`).then(res => res.json()).then(data => { if (Array.isArray(data)) setAnnotations(data) }).catch(() => {})
          }}
          onClose={() => setShowCategoryManager(false)}
        />
      )}
      {ocrText && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4" onClick={e => { if (e.target === e.currentTarget) setOcrText('') }}>
          <div className={`w-full max-w-2xl rounded-xl border p-4 shadow-2xl ${themeStyle.panel}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{t('reader.ocrResult')}</p>
              <button onClick={() => setOcrText('')} className={`rounded-lg border p-2 ${themeStyle.button}`} aria-label={t('common.close')}>
                <X size={16} />
              </button>
            </div>
            <textarea readOnly value={ocrText} className="h-72 w-full resize-none rounded-lg border border-white/10 bg-black/20 p-3 text-sm leading-relaxed outline-none" />
            <button onClick={async () => {
              const copied = await copyTextToClipboard(ocrText)
              toast(copied ? 'Kopyalandı.' : 'Metin panoya kopyalanamadı.', copied ? 'info' : 'error')
            }} className={`mt-3 rounded-lg border px-3 py-2 text-sm ${themeStyle.button}`}>
              <Copy size={15} className="mr-2 inline" />
              {t('common.copy')}
            </button>
          </div>
        </div>
      )}
      <ToastContainer messages={toastMessages} onRemove={removeToast} />
      {showBugReport && (
        <BugReportDialog
          libraryTheme={_libraryTheme || 'dark'}
          onClose={() => setShowBugReport(false)}
          onSent={() => { setShowBugReport(false); toast(t('bug.sent')) }}
        />
      )}
      <RsvpReader open={rsvpOpen} onClose={() => { setRsvpOpen(false); setReadingCursor(cursor => createReadingCursor(currentPage, cursor.wordIndex, 'idle')) }} getWordsForPage={getRsvpWords} getCuesForPage={getRsvpCues} initialWordIndex={readingCursor.wordIndex} resolveStartIndex={words => readingCursor.wordIndex > 0 ? Math.min(readingCursor.wordIndex, Math.max(0, words.length - 1)) : resolveRsvpStartIndex(words)} currentPage={currentPage} numPages={numPages} onRequestPage={goToPage} onPositionChange={({ page, wordIndex }) => { setRsvpWordIndex(wordIndex); setReadingCursor(createReadingCursor(page, wordIndex, 'rsvp')) }} onCreateAudioNote={openAudioLinkedNote} themeStyle={themeStyle} theme={theme} fileUrl={resolvedFileUrl} t={t as (k: string) => string} onStartReadingSession={sessionPaused ? resumeReadingSession : undefined} onStopReadingSession={!sessionPaused ? stopReadingSession : undefined} onSpeakText={speakText} bookTitle={displayBookTitle} bookId={bookId} onAnnotationSaved={(ann) => {
        setAnnotations(prev => [...prev, ann])
      }} onToast={toast} />
    </div>
  )
}
