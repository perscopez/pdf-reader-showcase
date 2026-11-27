/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import getStroke from 'perfect-freehand'
import {
  ArrowUpRight,
  Circle,
  Eraser,
  GripHorizontal,
  Highlighter,
  Minus,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Type,
  X,
} from 'lucide-react'
import { useI18n } from './I18nProvider'
import type { DrawPath, DrawTool, Point, ReaderTheme } from './ReaderTypes'
import { THEME_STYLES } from './ReaderUI'

const SHAPE_TOOLS = ['line', 'arrow', 'rectangle', 'ellipse'] as const
const TEXT_TOOLS = ['text', 'sticky'] as const
const DRAW_PALETTES: Record<ReaderTheme, readonly string[]> = {
  midnight: ['#ef4444', '#f59e0b', '#22d3ee', '#a78bfa', '#f8fafc'],
  slate: ['#60a5fa', '#fb923c', '#facc15', '#34d399', '#e2e8f0'],
  paper: ['#dc2626', '#d97706', '#0f766e', '#4f46e5', '#1e293b'],
  sepia: ['#c2410c', '#ca8a04', '#65a30d', '#2563eb', '#f5ead8'],
  seoul: ['#e76f51', '#e9c46a', '#2a9d8f', '#457b9d', '#283618'],
}

const DRAW_PRESETS = [
  { key: 'review', tool: 'pen', color: '#f43f5e', size: 4, opacity: 1 },
  { key: 'highlight', tool: 'highlighter', color: '#facc15', size: 12, opacity: 0.35 },
  { key: 'note', tool: 'text', color: '#38bdf8', size: 5, opacity: 1 },
  { key: 'sticky', tool: 'sticky', color: '#fde68a', size: 5, opacity: 0.92 },
] as const

function getSvgPathFromStroke(points: number[][]) {
  if (!points.length) return ''
  const average = (a: number, b: number) => (a + b) / 2
  const path = points.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length]
    acc.push(x0, y0, average(x0, x1), average(y0, y1))
    return acc
  }, ['M', ...points[0], 'Q'] as Array<string | number>)
  path.push('Z')
  return path.join(' ')
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2)
  const left = Math.min(x, x + width)
  const top = Math.min(y, y + height)
  const w = Math.abs(width)
  const h = Math.abs(height)
  ctx.beginPath()
  ctx.moveTo(left + r, top)
  ctx.lineTo(left + w - r, top)
  ctx.quadraticCurveTo(left + w, top, left + w, top + r)
  ctx.lineTo(left + w, top + h - r)
  ctx.quadraticCurveTo(left + w, top + h, left + w - r, top + h)
  ctx.lineTo(left + r, top + h)
  ctx.quadraticCurveTo(left, top + h, left, top + h - r)
  ctx.lineTo(left, top + r)
  ctx.quadraticCurveTo(left, top, left + r, top)
  ctx.closePath()
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function pathBounds(path: DrawPath) {
  if (!path) return null
  const tool = path.tool || 'pen'
  const points = path.points
  if (!points.length) return null
  if (TEXT_TOOLS.includes(tool as typeof TEXT_TOOLS[number])) {
    const start = points[0]
    const end = points[1] || { x: start.x + 190, y: start.y + 90 }
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      right: Math.max(start.x, end.x),
      bottom: Math.max(start.y, end.y),
    }
  }
  const pad = Math.max(8, path.width * 2)
  return {
    left: Math.min(...points.map(point => point.x)) - pad,
    top: Math.min(...points.map(point => point.y)) - pad,
    right: Math.max(...points.map(point => point.x)) + pad,
    bottom: Math.max(...points.map(point => point.y)) + pad,
  }
}

function translatePath(path: DrawPath, dx: number, dy: number): DrawPath {
  return { ...path, points: path.points.map(point => ({ ...point, x: point.x + dx, y: point.y + dy })) }
}

function pointInBounds(point: Point, bounds: NonNullable<ReturnType<typeof pathBounds>>) {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
}

export function drawPath(ctx: CanvasRenderingContext2D, path: DrawPath) {
  if (!path) return
  const tool = path.tool || 'pen'
  ctx.save()
  ctx.globalAlpha = path.opacity ?? (tool === 'highlighter' ? 0.35 : 1)
  ctx.strokeStyle = path.color
  ctx.lineWidth = path.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (TEXT_TOOLS.includes(tool as typeof TEXT_TOOLS[number])) {
    const start = path.points[0]
    if (!start || !path.text) {
      ctx.restore()
      return
    }
    const end = path.points[1] || { x: start.x + 190, y: start.y + 90 }
    const left = Math.min(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const width = Math.max(80, Math.abs(end.x - start.x))
    const height = Math.max(36, Math.abs(end.y - start.y))
    const fontSize = path.fontSize || Math.max(14, path.width * 4)
    ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    ctx.textBaseline = 'top'

    if (tool === 'sticky') {
      ctx.fillStyle = path.color
      drawRoundedRect(ctx, left, top, width, height, 12)
      ctx.fill()
      ctx.globalAlpha = Math.min(1, (path.opacity ?? 0.9) + 0.08)
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#111827'
    } else {
      ctx.fillStyle = path.color
    }

    const lines = wrapCanvasText(ctx, path.text, width - 18)
    lines.slice(0, Math.max(1, Math.floor((height - 16) / (fontSize * 1.25)))).forEach((line, index) => {
      ctx.fillText(line, left + 9, top + 8 + index * fontSize * 1.25)
    })
    ctx.restore()
    return
  }

  if (path.points.length < 2) {
    ctx.restore()
    return
  }

  if (SHAPE_TOOLS.includes(tool as typeof SHAPE_TOOLS[number])) {
    const start = path.points[0]
    const end = path.points[path.points.length - 1]
    const width = end.x - start.x
    const height = end.y - start.y
    ctx.beginPath()

    if (tool === 'line' || tool === 'arrow') {
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()

      if (tool === 'arrow') {
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        const head = Math.max(10, path.width * 4)
        ctx.beginPath()
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 7), end.y - head * Math.sin(angle - Math.PI / 7))
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 7), end.y - head * Math.sin(angle + Math.PI / 7))
        ctx.stroke()
      }

    } else if (tool === 'rectangle') {
      ctx.strokeRect(start.x, start.y, width, height)
    } else {
      ctx.ellipse(start.x + width / 2, start.y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.restore()
    return
  }

  if (tool === 'pen' || tool === 'highlighter') {
    const stroke = getStroke(path.points.map(point => [point.x, point.y, point.pressure ?? 0.55]), {
      size: path.width,
      thinning: tool === 'highlighter' ? 0.08 : 0.58,
      smoothing: 0.72,
      streamline: 0.48,
      simulatePressure: false,
      start: { taper: tool === 'highlighter' ? 0 : path.width * 0.7 },
      end: { taper: tool === 'highlighter' ? 0 : path.width * 0.9 },
    })
    const svgPath = getSvgPathFromStroke(stroke)
    if (svgPath) {
      ctx.fillStyle = path.color
      ctx.fill(new Path2D(svgPath))
      ctx.restore()
      return
    }
  }

  ctx.beginPath()
  ctx.moveTo(path.points[0].x, path.points[0].y)
  for (let i = 1; i < path.points.length - 1; i++) {
    const midX = (path.points[i].x + path.points[i + 1].x) / 2
    const midY = (path.points[i].y + path.points[i + 1].y) / 2
    ctx.quadraticCurveTo(path.points[i].x, path.points[i].y, midX, midY)
  }
  const last = path.points[path.points.length - 1]
  ctx.lineTo(last.x, last.y)
  ctx.stroke()
  ctx.restore()
}

