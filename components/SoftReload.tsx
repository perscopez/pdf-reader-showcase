'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { RotateCw, Sparkles } from 'lucide-react'

export default function SoftReload() {
  const pathname = usePathname()
  const [spinning, setSpinning]   = useState(false)

  if (pathname?.startsWith('/reader')) return null

  function handleManualRefresh() {
    if (spinning) return
    setSpinning(true)
    setTimeout(() => window.location.reload(), 300)
  }

  function handleAskAi() {
    window.dispatchEvent(new CustomEvent('opencode:ask-ai'))
  }

  const btnClass = "flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/60 shadow-lg backdrop-blur-md transition hover:border-white/30 hover:bg-black/75 hover:text-white active:scale-90"

  return (
    <div className="fixed bottom-4 right-4 z-[999] flex items-center gap-2">
      <button
        onClick={handleManualRefresh}
        title="Sayfayı yenile"
        aria-label="Sayfayı yenile"
        className={btnClass}
        style={{ WebkitBackdropFilter: 'blur(12px)' }}
      >
        <RotateCw size={15} className={spinning ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}
