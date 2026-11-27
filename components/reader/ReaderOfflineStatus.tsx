'use client'

import { useEffect, useState } from 'react'

type ThemeStyle = { subtle: string; button: string; active: string }

export function ReaderOfflineStatus({
  themeStyle,
  syncPending,
  prefetching = false,
  onRetry,
}: {
  themeStyle: ThemeStyle
  syncPending: number
  prefetching?: boolean
  onRetry?: () => void
}) {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  if (online && syncPending === 0 && !prefetching) return null
  return (
    <div className={`pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-lg backdrop-blur-md ${online ? themeStyle.button : 'border-amber-300/30 bg-amber-300/10 text-amber-100'}`} role="status" aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-amber-400' : 'bg-red-400'}`} />
      <span>{online ? (prefetching ? 'Preparing next pages…' : `${syncPending} queued`) : 'Offline · cached pages only'}</span>
      {online && onRetry && <button type="button" onClick={onRetry} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${themeStyle.active}`}>Retry</button>}
    </div>
  )
}
