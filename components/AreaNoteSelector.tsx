'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { X } from 'lucide-react'
import type { AnnotationArea } from './ReaderTypes'

interface AreaNoteSelectorProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  accent: string
  cancelLabel: string
  onComplete: (area: AnnotationArea, previewDataUrl: string) => void
  onCancel: () => void
}

type Drag = { startX: number; startY: number; endX: number; endY: number }

function normalizedArea(drag: Drag): AnnotationArea {
  return {
    left: Math.min(drag.startX, drag.endX),
    top: Math.min(drag.startY, drag.endY),
    width: Math.abs(drag.endX - drag.startX),
    height: Math.abs(drag.endY - drag.startY),
  }
}

export default function AreaNoteSelector({ canvasRef, accent, cancelLabel, onComplete, onCancel }: AreaNoteSelectorProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  function point(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return
    const next = point(event)
    const area = normalizedArea({ ...drag, endX: next.x, endY: next.y })
    setDrag(null)
    if (area.width < 0.025 || area.height < 0.025) return

    const source = canvasRef.current
    if (!source) return
    const crop = document.createElement('canvas')
    crop.width = Math.max(1, Math.round(source.width * area.width))
    crop.height = Math.max(1, Math.round(source.height * area.height))
    const context = crop.getContext('2d')
    if (!context) return
    context.drawImage(
      source,
      Math.round(source.width * area.left),
      Math.round(source.height * area.top),
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    )
    onComplete(area, crop.toDataURL('image/jpeg', 0.82))
  }

  const area = drag ? normalizedArea(drag) : null

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0 z-50 cursor-crosshair touch-none"
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId)
        const next = point(event)
        setDrag({ startX: next.x, startY: next.y, endX: next.x, endY: next.y })
      }}
      onPointerMove={event => {
        if (!drag) return
        const next = point(event)
        setDrag(current => current ? { ...current, endX: next.x, endY: next.y } : null)
      }}
      onPointerUp={finish}
      style={{ background: 'rgba(0,0,0,0.08)' }}
    >
      <button type="button" onClick={event => { event.stopPropagation(); onCancel() }} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/65 text-white backdrop-blur-xl" aria-label={cancelLabel}>
        <X size={16} />
      </button>
      {area && (
        <div
          className="absolute border-2 bg-white/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]"
          style={{
            left: `${area.left * 100}%`,
            top: `${area.top * 100}%`,
            width: `${area.width * 100}%`,
            height: `${area.height * 100}%`,
            borderColor: accent,
          }}
        />
      )}
    </div>
  )
}