export function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function pathTouchesEraser(path: DrawPath, eraserPoints: Point[], radius: number) {
  const step = Math.max(1, Math.floor(path.points.length / 80))
  const eraserStep = Math.max(1, Math.floor(eraserPoints.length / 80))
  for (let i = 0; i < path.points.length; i += step) {
    for (let j = 0; j < eraserPoints.length; j += eraserStep) {
      if (pointDistance(path.points[i], eraserPoints[j]) <= radius) return true
    }
  }
  return false
}

function arePathArraysEqual(a: DrawPath[], b: DrawPath[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const pA = a[i]
    const pB = b[i]
    if (pA.color !== pB.color || pA.width !== pB.width || pA.opacity !== pB.opacity || pA.tool !== pB.tool || pA.text !== pB.text) {
      return false
    }
    if (pA.points.length !== pB.points.length) return false
    if (pA.points.length > 0) {
      const ptA = pA.points[0]
      const ptB = pB.points[0]
      if (ptA.x !== ptB.x || ptA.y !== ptB.y) return false
    }
  }
  return true
}

export function DrawingCanvas({
  width,
  height,
  color,
  brushSize,
  opacity,
  tool,
  existingPaths,
  isSaving,
  onSave,
  onAutoSave,
  onCancel,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onOpacityChange,
  toolbarTop,
  theme,
}: {
  width: number
  height: number
  color: string
  brushSize: number
  opacity: number
  tool: DrawTool
  existingPaths: DrawPath[]
  isSaving: boolean
  onSave: (paths: DrawPath[]) => void
  onAutoSave: (paths: DrawPath[]) => void
  onCancel: () => void
  onToolChange: (tool: DrawTool) => void
  onColorChange: (color: string) => void
  onBrushSizeChange: (size: number) => void
  onOpacityChange: (opacity: number) => void
  toolbarTop: number
  theme: ReaderTheme
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pathsRef = useRef<DrawPath[]>([...existingPaths])
  const redoRef = useRef<DrawPath[]>([])
  const currentPathRef = useRef<DrawPath | null>(null)
  const activeToolRef = useRef<DrawTool>(tool)
  const dragPointRef = useRef<Point | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const toolbarDragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null)
  const didDragRef = useRef(false)
  const isDrawingRef = useRef(false)
  const selectedIndexRef = useRef<number | null>(null)
  const selectedIndexesRef = useRef<number[]>([])
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionBoxStartRef = useRef<Point | null>(null)
  const selectionBoxEndRef = useRef<Point | null>(null)
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([])
  const [selectedTool, setSelectedTool] = useState<DrawPath['tool'] | null>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedSavedColor, setSelectedSavedColor] = useState<string | null>(null)
  const [toolbarTab, setToolbarTab] = useState<'tools' | 'style' | 'actions'>('tools')

  useEffect(() => {
    if (tool !== 'select') {
      setMultiSelectMode(false)
    }
  }, [tool])
  const [pathCount, setPathCount] = useState(existingPaths.length)
  const [customColor, setCustomColor] = useState(color)
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null)
  const [toolbarHiddenForAction, setToolbarHiddenForAction] = useState(false)
  const [textDialog, setTextDialog] = useState<{ mode: 'create' | 'edit'; tool: 'text' | 'sticky'; point?: Point; index?: number } | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [savedColors, setSavedColors] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const parsed = JSON.parse(window.localStorage.getItem('reader-saved-draw-colors') || '[]')
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(0, 8) : []
    } catch {
      return []
    }
  })
  const { t } = useI18n()
  const themeStyle = THEME_STYLES[theme]
  const themePalette = DRAW_PALETTES[theme]
  const themedPresets: Array<{ key: (typeof DRAW_PRESETS)[number]['key']; tool: DrawTool; color: string; size: number; opacity: number }> = DRAW_PRESETS.map((preset, index) => ({
    ...preset,
    color: themePalette[index % themePalette.length],
  }))

  function selectPath(index: number | null, additive = false) {
    let nextIndexes: number[] = []
    if (index !== null) {
      if (additive) {
        nextIndexes = selectedIndexesRef.current.includes(index)
          ? selectedIndexesRef.current.filter(item => item !== index)
          : [...selectedIndexesRef.current, index]
      } else {
        nextIndexes = [index]
      }
    }
    selectedIndexesRef.current = nextIndexes
    selectedIndexRef.current = index
    setSelectedIndexes(nextIndexes)
    setSelectedTool(nextIndexes.length === 1 ? pathsRef.current[nextIndexes[0]]?.tool || 'pen' : null)
  }

  function autoSave(immediate = false) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    if (immediate) {
      onAutoSave(pathsRef.current)
    } else {
      saveTimeoutRef.current = setTimeout(() => {
        onAutoSave(pathsRef.current)
      }, 1500)
    }
  }

  function hideToolbarForAction() {
    setToolbarHiddenForAction(true)
  }

  function showToolbarAfterAction(delay = 260) {
    window.setTimeout(() => setToolbarHiddenForAction(false), delay)
  }

  function syncPathCount() {
    setPathCount(pathsRef.current.length)
  }

  const redraw = useCallback((preview?: DrawPath) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    for (const path of pathsRef.current) drawPath(ctx, path)
    if (preview) drawPath(ctx, preview)
    if (selectionBoxStartRef.current && selectionBoxEndRef.current) {
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
      ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'
      ctx.lineWidth = 1
      const x = selectionBoxStartRef.current.x
      const y = selectionBoxStartRef.current.y
      const w = selectionBoxEndRef.current.x - x
      const h = selectionBoxEndRef.current.y - y
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
      ctx.restore()
    }
    for (const index of selectedIndexes) {
      const bounds = pathBounds(pathsRef.current[index])
      if (bounds) {
        ctx.save()
        ctx.setLineDash([6, 5])
        ctx.strokeStyle = selectedIndexes.length > 1 ? '#a78bfa' : '#38bdf8'
        ctx.lineWidth = selectedIndexes.length > 1 ? 1.8 : 1.5
        ctx.strokeRect(bounds.left - 4, bounds.top - 4, bounds.right - bounds.left + 8, bounds.bottom - bounds.top + 8)
        ctx.restore()
      }
    }
  }, [height, selectedIndexes, width])

  const prevExistingPathsRef = useRef<DrawPath[]>(existingPaths)
  const prevWidthRef = useRef(width)
  const prevHeightRef = useRef(height)

  useEffect(() => {
    const scaleChanged = prevWidthRef.current !== width || prevHeightRef.current !== height
    const dbPathsChanged = !arePathArraysEqual(prevExistingPathsRef.current, existingPaths)

    if (scaleChanged || dbPathsChanged) {
      pathsRef.current = [...existingPaths]
      redoRef.current = []
      redraw()
    }

    prevWidthRef.current = width
    prevHeightRef.current = height
    prevExistingPathsRef.current = existingPaths
  }, [existingPaths, redraw, width, height])

  useEffect(() => {
    redraw()
  }, [redraw, selectedIndexes])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  function getPoint(e: React.PointerEvent) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * width / rect.width,
      y: (e.clientY - rect.top) * height / rect.height,
      pressure: e.pressure || 0.5,
    }
  }

  function getMousePoint(e: React.MouseEvent) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * width / rect.width,
      y: (e.clientY - rect.top) * height / rect.height,
    }
  }

  function findPathIndex(pt: Point) {
    for (let i = pathsRef.current.length - 1; i >= 0; i--) {
      const path = pathsRef.current[i]
      const bounds = pathBounds(path)
      if (!bounds || !pointInBounds(pt, bounds)) continue
      const toolName = path.tool || 'pen'
      if (TEXT_TOOLS.includes(toolName as typeof TEXT_TOOLS[number]) || SHAPE_TOOLS.includes(toolName as typeof SHAPE_TOOLS[number])) return i
      if (path.points.some(point => pointDistance(point, pt) <= Math.max(10, path.width * 2.4))) return i
    }
    return null
  }

  function resolvePointerTool(e: React.PointerEvent): DrawTool {
    const hasAuxiliaryPenButton = e.pointerType === 'pen' && (e.button > 0 || (e.buttons & ~1) !== 0)
    return hasAuxiliaryPenButton ? 'eraser' : tool
  }

  function openTextDialog(action: { mode: 'create' | 'edit'; tool: 'text' | 'sticky'; point?: Point; index?: number; initial?: string }) {
    setTextDraft(action.initial || '')
    setTextDialog({ mode: action.mode, tool: action.tool, point: action.point, index: action.index })
    showToolbarAfterAction(80)
  }

  function closeTextDialog() {
    setTextDialog(null)
    setTextDraft('')
    activeToolRef.current = tool
  }

  function submitTextDialog() {
    if (!textDialog) return
    const text = textDraft.trim()
    if (!text) {
      if (textDialog.mode === 'edit' && typeof textDialog.index === 'number') {
        deleteSelected(textDialog.index)
      }
      closeTextDialog()
      return
    }

    if (textDialog.mode === 'create' && textDialog.point) {
      const fontSize = Math.max(14, brushSize * 3.6)
      const next: DrawPath = {
        color: textDialog.tool === 'sticky' ? '#fde68a' : color,
        width: brushSize,
        opacity: textDialog.tool === 'sticky' ? 0.92 : opacity,
        tool: textDialog.tool,
        text,
        fontSize,
        points: [textDialog.point, { x: textDialog.point.x + 220, y: textDialog.point.y + Math.max(64, fontSize * 3.5) }],
      }
      pathsRef.current = [...pathsRef.current, next]
      redoRef.current = []
      syncPathCount()
      selectPath(null)
    } else if (textDialog.mode === 'edit' && typeof textDialog.index === 'number') {
      pathsRef.current = pathsRef.current.map((path, pathIndex) => pathIndex === textDialog.index ? { ...path, text } : path)
    }

    redraw()
    autoSave()
    closeTextDialog()
  }

  function startDraw(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const pt = getPoint(e)
    if (!pt) return
    const activeTool = resolvePointerTool(e)
    activeToolRef.current = activeTool
    hideToolbarForAction()
    if (activeTool === 'select') {
      let index = findPathIndex(pt)
      let clonedIndexes: number[] | null = null
      if (index === null) {
        selectionBoxStartRef.current = pt
        selectionBoxEndRef.current = pt
        const additive = multiSelectMode || e.shiftKey || e.ctrlKey || e.metaKey
        if (!additive) {
          selectPath(null)
        }
        redraw()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        return
      }
      if (index !== null && e.altKey) {
        const sourceIndexes = selectedIndexesRef.current.includes(index) ? selectedIndexesRef.current : [index]
        const clones = sourceIndexes
          .map(item => pathsRef.current[item])
          .filter((path): path is DrawPath => !!path)
          .map(path => translatePath(path, 0, 0))
        pathsRef.current = [...pathsRef.current, ...clones]
        syncPathCount()
        const firstClone = pathsRef.current.length - clones.length
        index = firstClone
        clonedIndexes = clones.map((_, cloneIndex) => firstClone + cloneIndex)
        redoRef.current = []
      }
      const additive = multiSelectMode || e.shiftKey || e.ctrlKey || e.metaKey
      if (clonedIndexes) {
        selectedIndexesRef.current = clonedIndexes
        selectedIndexRef.current = clonedIndexes[0]
        setSelectedIndexes(clonedIndexes)
        setSelectedTool(clonedIndexes.length === 1 ? pathsRef.current[clonedIndexes[0]]?.tool || 'pen' : null)
      } else {
        selectPath(index, additive)
      }
      dragPointRef.current = index === null ? null : pt
      didDragRef.current = e.altKey && index !== null
      redraw()
      if (index !== null) (e.target as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (activeTool === 'text' || activeTool === 'sticky') {
      openTextDialog({ mode: 'create', tool: activeTool, point: pt })
      return
    }
    isDrawingRef.current = true
    selectPath(null)
    currentPathRef.current = {
      color: activeTool === 'eraser' ? '#f8fafc' : color,
      width: activeTool === 'eraser' ? brushSize * 3 : brushSize,
      opacity: activeTool === 'eraser' ? 0.45 : opacity,
      tool: activeTool === 'eraser' ? 'pen' : activeTool,
      points: [pt],
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function draw(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const activeTool = activeToolRef.current || tool
    if (activeTool === 'select') {
      const pt = getPoint(e)
      if (!pt) return
      if (dragPointRef.current) {
        const dx = pt.x - dragPointRef.current.x
        const dy = pt.y - dragPointRef.current.y
        if (Math.abs(dx) + Math.abs(dy) < 0.2) return
        const selectedSet = new Set(selectedIndexesRef.current.length ? selectedIndexesRef.current : [selectedIndexRef.current].filter(x => x !== null) as number[])
        pathsRef.current = pathsRef.current.map((path, pathIndex) => selectedSet.has(pathIndex) ? translatePath(path, dx, dy) : path)
        dragPointRef.current = pt
        didDragRef.current = true
        redraw()
      } else if (selectionBoxStartRef.current) {
        selectionBoxEndRef.current = pt
        redraw()
      }
      return
    }
    if (!isDrawingRef.current || !currentPathRef.current) return
    const pt = getPoint(e)
    if (!pt) return
    const points = currentPathRef.current.points
    const last = points[points.length - 1]
    if (pointDistance(last, pt) < 1.8) return
    if (SHAPE_TOOLS.includes(activeTool as typeof SHAPE_TOOLS[number])) {
      currentPathRef.current.points = [points[0], pt]
    } else {
      currentPathRef.current.points.push(pt)
    }
    redraw(currentPathRef.current)
  }

  function endDraw(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const activeTool = activeToolRef.current || tool
    if (activeTool === 'select') {
      if (selectionBoxStartRef.current && selectionBoxEndRef.current) {
        const pt = getPoint(e) || selectionBoxEndRef.current
        const x1 = Math.min(selectionBoxStartRef.current.x, pt.x)
        const x2 = Math.max(selectionBoxStartRef.current.x, pt.x)
        const y1 = Math.min(selectionBoxStartRef.current.y, pt.y)
        const y2 = Math.max(selectionBoxStartRef.current.y, pt.y)
        const w = x2 - x1
        const h = y2 - y1

        selectionBoxStartRef.current = null
        selectionBoxEndRef.current = null
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

        if (w > 4 || h > 4) {
          const selected: number[] = []
          for (let i = 0; i < pathsRef.current.length; i++) {
            const path = pathsRef.current[i]
            const bounds = pathBounds(path)
            if (bounds) {
              const toolName = path.tool || 'pen'
              const isBoxLike = TEXT_TOOLS.includes(toolName as any) || SHAPE_TOOLS.includes(toolName as any)
              
              if (isBoxLike) {
                const boundsIntersect = !(bounds.right < x1 || bounds.left > x2 || bounds.bottom < y1 || bounds.top > y2)
                if (boundsIntersect) {
                  selected.push(i)
                }
              } else {
                const anyPointInside = path.points.some(p => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2)
                if (anyPointInside) {
                  selected.push(i)
                }
              }
            }
          }
          selectedIndexesRef.current = selected
          setSelectedIndexes(selected)
          if (selected.length === 1) {
            selectedIndexRef.current = selected[0]
            setSelectedTool(pathsRef.current[selected[0]]?.tool || 'pen')
          } else {
            selectedIndexRef.current = null
            setSelectedTool(null)
          }
          redraw()
        } else {
          selectPath(null)
          redraw()
        }
        activeToolRef.current = tool
        showToolbarAfterAction()
        return
      }

      if (dragPointRef.current) {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      }
      dragPointRef.current = null
      if (didDragRef.current) autoSave(true)
      didDragRef.current = false
      activeToolRef.current = tool
      showToolbarAfterAction()
      return
    }
    if (!isDrawingRef.current || !currentPathRef.current) {
      activeToolRef.current = tool
      showToolbarAfterAction()
      return
    }
    isDrawingRef.current = false
    const path = currentPathRef.current
    currentPathRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    if (path.points.length < 2) {
      redraw()
      activeToolRef.current = tool
      showToolbarAfterAction()
      return
    }
    if (activeTool === 'eraser') {
      const prevLength = pathsRef.current.length
      pathsRef.current = pathsRef.current.filter(item => !pathTouchesEraser(item, path.points, brushSize * 3.5))
      if (pathsRef.current.length !== prevLength) {
        selectPath(null)
      }
    } else {
      pathsRef.current = [...pathsRef.current, path]
    }
    redoRef.current = []
    syncPathCount()
    redraw()
    autoSave()
    activeToolRef.current = tool
    showToolbarAfterAction()
  }

  function startToolbarDrag(e: React.PointerEvent<HTMLDivElement>) {
    const toolbarNode = toolbarRef.current
    if (!toolbarNode) return
    e.preventDefault()
    const rect = toolbarNode.getBoundingClientRect()
    toolbarDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function dragToolbar(e: React.PointerEvent<HTMLDivElement>) {
    const drag = toolbarDragRef.current
    const toolbarNode = toolbarRef.current
    if (!drag || !toolbarNode) return
    e.preventDefault()
    const rect = toolbarNode.getBoundingClientRect()
    const padding = 8
    const nextLeft = Math.min(Math.max(padding, drag.startLeft + e.clientX - drag.startX), Math.max(padding, window.innerWidth - rect.width - padding))
    const nextTop = Math.min(Math.max(padding, drag.startTop + e.clientY - drag.startY), Math.max(padding, window.innerHeight - 56))
    setToolbarPosition({ left: Math.round(nextLeft), top: Math.round(nextTop) })
  }

  function endToolbarDrag(e: React.PointerEvent<HTMLDivElement>) {
    toolbarDragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  function undo() {
    const removed = pathsRef.current.at(-1)
    if (!removed) return
    pathsRef.current = pathsRef.current.slice(0, -1)
    redoRef.current = [removed, ...redoRef.current]
    syncPathCount()
    selectPath(null)
    redraw()
    autoSave(true)
  }

  function deleteSelected(targetIndex?: number) {
    let indexes: number[] = []
    if (typeof targetIndex === 'number') {
      indexes = [targetIndex]
    } else {
      indexes = selectedIndexesRef.current.length
        ? selectedIndexesRef.current
        : selectedIndexRef.current === null ? [] : [selectedIndexRef.current]
    }
    if (!indexes.length) return
    const selectedSet = new Set(indexes)
    const removed = pathsRef.current.filter((_, pathIndex) => selectedSet.has(pathIndex))
    if (!removed.length) {
      selectPath(null)
      redraw()
      return
    }
    pathsRef.current = pathsRef.current.filter((_, pathIndex) => !selectedSet.has(pathIndex))
    redoRef.current = [...removed, ...redoRef.current]
    syncPathCount()
    selectPath(null)
    redraw()
    autoSave(true)
  }

  function moveSelected(dx: number, dy: number) {
    const indexes = selectedIndexesRef.current
    if (!indexes.length) return
    const selectedSet = new Set(indexes)
    pathsRef.current = pathsRef.current.map((path, pathIndex) => selectedSet.has(pathIndex) ? translatePath(path, dx, dy) : path)
    redraw()
    autoSave()
  }

  function updateSelected(updates: Partial<Pick<DrawPath, 'color' | 'width' | 'opacity'>>) {
    const indexes = selectedIndexesRef.current
    if (!indexes.length) return
    const selectedSet = new Set(indexes)
    pathsRef.current = pathsRef.current.map((path, pathIndex) => selectedSet.has(pathIndex) ? { ...path, ...updates } : path)
    redraw()
    autoSave(true)
  }

  function setColor(next: string) {
    onColorChange(next)
    setCustomColor(next)
    updateSelected({ color: next })
  }

  function setBrush(next: number) {
    onBrushSizeChange(next)
    updateSelected({ width: next })
  }

  function setAlpha(next: number) {
    onOpacityChange(next)
    updateSelected({ opacity: next })
  }

  function sendSelectedToBack() {
    const indexes = selectedIndexesRef.current
    if (!indexes.length) return
    const selectedSet = new Set(indexes)
    const selected = pathsRef.current.filter((_, pathIndex) => selectedSet.has(pathIndex))
    const rest = pathsRef.current.filter((_, pathIndex) => !selectedSet.has(pathIndex))
    pathsRef.current = [...selected, ...rest]
    selectedIndexesRef.current = selected.map((_, index) => index)
    setSelectedIndexes(selectedIndexesRef.current)
    selectedIndexRef.current = selectedIndexesRef.current[0] ?? null
    redraw()
    autoSave(true)
  }

  function bringSelectedToFront() {
    const indexes = selectedIndexesRef.current
    if (!indexes.length) return
    const selectedSet = new Set(indexes)
    const selected = pathsRef.current.filter((_, pathIndex) => selectedSet.has(pathIndex))
    const rest = pathsRef.current.filter((_, pathIndex) => !selectedSet.has(pathIndex))
    pathsRef.current = [...rest, ...selected]
    const first = rest.length
    selectedIndexesRef.current = selected.map((_, index) => first + index)
    setSelectedIndexes(selectedIndexesRef.current)
    selectedIndexRef.current = selectedIndexesRef.current[0] ?? null
    redraw()
    autoSave(true)
  }

  function duplicateSelected() {
    const indexes = selectedIndexesRef.current
    if (!indexes.length) return
    const copies = indexes
      .map(index => pathsRef.current[index])
      .filter((path): path is DrawPath => !!path)
      .map(path => translatePath(path, 14, 14))
    if (!copies.length) return
    pathsRef.current = [...pathsRef.current, ...copies]
    syncPathCount()
    const first = pathsRef.current.length - copies.length
    selectedIndexesRef.current = copies.map((_, index) => first + index)
    setSelectedIndexes(selectedIndexesRef.current)
    selectedIndexRef.current = first
    setSelectedTool(copies.length === 1 ? copies[0].tool || 'pen' : null)
    redraw()
    autoSave(true)
  }

  function editSelectedText() {
    const index = selectedIndexesRef.current.length === 1 ? selectedIndexesRef.current[0] : null
    if (index === null) return
    const selected = pathsRef.current[index]
    if (selected.tool !== 'text' && selected.tool !== 'sticky') return
    openTextDialog({ mode: 'edit', tool: selected.tool, index, initial: selected.text || '' })
  }

  function editTextAtPoint(e: React.MouseEvent) {
    if (tool !== 'select') return
    e.preventDefault()
    e.stopPropagation()
    const pt = getMousePoint(e)
    if (!pt) return
    const index = findPathIndex(pt)
    if (index === null) return
    const selected = pathsRef.current[index]
    if (selected.tool !== 'text' && selected.tool !== 'sticky') return
    selectPath(index)
    editSelectedText()
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (textDialog) return
      if (selectedIndexes.length === 0) return
      const commandKey = event.ctrlKey || event.metaKey
      if (event.key === 'Escape') {
        event.preventDefault()
        selectPath(null)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.key === 'Enter' && selectedIndexes.length === 1 && (selectedTool === 'text' || selectedTool === 'sticky')) {
        event.preventDefault()
        editSelectedText()
        return
      }
      if (commandKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelected()
        return
      }
      if (commandKey && event.key === '[') {
        event.preventDefault()
        sendSelectedToBack()
        return
      }
      if (commandKey && event.key === ']') {
        event.preventDefault()
        bringSelectedToFront()
        return
      }
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const nudge = nudges[event.key]
      if (!nudge) return
      event.preventDefault()
      const multiplier = event.shiftKey ? 8 : 1
      moveSelected(nudge[0] * multiplier, nudge[1] * multiplier)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  })

  function redo() {
    const next = redoRef.current[0]
    if (!next) return
    redoRef.current = redoRef.current.slice(1)
    pathsRef.current = [...pathsRef.current, next]
    syncPathCount()
    redraw()
    autoSave(true)
  }

  function clearAll() {
    if (pathsRef.current.length === 0) return
    if (!window.confirm(t('draw.clearConfirm'))) return
    pathsRef.current = []
    redoRef.current = []
    syncPathCount()
    selectPath(null)
    redraw()
    autoSave(true)
  }

  function saveCustomColor() {
    const next = customColor || color
    setSavedColors(prev => {
      let merged
      if (selectedSavedColor && prev.includes(selectedSavedColor)) {
        merged = prev.map(item => item.toLowerCase() === selectedSavedColor.toLowerCase() ? next : item)
      } else if (prev.includes(color)) {
        merged = prev.map(item => item.toLowerCase() === color.toLowerCase() ? next : item)
      } else {
        merged = [next, ...prev.filter(item => item.toLowerCase() !== next.toLowerCase())].slice(0, 8)
      }
      try {
        window.localStorage.setItem('reader-saved-draw-colors', JSON.stringify(merged))
      } catch (e) {
        console.warn(e)
      }
      return merged
    })
    setSelectedSavedColor(next)
    setColor(next)
  }

  function removeSavedColor(item: string) {
    setSavedColors(prev => {
      const next = prev.filter(colorItem => colorItem.toLowerCase() !== item.toLowerCase())
      try {
        window.localStorage.setItem('reader-saved-draw-colors', JSON.stringify(next))
      } catch (e) {
        console.warn(e)
      }
      return next
    })
    if (selectedSavedColor?.toLowerCase() === item.toLowerCase()) {
      setSelectedSavedColor(null)
    }
  }

  function applyPreset(preset: { tool: DrawTool; color: string; size: number; opacity: number }) {
    onToolChange(preset.tool)
    setColor(preset.color)
    setSelectedSavedColor(null)
    setBrush(preset.size)
    setAlpha(preset.opacity)
  }

  const resolvedToolbarTop = Math.max(12, Math.round(toolbarTop))
  const selectedLabel = selectedIndexes.length > 1 ? t('draw.multiSelected', { count: selectedIndexes.length }) : selectedTool ? t(`draw.${selectedTool}`) : ''
  const hasPaths = pathCount > 0
  const hasSelection = selectedIndexes.length > 0
  const hasSingleEditableText = selectedIndexes.length === 1 && ['text', 'sticky'].includes(selectedTool || '')
  const textDialogNode = textDialog ? (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4" onPointerDown={event => event.stopPropagation()}>
      <form
        className={`w-full max-w-md rounded-2xl border p-4 shadow-[0_24px_90px_rgba(0,0,0,0.45)] ${themeStyle.panel}`}
        onSubmit={event => {
          event.preventDefault()
          submitTextDialog()
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className={`text-sm font-semibold ${themeStyle.text}`}>{t(textDialog.tool === 'sticky' ? 'draw.stickyDialogTitle' : 'draw.textDialogTitle')}</p>
            <p className={`mt-1 text-xs ${themeStyle.subtle}`}>{t('draw.textDialogHint')}</p>
          </div>
          <button type="button" onClick={closeTextDialog} className={`rounded-lg border px-2 py-1 text-xs ${themeStyle.button}`}>{t('common.close')}</button>
        </div>
        <textarea
          autoFocus
          value={textDraft}
          onChange={event => setTextDraft(event.target.value)}
          placeholder={t(textDialog.tool === 'sticky' ? 'draw.stickyPlaceholder' : 'draw.textPlaceholder')}
          className={`h-36 w-full resize-none rounded-xl border px-3 py-2 text-sm leading-relaxed outline-none ${theme === 'paper' || theme === 'seoul' ? 'border-slate-200 bg-white text-slate-950 placeholder:text-slate-400' : 'border-white/10 bg-black/20 text-white placeholder:text-slate-500'}`}
        />
        <div className="mt-3 flex justify-between gap-2">
          {textDialog.mode === 'edit' ? (
            <button
              type="button"
              onClick={() => {
                if (typeof textDialog.index === 'number') {
                  deleteSelected(textDialog.index)
                }
                closeTextDialog()
              }}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20"
            >
              {t('draw.deleteSelected')}
            </button>
          ) : <div />}
          <div className="flex gap-2">
            <button type="button" onClick={closeTextDialog} className={`rounded-lg border px-3 py-2 text-xs ${themeStyle.button}`}>{t('common.cancel')}</button>
            <button type="submit" className="rounded-lg border border-[#e50914]/70 bg-[#e50914] px-3 py-2 text-xs font-semibold text-white hover:bg-[#f6121d]">
              {textDialog.mode === 'edit' ? t('common.save') : t('draw.addText')}
            </button>
          </div>
        </div>
      </form>
    </div>
  ) : null
  const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')
  const toolbar = (
    <div
      ref={toolbarRef}
      className={cx(
        'fixed z-[90] w-[min(24rem,calc(100vw-1.25rem))] overflow-hidden rounded-[1.25rem] border shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-2xl transition-[opacity,transform,filter] duration-200 ease-out',
        toolbarPosition ? undefined : 'right-3 sm:right-5',
        toolbarHiddenForAction ? 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0 blur-sm' : 'opacity-100 blur-0',
        themeStyle.panel,
      )}
      style={toolbarPosition
        ? { left: toolbarPosition.left, top: toolbarPosition.top, maxHeight: 'calc(100dvh - ' + (toolbarPosition.top + 12) + 'px)' }
        : { top: resolvedToolbarTop, maxHeight: 'min(70dvh, 40rem)' }}
    >
      <div className="border-b border-current/10 px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <div
            className={cx('flex min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg px-1 py-1 active:cursor-grabbing', themeStyle.subtle)}
            title={t('draw.moveToolbar')}
            onPointerDown={startToolbarDrag}
            onPointerMove={dragToolbar}
            onPointerUp={endToolbarDrag}
            onPointerCancel={endToolbarDrag}
          >
            <GripHorizontal size={16} className="shrink-0 opacity-70" />
            <div className="min-w-0">
              <p className={cx('truncate text-[13px] font-semibold tracking-tight', themeStyle.text)}>Çizim ve not</p>
              <p className="truncate text-[10px] uppercase tracking-[0.16em] opacity-60">
                {pathCount ? String(pathCount) + ' öğe' : 'Yeni sayfa katmanı'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg border', themeStyle.button)}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X size={15} />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-black/10 p-1">
          {([
            ['tools', 'Çiz'],
            ['style', 'Stil'],
            ['actions', 'Düzenle'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setToolbarTab(value)}
              className={cx('rounded-lg px-2 py-1.5 text-[11px] font-semibold transition', toolbarTab === value ? themeStyle.active : 'opacity-65 hover:opacity-100')}
              aria-pressed={toolbarTab === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[min(58dvh,31rem)] overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin]">
        {toolbarTab === 'tools' && (
          <div className="space-y-3">
            {([
              {
                title: 'Temel',
                items: [
                  ['pen', Pencil, t('draw.pen')],
                  ['select', MousePointer2, t('draw.select')],
                  ['highlighter', Highlighter, t('draw.highlighter')],
                  ['eraser', Eraser, t('draw.eraser')],
                ],
              },
              {
                title: 'Şekil',
                items: [
                  ['line', Minus, t('draw.line')],
                  ['arrow', ArrowUpRight, t('draw.arrow')],
                  ['rectangle', Square, t('draw.rectangle')],
                  ['ellipse', Circle, t('draw.ellipse')],
                ],
              },
              {
                title: 'Not',
                items: [
                  ['text', Type, t('draw.text')],
                  ['sticky', StickyNote, t('draw.sticky')],
                ],
              },
            ] as const).map(section => (
              <section key={section.title}>
                <p className={cx('mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.16em]', themeStyle.subtle)}>{section.title}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {section.items.map(([value, Icon, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onToolChange(value)}
                      className={cx('flex min-h-10 items-center gap-2 rounded-xl border px-2.5 text-left text-[12px] font-medium transition', tool === value ? themeStyle.active : themeStyle.button)}
                      aria-pressed={tool === value}
                    >
                      <Icon size={16} className="shrink-0 opacity-85" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <div className={cx('flex items-center justify-between rounded-xl border border-current/10 px-3 py-2 text-[11px]', themeStyle.subtle)}>
              <span>{selectedLabel || 'Bir araç seç'}</span>
              <span className="opacity-60">D çiz · Esc kapat</span>
            </div>
          </div>
        )}

        {toolbarTab === 'style' && (
          <div className="space-y-4">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className={cx('text-[10px] font-semibold uppercase tracking-[0.16em]', themeStyle.subtle)}>{t('draw.presets')}</p>
                <span className={cx('text-[10px]', themeStyle.subtle)}>{t('draw.size', { size: brushSize })}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {themedPresets.map(preset => {
                  const active = tool === preset.tool && color.toLowerCase() === preset.color.toLowerCase() && brushSize === preset.size && Math.abs(opacity - preset.opacity) < 0.01
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className={cx('flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] transition', active ? themeStyle.active : themeStyle.button)}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/30" style={{ background: preset.color }} />
                      <span className="truncate">{t(`draw.preset.${preset.key}`)}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <p className={cx('mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]', themeStyle.subtle)}>Renk</p>
              <div className="flex flex-wrap items-center gap-2">
                {themePalette.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setColor(item)
                      setSelectedSavedColor(null)
                    }}
                    style={{ background: item }}
                    className={cx('h-8 w-8 rounded-full border-2 transition', color.toLowerCase() === item.toLowerCase() ? 'scale-110 border-white ring-2 ring-white/25' : 'border-white/15')}
                    aria-label={t('draw.color', { color: item })}
                  />
                ))}
                {savedColors.filter(item => !themePalette.some(paletteItem => paletteItem.toLowerCase() === item.toLowerCase())).map(item => (
                  <span key={item} className="relative inline-flex">
                    <button
                      type="button"
                      onClick={() => {
                        setColor(item)
                        setSelectedSavedColor(item)
                      }}
                      style={{ background: item }}
                      className={cx('h-8 w-8 rounded-full border-2 transition', color.toLowerCase() === item.toLowerCase() || selectedSavedColor === item ? 'scale-110 border-white ring-2 ring-cyan-400/40' : 'border-white/15')}
                      aria-label={t('draw.color', { color: item })}
                    />
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation()
                        removeSavedColor(item)
                      }}
                      className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-red-600 text-[10px] leading-none text-white shadow"
                      aria-label={t('draw.deleteColor')}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <label className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border px-2 text-[11px]', themeStyle.button)}>
                  <span className="sr-only">{t('draw.colorWheel')}</span>
                  <input
                    type="color"
                    value={customColor}
                    onChange={event => setColor(event.target.value)}
                    className="h-5 w-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
                    aria-label={t('draw.colorWheel')}
                  />
                  <span>Özel</span>
                </label>
                <button type="button" onClick={saveCustomColor} className={cx('h-8 rounded-full border px-2.5 text-[11px]', themeStyle.button)}>
                  Kaydet
                </button>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <label className={cx('text-[11px]', themeStyle.subtle)}>
                <span className="flex items-center justify-between"><span>Kalınlık</span><strong className={themeStyle.text}>{brushSize}px</strong></span>
                <input type="range" min={2} max={18} value={brushSize} onChange={e => setBrush(Number(e.target.value))} className="mt-2 w-full accent-[var(--reader-accent)]" style={{ '--reader-accent': themeStyle.accent } as React.CSSProperties} />
              </label>
              <label className={cx('text-[11px]', themeStyle.subtle)}>
                <span className="flex items-center justify-between"><span>Opaklık</span><strong className={themeStyle.text}>{Math.round(opacity * 100)}%</strong></span>
                <input type="range" min={15} max={100} value={Math.round(opacity * 100)} onChange={e => setAlpha(Number(e.target.value) / 100)} className="mt-2 w-full accent-[var(--reader-accent)]" style={{ '--reader-accent': themeStyle.accent } as React.CSSProperties} />
              </label>
            </section>
          </div>
        )}

        {toolbarTab === 'actions' && (
          <div className="space-y-3">
            <section>
              <p className={cx('mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.16em]', themeStyle.subtle)}>Geçmiş</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={undo} className={cx('rounded-xl border px-3 py-2 text-left text-[12px]', themeStyle.button)}>Geri al</button>
                <button type="button" onClick={redo} className={cx('rounded-xl border px-3 py-2 text-left text-[12px]', themeStyle.button)}>Yinele</button>
              </div>
            </section>
            <section>
              <p className={cx('mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.16em]', themeStyle.subtle)}>Seçili öğe</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={sendSelectedToBack} disabled={!hasSelection} className={cx('rounded-xl border px-3 py-2 text-left text-[12px] disabled:opacity-35', themeStyle.button)}>Arkaya</button>
                <button type="button" onClick={bringSelectedToFront} disabled={!hasSelection} className={cx('rounded-xl border px-3 py-2 text-left text-[12px] disabled:opacity-35', themeStyle.button)}>Öne</button>
                <button type="button" onClick={duplicateSelected} disabled={!hasSelection} className={cx('rounded-xl border px-3 py-2 text-left text-[12px] disabled:opacity-35', themeStyle.button)}>Çoğalt</button>
                <button type="button" onClick={editSelectedText} disabled={!hasSingleEditableText} className={cx('rounded-xl border px-3 py-2 text-left text-[12px] disabled:opacity-35', themeStyle.button)}>Metni düzenle</button>
                {tool === 'select' && (
                  <button type="button" onClick={() => setMultiSelectMode(prev => !prev)} className={cx('col-span-2 rounded-xl border px-3 py-2 text-left text-[12px]', multiSelectMode ? themeStyle.active : themeStyle.button)}>
                    {multiSelectMode ? 'Çoklu seçim açık' : t('draw.multiSelectMode')}
                  </button>
                )}
                <button type="button" onClick={() => deleteSelected()} disabled={!hasSelection} className={cx('rounded-xl border px-3 py-2 text-left text-[12px] disabled:opacity-35', themeStyle.button)}>Seçileni sil</button>
                <button type="button" onClick={clearAll} disabled={!hasPaths} className="rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-left text-[12px] text-red-200 disabled:opacity-35">Sayfayı temizle</button>
              </div>
            </section>
            <div className={cx('rounded-xl border border-current/10 px-3 py-2 text-[11px]', themeStyle.subtle)}>
              {hasSelection ? selectedLabel : 'Düzenlemek için bir öğe seç'}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-current/10 px-3 py-2.5">
        <button type="button" onClick={onCancel} className={cx('flex-1 rounded-xl border px-3 py-2 text-[12px] font-medium', themeStyle.button)}>{t('common.close')}</button>
        <button type="button" onClick={() => onSave(pathsRef.current)} disabled={isSaving} className="flex-1 rounded-xl border border-[#e50914]/70 bg-[#e50914] px-3 py-2 text-[12px] font-semibold text-white shadow-[0_0_22px_rgba(229,9,20,0.2)] transition hover:bg-[#f6121d] disabled:cursor-wait disabled:opacity-60">
          {isSaving ? 'Kaydediliyor…' : t('draw.save')}
        </button>
      </div>
    </div>
  )
  return (
    <div className="absolute inset-0 z-20">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={`absolute inset-0 h-full w-full touch-none ${tool === 'eraser' ? 'cursor-cell' : tool === 'select' ? 'cursor-move' : tool === 'text' || tool === 'sticky' ? 'cursor-text' : 'cursor-crosshair'}`}
        onPointerDown={startDraw}
        onPointerMove={draw}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
        onDoubleClick={editTextAtPoint}
      />

      {typeof document !== 'undefined' ? createPortal(toolbar, document.body) : toolbar}
      {textDialogNode && (typeof document !== 'undefined' ? createPortal(textDialogNode, document.body) : textDialogNode)}
    </div>
  )
}

export const DrawingOverlay = React.memo(function DrawingOverlay({ width, height, paths }: { width: number; height: number; paths: DrawPath[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    for (const path of paths) drawPath(ctx, path)
  }, [height, paths, width])

  return <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0 h-full w-full pointer-events-none" />
})
