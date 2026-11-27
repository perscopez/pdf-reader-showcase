import { buildReflowPage, type ReflowBlock, type ReflowPage } from './reflow'
import { cleanText, isGarbledToken } from './text'

export const PAGE_TEXT_MODEL_VERSION = 5
export const PAGE_TEXT_OCR_THRESHOLD = 0.58

export type PageTextSource = 'native' | 'ocr'
export type PageTextEngine = 'pdfjs' | 'poppler' | 'tesseract.js' | 'unknown'

export interface PageTextProvenance {
  documentFingerprint?: string
  engine: PageTextEngine
  engineVersion?: string
  languages?: string[]
  dpi?: number
  rotation: 0 | 90 | 180 | 270
}

export interface PdfTextItemLike {
  str?: string
  width?: number
  height?: number
  transform?: number[]
  hasEOL?: boolean
  dir?: string
}

export interface PageTextWord {
  /** Deterministic identity within this page/model extraction. */
  id?: string
  /** Reading-order index and character offsets into PageTextModel.text. */
  order?: number
  startOffset?: number
  endOffset?: number
  text: string
  left: number
  top: number
  width: number
  height: number
  line: number
  confidence?: number
}

function stableWordId(word: PageTextWord, order: number) {
  const source = `${order}:${word.line}:${word.left.toFixed(6)}:${word.top.toFixed(6)}:${word.text}`
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `word-${order}-${(hash >>> 0).toString(36)}`
}

function addWordIdentity(words: PageTextWord[], pageText: string) {
  let cursor = 0
  return words.map((word, order) => {
    const exactStart = pageText.indexOf(word.text, cursor)
    const startOffset = exactStart >= 0 ? exactStart : cursor
    const endOffset = startOffset + word.text.length
    cursor = endOffset
    return {
      ...word,
      id: stableWordId(word, order),
      order,
      startOffset,
      endOffset,
    }
  })
}

export interface PageTextModel {
  version: number
  source: PageTextSource
  quality: number
  needsOcr: boolean
  text: string
  blocks: ReflowBlock[]
  words: PageTextWord[]
  provenance: PageTextProvenance
}

export function buildDocumentRevisionFingerprint(input: { filename: string; size: number; mtimeMs: number }) {
  const normalizedName = input.filename.normalize('NFKC').toLowerCase()
  let hash = 2166136261
  for (const character of normalizedName) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return `file-v1-${Math.max(0, input.size).toString(36)}-${Math.max(0, Math.floor(input.mtimeMs)).toString(36)}-${(hash >>> 0).toString(36)}`
}

export function pageTextModelMatchesDocument(model: PageTextModel, documentFingerprint: string) {
  return model.provenance.documentFingerprint === documentFingerprint
}

function normalizeRotation(value: unknown): 0 | 90 | 180 | 270 {
  return value === 90 || value === 180 || value === 270 ? value : 0
}

function provenance(
  defaults: PageTextProvenance,
  overrides?: Partial<PageTextProvenance>,
): PageTextProvenance {
  return {
    ...defaults,
    ...overrides,
    rotation: normalizeRotation(overrides?.rotation ?? defaults.rotation),
    languages: (overrides?.languages ?? defaults.languages)
      ?.filter(value => typeof value === 'string' && value.length <= 32)
      .slice(0, 8),
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function safeText(value: unknown) {
  return cleanText(typeof value === 'string' ? value : '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ﬁﬂﬃﬄ]/g, character => ({
      ﬁ: 'fi',
      ﬂ: 'fl',
      ﬃ: 'ffi',
      ﬄ: 'ffl',
    }[character] || character))
}

function nativeWords(
  items: PdfTextItemLike[],
  pageWidth: number,
  pageHeight: number,
): PageTextWord[] {
  const positioned = items.flatMap(item => {
    const text = safeText(item.str).trim()
    const transform = item.transform || []
    if (!text || transform.length < 6 || pageWidth <= 0 || pageHeight <= 0) return []

    const itemWidth = Math.max(Number(item.width) || 0, 1)
    const itemHeight = Math.max(Number(item.height) || Math.abs(Number(transform[3])) || 12, 1)
    const itemLeft = Number(transform[4]) || 0
    const itemTop = pageHeight - (Number(transform[5]) || 0) - itemHeight
    const tokens = [...text.matchAll(/\S+/g)]
    const characterCount = Math.max(1, text.length)

    return tokens.map(token => {
      const tokenText = token[0]
      const start = token.index || 0
      const width = itemWidth * (tokenText.length / characterCount)
      return {
        text: tokenText,
        left: clamp01((itemLeft + itemWidth * (start / characterCount)) / pageWidth),
        top: clamp01(itemTop / pageHeight),
        width: clamp01(width / pageWidth),
        height: clamp01(itemHeight / pageHeight),
        line: 0,
      }
    })
  })

  const sorted = positioned.sort((a, b) => {
    const tolerance = Math.max(a.height, b.height) * 0.45
    return Math.abs(a.top - b.top) > tolerance ? a.top - b.top : a.left - b.left
  })
  const lineTops: number[] = []
  sorted.forEach(word => {
    let line = lineTops.findIndex(top => Math.abs(top - word.top) <= Math.max(0.004, word.height * 0.45))
    if (line === -1) {
      lineTops.push(word.top)
      line = lineTops.length - 1
    }
    word.line = line
  })
  return sorted
}

