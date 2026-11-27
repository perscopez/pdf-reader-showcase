import type { PageTextModel, PageTextWord } from './pdfTextModel'
import type { Rectangle } from './readerLayout'

export type NormalizedPagePoint = { x: number; y: number }

export type CanonicalPdfSelection = {
  text: string
  rects: Rectangle[]
  words: PageTextWord[]
  startWordId?: string
  endWordId?: string
  confidence: number
}

export type CanonicalPointerSelectionMode = 'native' | 'immediate'

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function round(value: number) {
  return Number(value.toFixed(6))
}

export function displayPointToCanonical(
  point: NormalizedPagePoint,
  rotation: number,
): NormalizedPagePoint {
  const x = clamp01(point.x)
  const y = clamp01(point.y)
  const normalizedRotation = ((rotation % 360) + 360) % 360
  switch (normalizedRotation) {
    case 90:
      return { x: round(y), y: round(1 - x) }
    case 180:
      return { x: round(1 - x), y: round(1 - y) }
    case 270:
      return { x: round(1 - y), y: round(x) }
    default:
      return { x: round(x), y: round(y) }
  }
}

export function isCanonicalSelectionModelUsable(
  model: PageTextModel | null | undefined,
): model is PageTextModel {
  if (!model || model.words.length === 0 || model.quality < 0.4 || model.provenance.rotation !== 0) return false
  return model.source === 'ocr' || !model.needsOcr
}

/**
 * Only a primary mouse button drag takes over selection with pointer capture.
 * Fingers and styluses keep the platform's own selection gestures (long press,
 * double tap, drag handles, magnifier); their result is canonicalized into
 * clean word geometry afterwards instead of being replaced mid-gesture.
 */
export function getCanonicalPointerSelectionMode(input: {
  pointerType: string
  button: number
  isPrimary: boolean
  model: PageTextModel | null | undefined
}): CanonicalPointerSelectionMode {
  if (!input.isPrimary || input.button !== 0 || !isCanonicalSelectionModelUsable(input.model)) return 'native'
  if (input.pointerType === 'mouse' || input.pointerType === '') return 'immediate'
  return 'native'
}

type WordHit = { word: PageTextWord; index: number; score: number }

function hitTestWord(model: PageTextModel, point: NormalizedPagePoint): WordHit | null {
  let best: WordHit | null = null
  model.words.forEach((word, index) => {
    const xTolerance = Math.max(0.006, Math.min(0.035, word.width * 0.32))
    const yTolerance = Math.max(0.006, Math.min(0.03, word.height * 0.65))
    const left = word.left - xTolerance
    const right = word.left + word.width + xTolerance
    const top = word.top - yTolerance
    const bottom = word.top + word.height + yTolerance
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) return

    const dx = point.x < word.left
      ? word.left - point.x
      : point.x > word.left + word.width
        ? point.x - (word.left + word.width)
        : 0
    const dy = point.y < word.top
      ? word.top - point.y
      : point.y > word.top + word.height
        ? point.y - (word.top + word.height)
        : 0
    const score = Math.hypot(dx / xTolerance, dy / yTolerance)
    if (!best || score < best.score || (score === best.score && index < best.index)) {
      best = { word, index, score }
    }
  })
  if (best) return best

  // A drag commonly ends in the whitespace immediately after a word. Keep
  // that endpoint on the visually intersected line without allowing a remote
  // page margin to snap to arbitrary text.
  model.words.forEach((word, index) => {
    const yTolerance = Math.max(0.008, Math.min(0.035, word.height * 0.8))
    const verticalDistance = point.y < word.top
      ? word.top - point.y
      : point.y > word.top + word.height
        ? point.y - (word.top + word.height)
        : 0
    if (verticalDistance > yTolerance) return
    const horizontalDistance = point.x < word.left
      ? word.left - point.x
      : point.x > word.left + word.width
        ? point.x - (word.left + word.width)
        : 0
    if (horizontalDistance > 0.08) return
    const score = horizontalDistance / 0.08 + verticalDistance / yTolerance
    if (!best || score < best.score || (score === best.score && index < best.index)) {
      best = { word, index, score }
    }
  })
  return best
}

