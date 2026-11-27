'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { calculateReaderPageWindow } from '@/lib/readerV3'

interface ContinuousReaderProps {
  totalPages: number
  currentPage: number
  onPageChange: (page: number) => void
  scrollRootRef: RefObject<HTMLElement | null>
  renderPage: (page: number) => ReactNode
  estimatedPageHeight?: number
  className?: string
  reduceMotion?: boolean
}

/**
 * A bounded page window for long PDFs. Placeholders keep the scrollbar stable
 * while only pages near the active viewport own a PDF.js canvas/text layer.
 */
export function ContinuousReader({
  totalPages,
  currentPage,
  onPageChange,
  scrollRootRef,
  renderPage,
  estimatedPageHeight = 920,
  className = '',
  reduceMotion = false,
}: ContinuousReaderProps) {
  const [activePage, setActivePage] = useState(Math.max(1, currentPage))
  const activePageRef = useRef(activePage)
  const suppressObserverUntilRef = useRef(0)
  const initialObserverGuardRef = useRef(true)
  const initialJumpRef = useRef(true)
  useEffect(() => {
    activePageRef.current = activePage
  }, [activePage])
  const pageWindow = useMemo(() => calculateReaderPageWindow(activePage, totalPages, 2), [activePage, totalPages])
  const renderedPages = useMemo(() => new Set(pageWindow.pages), [pageWindow.pages])

  useEffect(() => {
    const root = scrollRootRef.current
    if (!root || totalPages < 1) return
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-continuous-page], [data-continuous-placeholder]'))
    if (targets.length === 0 || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (initialObserverGuardRef.current || Date.now() < suppressObserverUntilRef.current) return
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
      const target = visible[0]?.target as HTMLElement | undefined
      const page = Number(target?.dataset.continuousPage || target?.dataset.continuousPlaceholder || 0)
      if (!page || page === activePageRef.current) return
      activePageRef.current = page
      setActivePage(page)
      onPageChange(page)
    }, { root, rootMargin: '35% 0px 35% 0px', threshold: [0.1, 0.35, 0.65, 0.9] })
    targets.forEach(target => observer.observe(target))
    return () => observer.disconnect()
  }, [onPageChange, pageWindow, scrollRootRef])

  useEffect(() => {
    const page = Math.min(Math.max(1, currentPage), Math.max(1, totalPages))
    if (!page || page === activePageRef.current) return
    activePageRef.current = page
    setActivePage(page)
  }, [currentPage, reduceMotion, scrollRootRef, totalPages])

  // The active page may be outside the bounded render window. Wait for the
  // window to render before attempting to scroll; otherwise keyboard/page
  // input navigation appears to do nothing until the user scrolls manually.
  useEffect(() => {
    const root = scrollRootRef.current
    if (!root || activePage < 1) return
    const timer = window.setTimeout(() => {
      const target = root.querySelector<HTMLElement>(`[data-continuous-page="${activePage}"]`)
      if (!target) return
      // Entering continuous mode can jump dozens of pages. Use an immediate
      // anchor for that first jump, then let normal user scrolling be smooth.
      const initialJump = initialJumpRef.current
      initialJumpRef.current = false
      suppressObserverUntilRef.current = Date.now() + (initialJump ? 1500 : 450)
      target.scrollIntoView({ behavior: initialJump || reduceMotion ? 'auto' : 'smooth', block: 'center' })
      initialObserverGuardRef.current = false
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activePage, currentPage, reduceMotion, renderedPages, scrollRootRef, totalPages])

  if (totalPages < 1) return null

  return (
    <div className={`continuous-reader mx-auto flex min-w-0 w-full flex-col items-center gap-8 py-8 ${className}`}>
      {Array.from({ length: totalPages }, (_, index) => index + 1).map(page => (
        renderedPages.has(page) ? (
          <section
            key={page}
            data-continuous-page={page}
            aria-label={`Page ${page}`}
            className="continuous-reader-page relative flex min-h-0 w-fit max-w-full justify-center"
          >
            {renderPage(page)}
          </section>
        ) : (
          <div
            key={page}
            data-continuous-placeholder={page}
            aria-hidden="true"
            className="continuous-reader-placeholder w-full max-w-4xl rounded-sm opacity-40"
            style={{ height: estimatedPageHeight }}
          />
        )
      ))}
    </div>
  )
}
