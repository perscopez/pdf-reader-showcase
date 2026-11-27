'use client'

import { useEffect, useRef, useState } from 'react'
import { LibraryTheme } from '@/lib/libraryTheme'
import { THEME_STORAGE } from '@/lib/themePreferences'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { LANGUAGE_OPTIONS, useI18n } from './I18nProvider'

export default function LanguageSwitcher({
  compact = false,
  className = '',
  isDark: propIsDark,
  buttonClass,
  panelClass,
}: {
  compact?: boolean
  className?: string
  isDark?: boolean
  buttonClass?: string
  panelClass?: string
}) {
  const { language, setLanguage, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = LANGUAGE_OPTIONS.find(option => option.code === language) || LANGUAGE_OPTIONS[0]

  const [libraryTheme, setLibraryTheme] = useState<LibraryTheme>(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      return (localStorage.getItem(THEME_STORAGE.library) as LibraryTheme) || 'dark'
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleThemeChange = () => {
        try {
          const theme = localStorage.getItem(THEME_STORAGE.library) as LibraryTheme
          if (theme) setLibraryTheme(theme)
        } catch (e) {
          console.warn(e)
        }
      }
      window.addEventListener('storage', handleThemeChange)
      window.addEventListener('library-theme-changed', handleThemeChange)
      return () => {
        window.removeEventListener('storage', handleThemeChange)
        window.removeEventListener('library-theme-changed', handleThemeChange)
      }
    }
  }, [])

  const isDark = propIsDark !== undefined ? propIsDark : libraryTheme !== 'seoul'

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <div ref={ref} className="relative z-[90] inline-flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-label={t('common.language')}
        aria-expanded={open}
        className={`${
          buttonClass !== undefined
            ? buttonClass
            : `inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-sm transition ${
                isDark
                  ? 'border-white/10 bg-[#141414]/90 text-[#e5e2e1] hover:border-white/20 hover:bg-[#202020]'
                  : 'border-[#DDD9D0] bg-white text-[#2C2A26] hover:bg-[#EDE9E1]'
              }`
        } ${className}`}
      >
        <Languages size={compact ? 14 : 16} className="text-slate-400" />
        <span className="text-xs font-semibold">{compact ? active.short : active.label}</span>
        <ChevronDown size={13} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className={`${
            panelClass !== undefined
              ? panelClass
              : `absolute right-0 top-full z-[400] mt-2 w-40 overflow-hidden rounded-lg border p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.72)] ${
                  isDark
                    ? 'liquid-glass-panel border-white/10 text-white'
                    : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'
                }`
          }`}
        >
          {LANGUAGE_OPTIONS.map(option => (
            <button
              key={option.code}
              type="button"
              onClick={() => {
                setLanguage(option.code)
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs font-semibold ${isDark ? 'text-white hover:bg-white/[0.08]' : 'text-[#2C2A26] hover:bg-[#EDE9E1]'}`}
            >
              <span>{option.label}</span>
              {option.code === language && <Check size={14} className={isDark ? 'text-[#ff696f]' : 'text-[#4A9B8E]'} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