export function scoreNativeText(items: PdfTextItemLike[], text: string) {
  const normalized = safeText(text).trim()
  if (!normalized) return 0

  const characters = [...normalized]
  const badCharacters = characters.filter(character =>
    character === '\uFFFD'
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000-\uF8FF]/u.test(character)
  ).length
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const garbled = tokens.filter(isGarbledToken).length
  const suspiciousMappedTokens = tokens.filter(token => {
    const prefix = token.split(/['’]/, 1)[0]
    return /['’]/.test(token)
      && prefix.length >= 3
      && /^[A-ZÇĞİÖŞÜ][a-zçğıöşü]+$/u.test(prefix)
      && !/[aeıioöuü]/iu.test(prefix)
  }).length
  const textualItems = items.map(item => safeText(item.str).trim()).filter(Boolean)
  const singleGlyphRatio = textualItems.length
    ? textualItems.filter(value => [...value].length === 1 && /\p{L}/u.test(value)).length / textualItems.length
    : 0

  let score = 1
  score -= Math.min(0.75, (badCharacters / Math.max(1, characters.length)) * 12)
  score -= Math.min(0.65, (garbled / Math.max(1, tokens.length)) * 1.5)
  if (suspiciousMappedTokens > 0) score -= 0.5
  // A character-by-character text layer can be reflowed for search/TTS, but
  // native browser selection still inserts false boundaries between spans.
  // Route heavily fragmented pages through the aligned OCR selection layer.
  if (singleGlyphRatio > 0.7) score -= 0.48
  if (characters.length < 3) score -= 0.2
  return Number(clamp01(score).toFixed(3))
}

export function buildNativePageTextModel(
  items: PdfTextItemLike[],
  viewport: { width: number; height: number },
  modelProvenance?: Partial<PageTextProvenance>,
): PageTextModel {
  const cleanedItems = items.map(item => ({ ...item, str: safeText(item.str) }))
  const reflow: ReflowPage = buildReflowPage(cleanedItems)
  const quality = scoreNativeText(cleanedItems, reflow.text)
  const words = addWordIdentity(nativeWords(cleanedItems, viewport.width, viewport.height), reflow.text)
  return {
    version: PAGE_TEXT_MODEL_VERSION,
    source: 'native',
    quality,
    needsOcr: quality < PAGE_TEXT_OCR_THRESHOLD,
    text: reflow.text,
    blocks: reflow.blocks,
    words,
    provenance: provenance({ engine: 'pdfjs', rotation: 0 }, modelProvenance),
  }
}

interface TsvRow {
  level: number
  block: number
  paragraph: number
  line: number
  word: number
  left: number
  top: number
  width: number
  height: number
  confidence: number
  text: string
}

function parseTsvRows(tsv: string): TsvRow[] {
  const rows = tsv.replace(/\r/g, '').split('\n')
  if (rows.length < 2) return []
  return rows.slice(1).flatMap(line => {
    const columns = line.split('\t')
    if (columns.length < 12 || Number(columns[0]) !== 5) return []
    const text = safeText(columns.slice(11).join('\t')).trim()
    if (!text) return []
    return [{
      level: Number(columns[0]),
      block: Number(columns[2]),
      paragraph: Number(columns[3]),
      line: Number(columns[4]),
      word: Number(columns[5]),
      left: Number(columns[6]),
      top: Number(columns[7]),
      width: Number(columns[8]),
      height: Number(columns[9]),
      confidence: Number(columns[10]),
      text,
    }]
  })
}

export function buildOcrPageTextModel(
  tsv: string,
  image: { width: number; height: number },
  modelProvenance?: Partial<PageTextProvenance>,
): PageTextModel {
  const rows = parseTsvRows(tsv)
    .filter(row => row.width > 0 && row.height > 0 && row.confidence >= 0)
    .sort((a, b) =>
      a.block - b.block
      || a.paragraph - b.paragraph
      || a.line - b.line
      || a.word - b.word
    )
  const rawWords: PageTextWord[] = rows.map(row => ({
    text: row.text,
    left: clamp01(row.left / Math.max(1, image.width)),
    top: clamp01(row.top / Math.max(1, image.height)),
    width: clamp01(row.width / Math.max(1, image.width)),
    height: clamp01(row.height / Math.max(1, image.height)),
    line: row.block * 1_000_000 + row.paragraph * 10_000 + row.line,
    confidence: clamp01(row.confidence / 100),
  }))

  const paragraphKeys: string[] = []
  const paragraphWords = new Map<string, string[]>()
  rows.forEach(row => {
    const key = `${row.block}:${row.paragraph}`
    if (!paragraphWords.has(key)) {
      paragraphKeys.push(key)
      paragraphWords.set(key, [])
    }
    paragraphWords.get(key)?.push(row.text)
  })
  const blocks = paragraphKeys.map<ReflowBlock>(key => ({
    type: 'paragraph',
    text: paragraphWords.get(key)?.join(' ').replace(/\s+([,.;:!?%)\]}])/g, '$1') || '',
  })).filter(block => block.text)
  const text = blocks.map(block => block.text).join('\n\n')
  const words = addWordIdentity(rawWords, text)
  const averageConfidence = words.length
    ? words.reduce((sum, word) => sum + (word.confidence || 0), 0) / words.length
    : 0
  const quality = Number(clamp01(averageConfidence).toFixed(3))

  return {
    version: PAGE_TEXT_MODEL_VERSION,
    source: 'ocr',
    quality,
    needsOcr: false,
    text,
    blocks,
    words,
    provenance: provenance({ engine: 'tesseract.js', languages: ['eng', 'tur'], rotation: 0 }, modelProvenance),
  }
}

