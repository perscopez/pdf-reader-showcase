import { joinWrappedTextLines } from './text'

export type ReflowBlockType = 'heading' | 'paragraph' | 'list' | 'caption'

export interface ReflowBlock {
  type: ReflowBlockType
  text: string
}

export interface ReflowPage {
  version: 1
  blocks: ReflowBlock[]
  text: string
}

interface PdfTextItem {
  str?: string
  width?: number
  height?: number
  transform?: number[]
  hasEOL?: boolean
}

interface TextSpan {
  text: string
  x: number
  y: number
  width: number
  height: number
  hasEOL: boolean
}

interface TextLine {
  text: string
  x: number
  y: number
  height: number
  width: number
}

const LIST_RE = /^(?:[-*\u2022\u25cf\u25e6]|\d+[.)]|[a-zA-Z][.)])\s+/
const SENTENCE_END_RE = /[.!?\u2026][\])}'"\u201d\u2019]*$/

function median(values: number[]): number {
  if (values.length === 0) return 12
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function cleanInlineText(value: string): string {
  return value
    .replace(/[\uF761-\uF77A]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xF761 + 97))
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function joinLineSpans(spans: TextSpan[]): string {
  const sorted = [...spans].sort((a, b) => a.x - b.x)
  let result = ''
  for (let index = 0; index < sorted.length; index += 1) {
    const span = sorted[index]
    if (!span.text) continue
    if (!result) {
      result = span.text
      continue
    }
    const previous = sorted[index - 1]
    const gap = span.x - (previous.x + previous.width)
    const needsSpace = gap > Math.max(1.5, previous.height * 0.12)
      && !/[\s([{/'"\u201c\u2018-]$/.test(result)
      && !/^[,.;:!?%)\]}'"\u201d\u2019]/.test(span.text)
    result += `${needsSpace ? ' ' : ''}${span.text}`
  }
  return cleanInlineText(result)
}

function makeLines(items: PdfTextItem[]): TextLine[] {
  const spans = items.flatMap<TextSpan>(item => {
    const text = cleanInlineText(item.str || '')
    const transform = item.transform || []
    if (!text || transform.length < 6) return []
    const height = Math.max(Number(item.height) || Math.abs(transform[3]) || Math.abs(transform[0]) || 12, 1)
    return [{
      text,
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: Math.max(Number(item.width) || text.length * height * 0.45, 1),
      height,
      hasEOL: Boolean(item.hasEOL),
    }]
  })

  const sorted = spans.sort((a, b) => Math.abs(a.y - b.y) > Math.max(2, Math.min(a.height, b.height) * 0.35)
    ? b.y - a.y
    : a.x - b.x)
  const groups: TextSpan[][] = []

  for (const span of sorted) {
    const line = groups.find(group => Math.abs(group[0].y - span.y) <= Math.max(2.5, Math.min(group[0].height, span.height) * 0.38))
    if (line) line.push(span)
    else groups.push([span])
  }

  return groups
    .flatMap(group => {
      const ordered = [...group].sort((a, b) => a.x - b.x)
      const segments: TextSpan[][] = []
      for (const span of ordered) {
        const segment = segments[segments.length - 1]
        const previous = segment?.[segment.length - 1]
        const gap = previous ? span.x - (previous.x + previous.width) : 0
        if (!segment || gap > Math.max(32, median([previous.height, span.height]) * 4)) segments.push([span])
        else segment.push(span)
      }
      return segments.map(segment => {
      const x = Math.min(...segment.map(span => span.x))
      const right = Math.max(...segment.map(span => span.x + span.width))
      return {
        text: joinLineSpans(segment),
        x,
        y: segment.reduce((sum, span) => sum + span.y, 0) / segment.length,
        height: median(segment.map(span => span.height)),
        width: right - x,
      }
      })
    })
    .filter(line => line.text)
    .sort((a, b) => b.y - a.y || a.x - b.x)
}

function orderColumns(lines: TextLine[]): TextLine[] {
  if (lines.length < 8) return lines
  const pageLeft = Math.min(...lines.map(line => line.x))
  const pageRight = Math.max(...lines.map(line => line.x + line.width))
  const pageWidth = pageRight - pageLeft
  if (pageWidth <= 0) return lines

  const midpoint = pageLeft + pageWidth / 2
  const bodyHeight = median(lines.map(line => line.height))
  const left = lines.filter(line => line.x + line.width <= midpoint + bodyHeight)
  const right = lines.filter(line => line.x >= midpoint - bodyHeight)
  if (left.length < 3 || right.length < 3) return lines

  const leftRange = [Math.min(...left.map(line => line.y)), Math.max(...left.map(line => line.y))]
  const rightRange = [Math.min(...right.map(line => line.y)), Math.max(...right.map(line => line.y))]
  const overlap = Math.max(0, Math.min(leftRange[1], rightRange[1]) - Math.max(leftRange[0], rightRange[0]))
  const shortestRange = Math.max(1, Math.min(leftRange[1] - leftRange[0], rightRange[1] - rightRange[0]))
  if (overlap / shortestRange < 0.45) return lines

  const columnSet = new Set([...left, ...right])
  const spanning = lines.filter(line => !columnSet.has(line))
  const highestColumnY = Math.max(...left.map(line => line.y), ...right.map(line => line.y))
  const top = spanning.filter(line => line.y >= highestColumnY - bodyHeight * 1.5)
  const rest = spanning.filter(line => !top.includes(line))
  const vertical = (a: TextLine, b: TextLine) => b.y - a.y || a.x - b.x

  return [
    ...top.sort(vertical),
    ...left.sort(vertical),
    ...right.sort(vertical),
    ...rest.sort(vertical),
  ]
}

export function buildReflowPage(items: PdfTextItem[]): ReflowPage {
  const lines = orderColumns(makeLines(items))
  if (lines.length === 0) return { version: 1, blocks: [], text: '' }

  const bodyHeight = median(lines.map(line => line.height))
  const typicalGap = median(lines.slice(1).map((line, index) => Math.abs(lines[index].y - line.y)))
  const blocks: ReflowBlock[] = []
  let pending: { type: ReflowBlockType; text: string; line: TextLine } | null = null

  const flush = () => {
    if (!pending?.text) return
    blocks.push({ type: pending.type, text: cleanInlineText(pending.text) })
    pending = null
  }

  for (const line of lines) {
    const previous = pending?.line
    const verticalGap = previous ? Math.abs(previous.y - line.y) : 0
    const isHeading = line.height >= bodyHeight * 1.22 && line.text.length <= 140
    const isList = LIST_RE.test(line.text)
    const isCaption = line.height <= bodyHeight * 0.82 && line.text.length <= 180
    const type: ReflowBlockType = isHeading ? 'heading' : isList ? 'list' : isCaption ? 'caption' : 'paragraph'
    const indented = previous ? Math.abs(line.x - previous.x) > bodyHeight * 1.5 : false
    const paragraphBreak = Boolean(previous && (
      verticalGap > Math.max(bodyHeight * 1.55, typicalGap * 1.45)
      || indented
      || SENTENCE_END_RE.test(pending?.text || '') && verticalGap > typicalGap * 1.12
    ))

    if (!pending || pending.type !== type || type === 'heading' || type === 'list' || paragraphBreak) {
      flush()
      pending = { type, text: line.text, line }
    } else {
      pending.text = joinWrappedTextLines(pending.text, line.text)
      pending.line = line
    }
  }
  flush()

  const text = blocks.map(block => block.text).join('\n\n')
  return { version: 1, blocks, text }
}

interface PlainLine {
  text: string
  indent: number
  blankBefore: boolean
}

function isLikelyHeading(text: string, index: number, blankBefore: boolean): boolean {
  if (text.length > 120 || (!blankBefore && index > 2)) return false
  const letters = text.match(/\p{L}/gu) || []
  if (letters.length < 3) return false
  const uppercase = letters.filter(letter => letter === letter.toLocaleUpperCase('tr-TR')).length
  return uppercase / letters.length >= 0.78
}

function layoutMetadata(layoutText: string): Array<{ indent: number; blankBefore: boolean }> {
  const metadata: Array<{ indent: number; blankBefore: boolean }> = []
  let blankBefore = true
  for (const rawLine of layoutText.replace(/\r/g, '').split('\n')) {
    if (!rawLine.trim()) {
      blankBefore = true
      continue
    }
    metadata.push({ indent: rawLine.length - rawLine.trimStart().length, blankBefore })
    blankBefore = false
  }
  return metadata
}

export function buildReflowPageFromText(rawText: string, layoutText = ''): ReflowPage {
  const metadata = layoutMetadata(layoutText)
  const sourceLines = rawText
    .replace(/\r/g, '')
    .split('\n')
    .map(cleanInlineText)
    .filter(Boolean)

  if (sourceLines.length === 0) return { version: 1, blocks: [], text: '' }

  const lines: PlainLine[] = sourceLines.map((text, index) => ({
    text,
    indent: metadata[index]?.indent || 0,
    blankBefore: metadata[index]?.blankBefore || index === 0,
  }))
  const bodyIndents = lines
    .filter((line, index) => !isLikelyHeading(line.text, index, line.blankBefore))
    .map(line => line.indent)
  const baseIndent = median(bodyIndents)
  const blocks: ReflowBlock[] = []
  let pending: ReflowBlock | null = null

  const flush = () => {
    if (pending?.text) blocks.push({ ...pending, text: cleanInlineText(pending.text) })
    pending = null
  }

  lines.forEach((line, index) => {
    const heading = isLikelyHeading(line.text, index, line.blankBefore)
    const list = LIST_RE.test(line.text)
    const type: ReflowBlockType = heading ? 'heading' : list ? 'list' : 'paragraph'
    const paragraphStart = line.blankBefore || line.indent > baseIndent + 2

    if (!pending || pending.type !== type || heading || list || paragraphStart) {
      flush()
      pending = { type, text: line.text }
    } else {
      pending.text = joinWrappedTextLines(pending.text, line.text)
    }
  })
  flush()

  const text = blocks.map(block => block.text).join('\n\n')
  return { version: 1, blocks, text }
}

export function fallbackReflowPage(content: string): ReflowPage {
  const blocks = content
    .split(/\n\s*\n/)
    .map(cleanInlineText)
    .filter(Boolean)
    .map<ReflowBlock>(text => ({ type: 'paragraph', text }))
  return { version: 1, blocks, text: blocks.map(block => block.text).join('\n\n') }
}
