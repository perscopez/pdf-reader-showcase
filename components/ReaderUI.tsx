import React from 'react'
import { Moon, Sun, Coffee, Landmark } from 'lucide-react'
import type { ReaderTheme } from './ReaderTypes'

export const DRAW_COLORS = ['#f43f5e', '#fb923c', '#facc15', '#34d399', '#38bdf8', '#818cf8', '#c084fc', '#f8fafc']

export const THEME_STYLES: Record<ReaderTheme, {
  label: string
  icon: typeof Moon
  shell: string
  header: string
  canvas: string
  panel: string
  subtle: string
  text: string
  button: string
  active: string
  accent: string
  accentGlow: string
}> = {
  midnight: {
    label: 'Cinema',
    icon: Moon,
    shell: 'bg-[#050505] text-[#f8f8f8]',
    header: 'liquid-glass-bar border-white/10 text-[#f8f8f8]',
    canvas: 'bg-[#181818]',
    panel: 'liquid-glass-panel border-white/10 text-[#f8f8f8]',
    subtle: 'text-[#b3b3b3]',
    text: 'text-[#f8f8f8]',
    button: 'border-white/10 bg-white/[0.06] text-[#e5e2e1] hover:border-white/20 hover:bg-white/[0.11]',
    active: 'border-[#e50914]/70 bg-[#e50914]/18 text-[#ffb4aa] shadow-[0_0_22px_rgba(229,9,20,0.18)]',
    accent: '#e50914',
    accentGlow: 'rgba(229,9,20,0.55)',
  },
  slate: {
    label: 'Slate',
    icon: Moon,
    shell: 'bg-slate-950 text-slate-100',
    header: 'liquid-glass-bar border-slate-800 text-slate-100',
    canvas: 'bg-slate-800',
    panel: 'liquid-glass-panel border-slate-800 text-slate-100',
    subtle: 'text-slate-400',
    text: 'text-slate-100',
    button: 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700',
    active: 'border-blue-400/60 bg-blue-500/20 text-blue-100',
    accent: '#60a5fa',
    accentGlow: 'rgba(96,165,250,0.55)',
  },
  paper: {
    label: 'Light',
    icon: Sun,
    shell: 'bg-slate-100 text-slate-950',
    header: 'liquid-glass-bar-light border-slate-200 text-slate-950',
    canvas: 'bg-slate-200',
    panel: 'liquid-glass-panel-light border-slate-200 text-slate-950',
    subtle: 'text-slate-500',
    text: 'text-slate-950',
    button: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100',
    active: 'border-blue-400 bg-blue-50 text-blue-700',
    accent: '#2563eb',
    accentGlow: 'rgba(37,99,235,0.45)',
  },
  sepia: {
    label: 'Sepia',
    icon: Coffee,
    shell: 'bg-[#17120c] text-[#f5ead8]',
    header: 'liquid-glass-bar-sepia border-[#3a2d1e] text-[#f5ead8]',
    canvas: 'bg-[#241a10]',
    panel: 'liquid-glass-panel-sepia border-[#3a2d1e] text-[#f5ead8]',
    subtle: 'text-[#b5a58f]',
    text: 'text-[#f5ead8]',
    button: 'border-[#3a2d1e] bg-[#2b2014] text-[#f5ead8] hover:bg-[#352719]',
    active: 'border-amber-300/60 bg-amber-500/20 text-amber-100',
    accent: '#fbbf24',
    accentGlow: 'rgba(251,191,36,0.5)',
  },
  seoul: {
    label: 'Seoul',
    icon: Landmark,
    shell: 'bg-[#FAF8F3] text-[#1C1A17]',
    header: 'liquid-glass-bar-seoul border-[#D4CFC5] text-[#1C1A17]',
    canvas: 'bg-[#F0EDE6]',
    panel: 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]',
    subtle: 'text-[#7A7060]',
    text: 'text-[#1C1A17]',
    button: 'border-[#D4CFC5] bg-white text-[#2C2A26] hover:bg-[#EDE9E1]',
    active: 'border-[#4A9B8E]/60 bg-[#4A9B8E]/15 text-[#2D6B62]',
    accent: '#4A9B8E',
    accentGlow: 'rgba(74,155,142,0.5)',
  },
}

export function IconButton({
  label,
  active,
  className,
  children,
  onClick,
  disabled,
  large,
}: {
  label: string
  active?: boolean
  className?: string
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  large?: boolean
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 ${large ? 'h-11 w-11' : 'h-9 w-9'} items-center justify-center rounded-xl border text-sm transition disabled:cursor-not-allowed disabled:opacity-35 ${className || ''}`}
      aria-pressed={active || undefined}
    >
      {children}
    </button>
  )
}

export function compactDuration(seconds = 0) {
  const minutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours && rest) return `${hours}h ${rest}m`
  if (hours) return `${hours}h`
  return `${Math.max(1, minutes)}m`
}
