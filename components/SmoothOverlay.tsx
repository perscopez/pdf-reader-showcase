'use client'

import { useEffect, useRef, type ReactNode } from 'react'

interface SmoothOverlayProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  panelClassName?: string
  zIndex?: number
  labelledBy?: string
}

export default function SmoothOverlay({
  open,
  onClose,
  children,
  className = '',
  panelClassName = '',
  zIndex = 50,
  labelledBy,
}: SmoothOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }

    window.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className={`smooth-overlay-root overlay-backdrop ${className}`}
      style={{ zIndex }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`smooth-overlay-panel ${panelClassName}`}
        onClick={event => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
