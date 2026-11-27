'use client'

import { LibraryTheme } from '@/lib/libraryTheme'

interface ReaderLoadingShellProps {
  libraryTheme?: LibraryTheme
  message?: string
  showDecryptMessage?: boolean
  onBack?: () => void
  onRetry?: () => void
}

export default function ReaderLoadingShell({
  libraryTheme = 'dark',
  message,
  showDecryptMessage = false,
  onBack,
  onRetry,
}: ReaderLoadingShellProps) {
  const isSeoul = libraryTheme === 'seoul'
  const bgClass = isSeoul ? 'bg-[#FAF8F3] text-[#1C1A17]' : 'bg-[#050312] text-slate-200'
  const barClass = isSeoul ? 'border-[#E0DDD6] bg-white/80' : 'border-white/10 bg-[#141414]/70'
  const skelClass = isSeoul ? 'bg-[#EDE9E1]' : 'bg-white/[0.08]'
  const mutedClass = isSeoul ? 'text-[#7A7060]' : 'text-slate-400'

  return (
    <div className={`reader-loading-shell ${bgClass}`}>
      <div className={`reader-loading-toolbar ${barClass}`}>
        <div className={`h-8 w-8 rounded-lg ${skelClass} skeleton-shimmer`} />
        <div className={`h-4 flex-1 max-w-[10rem] rounded ${skelClass} skeleton-shimmer`} />
        <div className={`h-8 w-20 rounded-lg ${skelClass} skeleton-shimmer`} />
      </div>
      <div className="reader-loading-canvas">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className={`reader-loading-page mx-auto ${skelClass} skeleton-shimmer`} />
          <div className="reader-pdf-loading-bar mx-auto max-w-xs" />
          {(message || showDecryptMessage) && (
            <p className={`text-sm ${mutedClass}`}>
              {message}
            </p>
          )}
          {(onBack || onRetry) && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {onBack && <button type="button" onClick={onBack} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${isSeoul ? 'border-[#D4CFC5] text-[#5A5245] hover:bg-[#F1EEE7]' : 'border-white/15 text-slate-300 hover:bg-white/10'}`}>Kütüphaneye dön</button>}
              {onRetry && <button type="button" onClick={onRetry} className={`rounded-xl px-4 py-2 text-sm font-semibold ${isSeoul ? 'bg-[#4A9B8E] text-white hover:bg-[#3D8A7E]' : 'bg-violet-500 text-white hover:bg-violet-400'}`}>Tekrar dene</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
