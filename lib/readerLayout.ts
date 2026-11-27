export type FitWidthScaleInput = {
  readerWidth: number
  pageWidth: number
  pagesShown: number
  gap: number
  viewportWidth: number
  viewportHeight: number
  maxTouchPoints: number
}

export function isPhoneLandscapeViewport(viewportWidth: number, viewportHeight: number, maxTouchPoints: number) {
  return maxTouchPoints > 0
    && viewportWidth > viewportHeight
    && viewportWidth >= 640
    && viewportHeight <= 520
}

export function calculateFitWidthScale({
  readerWidth,
  pageWidth,
  pagesShown,
  gap,
  viewportWidth,
  viewportHeight,
  maxTouchPoints,
}: FitWidthScaleInput) {
  if (!readerWidth || !pageWidth || !pagesShown) return 1

  const available = Math.max(320, readerWidth - 40 - gap)
  const widthScale = available / (pageWidth * pagesShown)
  const maxScale = isPhoneLandscapeViewport(viewportWidth, viewportHeight, maxTouchPoints) ? 0.92 : 8
  return Math.max(0.5, Math.min(maxScale, 8, Number(widthScale.toFixed(2))))
}

export function isTouchSelectionSheetViewport(
  viewportWidth: number,
  maxTouchPoints = 0,
  viewportHeight = 800,
) {
  if (viewportWidth < 768) return true
  if (maxTouchPoints > 0 && viewportHeight <= 520) return true
  return false
}

export type Rectangle = {
  left: number
  top: number
  width: number
  height: number
}

export function mergeOverlappingHighlightRects(rects: Rectangle[]): Rectangle[] {
  const normalized = rects
    .filter(rect => (
      Number.isFinite(rect.left)
      && Number.isFinite(rect.top)
      && Number.isFinite(rect.width)
      && Number.isFinite(rect.height)
      && rect.width > 0
      && rect.height > 0
    ))
    .map(rect => ({
      left: Math.max(0, Math.min(1, rect.left)),
      top: Math.max(0, Math.min(1, rect.top)),
      width: Math.max(0, Math.min(1 - Math.max(0, rect.left), rect.width)),
      height: Math.max(0, Math.min(1 - Math.max(0, rect.top), rect.height)),
    }))
    .filter(rect => rect.width > 0.0005 && rect.height > 0.0005)

  let merged = normalized
  let changed = true
  while (changed) {
    changed = false
    const next: Rectangle[] = []

    for (const rect of merged) {
      const match = next.findIndex(candidate => {
        const horizontalOverlap = Math.min(candidate.left + candidate.width, rect.left + rect.width)
          - Math.max(candidate.left, rect.left)
        const verticalOverlap = Math.min(candidate.top + candidate.height, rect.top + rect.height)
          - Math.max(candidate.top, rect.top)
        const minimumHeight = Math.min(candidate.height, rect.height)
        return horizontalOverlap > 0.00025
          && verticalOverlap > Math.max(0.00025, minimumHeight * 0.35)
      })

      if (match === -1) {
        next.push(rect)
        continue
      }

      const candidate = next[match]
      const right = Math.max(candidate.left + candidate.width, rect.left + rect.width)
      const bottom = Math.max(candidate.top + candidate.height, rect.top + rect.height)
      const left = Math.min(candidate.left, rect.left)
      const top = Math.min(candidate.top, rect.top)
      next[match] = { left, top, width: right - left, height: bottom - top }
      changed = true
    }

    merged = next
  }

  return merged
    .map(rect => ({
      left: Number(rect.left.toFixed(6)),
      top: Number(rect.top.toFixed(6)),
      width: Number(rect.width.toFixed(6)),
      height: Number(rect.height.toFixed(6)),
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left)
}

export function getSelectionToolbarPosition({
  selection,
  viewportWidth,
  viewportHeight,
  toolbarWidth,
  toolbarHeight,
  gap = 12,
  margin = 12,
}: {
  selection: Rectangle
  viewportWidth: number
  viewportHeight: number
  toolbarWidth: number
  toolbarHeight: number
  gap?: number
  margin?: number
}) {
  const desiredLeft = selection.left + (selection.width / 2) - (toolbarWidth / 2)
  const left = Math.max(margin, Math.min(desiredLeft, viewportWidth - toolbarWidth - margin))
  const above = selection.top - toolbarHeight - gap
  const desiredTop = above >= margin
    ? above
    : selection.top + selection.height + gap
  const top = Math.max(margin, Math.min(desiredTop, viewportHeight - toolbarHeight - margin))
  return { left, top }
}

export function getNoteRailAnchor(rects: Rectangle[]) {
  if (rects.length === 0) return null
  const finalLine = rects.reduce((current, rect) => {
    const currentBottom = current.top + current.height
    const rectBottom = rect.top + rect.height
    return rectBottom > currentBottom || (rectBottom === currentBottom && rect.left > current.left)
      ? rect
      : current
  }, rects[0])
  return {
    left: 1,
    top: Math.max(0.035, Math.min(0.965, finalLine.top + (finalLine.height / 2))),
  }
}

export type NoteRailAnchor = {
  id: number
  top: number
}

export type LaidOutNoteRailAnchor = {
  id: number
  sourceTop: number
  top: number
}

export function layoutNoteRailAnchors(
  items: NoteRailAnchor[],
  {
    minGap,
    minTop = 0.035,
    maxTop = 0.965,
  }: {
    minGap: number
    minTop?: number
    maxTop?: number
  },
): LaidOutNoteRailAnchor[] {
  if (items.length === 0) return []

  const round = (value: number) => Number(value.toFixed(6))
  const sorted = [...items]
    .map(item => ({
      id: item.id,
      sourceTop: item.top,
      top: Math.max(minTop, Math.min(maxTop, item.top)),
    }))
    .sort((a, b) => a.sourceTop - b.sourceTop || a.id - b.id)

  for (let index = 1; index < sorted.length; index += 1) {
    sorted[index].top = Math.max(sorted[index].top, sorted[index - 1].top + minGap)
  }

  const overflow = Math.max(0, sorted[sorted.length - 1].top - maxTop)
  if (overflow > 0) {
    for (const item of sorted) item.top -= overflow
  }

  const underflow = Math.max(0, minTop - sorted[0].top)
  if (underflow > 0) {
    for (const item of sorted) item.top += underflow
  }

  return sorted.map(item => ({
    id: item.id,
    sourceTop: round(item.sourceTop),
    top: round(Math.max(minTop, Math.min(maxTop, item.top))),
  }))
}

export function isTypingTarget(target: unknown) {
  if (!target || typeof target !== 'object') return false
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown }
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : ''
  return candidate.isContentEditable === true || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

export function readBooleanSetting(raw: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof raw[key] === 'boolean' ? raw[key] : fallback
}

export type PageSelectionBounds = {
  text: string
  textLayerText: string
  rectsCount: number
  unionCoverage: number
  unionTop: number
  unionBottom: number
}

export function isOversizedPageSelection({
  text,
  textLayerText,
  rectsCount,
  unionCoverage,
  unionTop,
  unionBottom,
}: PageSelectionBounds): boolean {
  const cleanLen = text.trim().length
  if (cleanLen <= 1) return true

  const layerLen = textLayerText.trim().length
  const textRatio = layerLen > 0 ? cleanLen / layerLen : 0

  if (layerLen > 300 && textRatio > 0.85) return true
  if (unionCoverage > 0.85 && (rectsCount > 25 || cleanLen > 1400)) return true

  return false
}
