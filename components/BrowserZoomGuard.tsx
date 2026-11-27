'use client'

import { useEffect } from 'react'

export default function BrowserZoomGuard() {
  useEffect(() => {
    function preventGesture(event: Event) {
      event.preventDefault()
    }

    function preventWheelZoom(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
    }

    function preventMultiTouchBrowserZoom(event: TouchEvent) {
      if (event.touches.length < 2) return
      event.preventDefault()
    }

    document.addEventListener('gesturestart', preventGesture, { passive: false })
    document.addEventListener('gesturechange', preventGesture, { passive: false })
    document.addEventListener('gestureend', preventGesture, { passive: false })
    document.addEventListener('wheel', preventWheelZoom, { passive: false })
    document.addEventListener('touchstart', preventMultiTouchBrowserZoom, { passive: false })
    document.addEventListener('touchmove', preventMultiTouchBrowserZoom, { passive: false })

    return () => {
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
      document.removeEventListener('gestureend', preventGesture)
      document.removeEventListener('wheel', preventWheelZoom)
      document.removeEventListener('touchstart', preventMultiTouchBrowserZoom)
      document.removeEventListener('touchmove', preventMultiTouchBrowserZoom)
    }
  }, [])

  return null
}
