import type { Rectangle } from '@/lib/readerLayout'

export type VisiblePageLayout = 'single' | 'double'

export type TextSpanInput = string | {
  text: string
  /** Set for PDF fragments that are a continuation of the previous span. */
  joinWithPrevious?: boolean
}

export type SpanMatchSegment = {
  spanIndex: number
  startOffset: number
  endOffset: number
}

type CharacterSource = {
  spanIndex: number
  offset: number
  endOffset: number
} | null

function foldCharacter(character: string) {
  return character
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/ı/g, 'i')
    .toLocaleLowerCase('tr-TR')
}

function normalizeQuery(query: string) {
  let normalized = ''
  let pendingSpace = false

  for (const character of query.replace(/\u00A0/g, ' ')) {
    const folded = foldCharacter(character)
    if (!folded) continue
    if (/\s/u.test(folded)) {
      pendingSpace = normalized.length > 0
      continue
    }
    if (pendingSpace) normalized += ' '
    normalized += folded
    pendingSpace = false
  }

  return normalized
}

function shouldSeparateSpans(previous: string, current: string, joinWithPrevious: boolean) {
  if (joinWithPrevious || !previous || !current) return false
  if (/^[,.;:!?%)\]}’']/u.test(current)) return false
  if (/[-–—/'’([{]$/u.test(previous)) return false
  return true
}

function appendNormalized(
  text: string,
  spanIndex: number,
  target: { text: string; sources: CharacterSource[] },
) {
  let pendingSpace: CharacterSource | undefined
  let sourceOffset = 0

  for (const character of text.replace(/\u00A0/g, ' ')) {
    const startOffset = sourceOffset
    sourceOffset += character.length
    const folded = foldCharacter(character)
    if (!folded) continue

    if (/\s/u.test(folded)) {
      if (target.text.length > 0) pendingSpace = { spanIndex, offset: startOffset, endOffset: sourceOffset }
      continue
    }

    if (pendingSpace && !target.text.endsWith(' ')) {
      target.text += ' '
      target.sources.push(pendingSpace)
    }
    pendingSpace = undefined

    for (const foldedCharacter of folded) {
      target.text += foldedCharacter
      target.sources.push({ spanIndex, offset: startOffset, endOffset: sourceOffset })
    }
  }
}

/**
 * Maps a page-text search occurrence back to all DOM/OCR spans it crosses.
 * Whitespace is collapsed and missing word separators between adjacent spans
 * are synthesized without assigning that synthetic space to either span.
 */
export function mapTextMatchToSpanSegments(
  spans: readonly TextSpanInput[],
  query: string,
  occurrence = 0,
): SpanMatchSegment[] {
  if (!Number.isInteger(occurrence) || occurrence < 0) return []
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return []

  const page = { text: '', sources: [] as CharacterSource[] }
  let previousText = ''

  spans.forEach((input, spanIndex) => {
    const text = typeof input === 'string' ? input : input.text
    const joinWithPrevious = typeof input === 'string' ? false : input.joinWithPrevious === true
    if (shouldSeparateSpans(previousText, text, joinWithPrevious) && page.text && !page.text.endsWith(' ')) {
      page.text += ' '
      page.sources.push(null)
    }
    appendNormalized(text, spanIndex, page)
    if (text) previousText = text
  })

  let from = 0
  let matchStart = -1
  for (let index = 0; index <= occurrence; index += 1) {
    matchStart = page.text.indexOf(normalizedQuery, from)
    if (matchStart === -1) return []
    from = matchStart + Math.max(1, normalizedQuery.length)
  }

  const matchEnd = matchStart + normalizedQuery.length
  const segments: SpanMatchSegment[] = []
  for (let index = matchStart; index < matchEnd; index += 1) {
    const source = page.sources[index]
    if (!source) continue
    const existing = segments.at(-1)
    const endOffset = source.endOffset
    if (existing?.spanIndex === source.spanIndex && source.offset <= existing.endOffset) {
      existing.endOffset = Math.max(existing.endOffset, endOffset)
    } else {
      segments.push({
        spanIndex: source.spanIndex,
        startOffset: source.offset,
        endOffset,
      })
    }
  }

  return segments
}

function roundGeometry(value: number) {
  return Number(value.toFixed(6))
}

/** Rotates a normalized page rectangle clockwise while keeping it in [0, 1]. */
export function rotateNormalizedRect(rect: Rectangle, rotation: number): Rectangle {
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const source = {
    left: Math.max(0, Math.min(1, rect.left)),
    top: Math.max(0, Math.min(1, rect.top)),
    width: Math.max(0, Math.min(1, rect.width)),
    height: Math.max(0, Math.min(1, rect.height)),
  }
  source.width = Math.min(source.width, 1 - source.left)
  source.height = Math.min(source.height, 1 - source.top)

  let rotated: Rectangle
  switch (normalizedRotation) {
    case 90:
      rotated = {
        left: 1 - source.top - source.height,
        top: source.left,
        width: source.height,
        height: source.width,
      }
      break
    case 180:
      rotated = {
        left: 1 - source.left - source.width,
        top: 1 - source.top - source.height,
        width: source.width,
        height: source.height,
      }
      break
    case 270:
      rotated = {
        left: source.top,
        top: 1 - source.left - source.width,
        width: source.height,
        height: source.width,
      }
      break
    default:
      rotated = source
  }

  return {
    left: roundGeometry(rotated.left),
    top: roundGeometry(rotated.top),
    width: roundGeometry(rotated.width),
    height: roundGeometry(rotated.height),
  }
}

export function getVisiblePageNumbers(
  currentPage: number,
  pageLayout: VisiblePageLayout,
  numPages: number,
) {
  if (!Number.isInteger(currentPage) || !Number.isInteger(numPages) || numPages < 1) return []
  const firstPage = Math.max(1, Math.min(numPages, currentPage))
  return pageLayout === 'double' && firstPage < numPages
    ? [firstPage, firstPage + 1]
    : [firstPage]
}