export function isValidPageTextModel(value: unknown): value is PageTextModel {
  if (!value || typeof value !== 'object') return false
  const model = value as Partial<PageTextModel>
  if (model.version !== PAGE_TEXT_MODEL_VERSION || !['native', 'ocr'].includes(model.source || '')) return false
  if (typeof model.text !== 'string' || model.text.length > 250_000) return false
  if (!Array.isArray(model.blocks) || model.blocks.length > 5_000) return false
  if (!Array.isArray(model.words) || model.words.length > 50_000) return false
  if (typeof model.quality !== 'number' || model.quality < 0 || model.quality > 1) return false
  if (!model.provenance || typeof model.provenance !== 'object') return false
  if (!['pdfjs', 'poppler', 'tesseract.js', 'unknown'].includes(model.provenance.engine || '')) return false
  if (![0, 90, 180, 270].includes(model.provenance.rotation)) return false
  if (model.provenance.documentFingerprint !== undefined && (
    typeof model.provenance.documentFingerprint !== 'string'
    || model.provenance.documentFingerprint.length > 200
  )) return false
  if (model.provenance.engineVersion !== undefined && (
    typeof model.provenance.engineVersion !== 'string' || model.provenance.engineVersion.length > 80
  )) return false
  if (model.provenance.languages !== undefined && (
    !Array.isArray(model.provenance.languages)
    || model.provenance.languages.length > 8
    || model.provenance.languages.some(language => typeof language !== 'string' || language.length > 32)
  )) return false
  if (model.provenance.dpi !== undefined && (
    typeof model.provenance.dpi !== 'number' || !Number.isFinite(model.provenance.dpi)
    || model.provenance.dpi < 36 || model.provenance.dpi > 1200
  )) return false
  return model.words.every(word =>
    word
    && typeof word.text === 'string'
    && word.text.length <= 500
    && (word.id === undefined || (typeof word.id === 'string' && word.id.length <= 120))
    && (word.order === undefined || (Number.isInteger(word.order) && word.order >= 0 && word.order < 50_000))
    && (word.startOffset === undefined || (Number.isInteger(word.startOffset) && word.startOffset >= 0 && word.startOffset <= model.text!.length))
    && (word.endOffset === undefined || (Number.isInteger(word.endOffset) && word.endOffset >= (word.startOffset || 0) && word.endOffset <= model.text!.length + 500))
    && [word.left, word.top, word.width, word.height].every(number =>
      typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1
    )
  )
}