type HorizontalRun = { left: number; right: number; words: PageTextWord[] }

function lineRuns(words: PageTextWord[]): HorizontalRun[] {
  const ordered = [...words].sort((a, b) => a.left - b.left)
  const runs: HorizontalRun[] = []
  for (const word of ordered) {
    const previous = runs.at(-1)
    const gapThreshold = Math.max(0.045, Math.min(0.12, word.height * 3.5))
    if (!previous || word.left - previous.right > gapThreshold) {
      runs.push({ left: word.left, right: word.left + word.width, words: [word] })
      continue
    }
    previous.words.push(word)
    previous.right = Math.max(previous.right, word.left + word.width)
  }
  return runs
}

function runContaining(model: PageTextModel, target: PageTextWord) {
  const sameLine = model.words.filter(word => word.line === target.line)
  return lineRuns(sameLine).find(run => run.words.includes(target)) || null
}

function constrainToVisualCorridor(
  model: PageTextModel,
  selected: PageTextWord[],
  start: PageTextWord,
  end: PageTextWord,
) {
  if (start.line === end.line) return selected
  const startRun = runContaining(model, start)
  const endRun = runContaining(model, end)
  if (!startRun || !endRun) return selected

  const overlap = Math.min(startRun.right, endRun.right) - Math.max(startRun.left, endRun.left)
  const startCenter = (startRun.left + startRun.right) / 2
  const endCenter = (endRun.left + endRun.right) / 2
  if (overlap < -0.02 && Math.abs(startCenter - endCenter) > 0.22) return selected

  const corridorLeft = Math.min(startRun.left, endRun.left) - 0.015
  const corridorRight = Math.max(startRun.right, endRun.right) + 0.015
  const constrained = selected.filter(word => {
    const center = word.left + word.width / 2
    return center >= corridorLeft && center <= corridorRight
  })
  return constrained.includes(start) && constrained.includes(end) ? constrained : selected
}

function joinWords(words: PageTextWord[]) {
  return [...words]
    .sort((a, b) => a.left - b.left)
    .reduce((text, word) => {
      if (!text) return word.text
      const noLeadingSpace = /^[,.;:!?%)\]}’'”]/u.test(word.text)
      const noTrailingSpace = /[-–—/'’([{“]$/u.test(text)
      return `${text}${noLeadingSpace || noTrailingSpace ? '' : ' '}${word.text}`
    }, '')
}

function buildSelectionText(words: PageTextWord[]) {
  const lines = new Map<number, PageTextWord[]>()
  words.forEach(word => lines.set(word.line, [...(lines.get(word.line) || []), word]))
  const orderedLines = [...lines.values()].sort((a, b) => {
    const aOrder = Math.min(...a.map(word => word.order ?? 0))
    const bOrder = Math.min(...b.map(word => word.order ?? 0))
    return aOrder - bOrder
  })
  return orderedLines
    .map(joinWords)
    .reduce((text, line) => {
      if (!text) return line
      if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line)) return `${text.slice(0, -1)}${line}`
      return `${text} ${line}`
    }, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSelectionRects(words: PageTextWord[]): Rectangle[] {
  const lines = new Map<number, PageTextWord[]>()
  words.forEach(word => lines.set(word.line, [...(lines.get(word.line) || []), word]))
  const rects: Rectangle[] = []
  for (const lineWords of lines.values()) {
    const ordered = [...lineWords].sort((a, b) => a.left - b.left)
    let current: Rectangle | null = null
    for (const word of ordered) {
      const wordRect = { left: word.left, top: word.top, width: word.width, height: word.height }
      if (!current) {
        current = wordRect
        continue
      }
      const currentRight = current.left + current.width
      const gap = word.left - currentRight
      const lineTolerance = Math.max(current.height, word.height) * 0.45
      if (gap <= Math.max(0.012, word.height * 0.8) && Math.abs(current.top - word.top) <= lineTolerance) {
        const right = Math.max(currentRight, word.left + word.width)
        const bottom = Math.max(current.top + current.height, word.top + word.height)
        current = {
          left: Math.min(current.left, word.left),
          top: Math.min(current.top, word.top),
          width: right - Math.min(current.left, word.left),
          height: bottom - Math.min(current.top, word.top),
        }
      } else {
        rects.push(current)
        current = wordRect
      }
    }
    if (current) rects.push(current)
  }
  return rects
    .sort((a, b) => Math.abs(a.top - b.top) > 0.003 ? a.top - b.top : a.left - b.left)
    .map(rect => ({
      left: round(clamp01(rect.left)),
      top: round(clamp01(rect.top)),
      width: round(Math.max(0, Math.min(1 - clamp01(rect.left), rect.width))),
      height: round(Math.max(0, Math.min(1 - clamp01(rect.top), rect.height))),
    }))
}

export function resolveCanonicalPdfSelection(
  model: PageTextModel,
  displayedStart: NormalizedPagePoint,
  displayedEnd: NormalizedPagePoint,
  rotation: number,
): CanonicalPdfSelection | null {
  if (!isCanonicalSelectionModelUsable(model)) return null
  const startHit = hitTestWord(model, displayPointToCanonical(displayedStart, rotation))
  const endHit = hitTestWord(model, displayPointToCanonical(displayedEnd, rotation))
  if (!startHit || !endHit) return null

  const startOrder = startHit.word.order ?? startHit.index
  const endOrder = endHit.word.order ?? endHit.index
  const lower = Math.min(startOrder, endOrder)
  const upper = Math.max(startOrder, endOrder)
  let words = model.words.filter((word, index) => {
    const order = word.order ?? index
    return order >= lower && order <= upper
  })
  const first = startOrder <= endOrder ? startHit.word : endHit.word
  const last = startOrder <= endOrder ? endHit.word : startHit.word
  words = constrainToVisualCorridor(model, words, first, last)
    .sort((a, b) => (a.order ?? model.words.indexOf(a)) - (b.order ?? model.words.indexOf(b)))
  if (words.length === 0) return null

  const text = buildSelectionText(words)
  const rects = buildSelectionRects(words)
  if (text.length <= 1 || rects.length === 0) return null

  return {
    text,
    rects,
    words,
    startWordId: first.id,
    endWordId: last.id,
    confidence: round(Math.max(0, Math.min(model.quality, 1 - Math.max(startHit.score, endHit.score) * 0.2))),
  }
}

/**
 * Canonicalizes a live native selection without touching it. The first and last
 * client rects mark where the platform placed the selection edges, so probing
 * just inside them yields the same first/last word the reader sees highlighted.
 */
export function resolveCanonicalPdfSelectionFromRange(
  model: PageTextModel,
  range: Range,
  pageRect: { left: number; top: number; width: number; height: number },
  rotation: number,
): CanonicalPdfSelection | null {
  if (!isCanonicalSelectionModelUsable(model) || pageRect.width <= 0 || pageRect.height <= 0) return null
  const clientRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0.5 && rect.height > 0.5)
  if (clientRects.length === 0) return null
  const firstRect = clientRects[0]
  const lastRect = clientRects[clientRects.length - 1]
  const toPagePoint = (x: number, y: number): NormalizedPagePoint => ({
    x: (x - pageRect.left) / pageRect.width,
    y: (y - pageRect.top) / pageRect.height,
  })
  const displayedStart = toPagePoint(
    firstRect.left + Math.min(2, firstRect.width / 3),
    firstRect.top + firstRect.height / 2,
  )
  const displayedEnd = toPagePoint(
    lastRect.right - Math.min(2, lastRect.width / 3),
    lastRect.top + lastRect.height / 2,
  )
  return resolveCanonicalPdfSelection(model, displayedStart, displayedEnd, rotation)
}
