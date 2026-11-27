'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReaderCommand } from '@/lib/readerV3'

type ThemeStyle = {
  panel: string
  subtle: string
  text: string
  button: string
  active: string
}

export function ReaderCommandPalette({
  open,
  commands,
  themeStyle,
  title,
  placeholder,
  emptyLabel,
  onClose,
}: {
  open: boolean
  commands: ReaderCommand[]
  themeStyle: ThemeStyle
  title: string
  placeholder: string
  emptyLabel: string
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return commands.filter(command => !command.disabled)
    return commands.filter(command => {
      if (command.disabled) return false
      return [command.label, command.hint || '', ...(command.keywords || [])].join(' ').toLocaleLowerCase().includes(needle)
    })
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      setQuery('')
      setActiveIndex(0)
      inputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex(index => Math.min(Math.max(0, filtered.length - 1), index + 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(index => Math.max(0, index - 1))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        filtered[activeIndex]?.run()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, filtered, onClose, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/55 px-3 pt-[max(5rem,15vh)] backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={`w-full max-w-xl overflow-hidden rounded-2xl border shadow-[0_30px_100px_rgba(0,0,0,0.55)] ${themeStyle.panel}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="border-b border-white/10 px-4 py-3">
          <p className={`mb-2 text-[10px] font-bold uppercase tracking-[0.18em] ${themeStyle.subtle}`}>{title}</p>
          <input
            ref={inputRef}
            value={query}
            onChange={event => { setQuery(event.target.value); setActiveIndex(0) }}
            placeholder={placeholder}
            className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ${themeStyle.button}`}
            aria-label={placeholder}
          />
        </div>
        <div className="max-h-[min(26rem,55vh)] overflow-y-auto p-2" role="listbox">
          {filtered.length === 0 ? (
            <p className={`px-3 py-8 text-center text-sm ${themeStyle.subtle}`}>{emptyLabel}</p>
          ) : filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => { command.run(); onClose() }}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${index === activeIndex ? themeStyle.active : themeStyle.button}`}
            >
              <span className="min-w-0">
                <span className={`block truncate font-semibold ${themeStyle.text}`}>{command.label}</span>
                {command.hint && <span className={`mt-0.5 block truncate text-xs ${themeStyle.subtle}`}>{command.hint}</span>}
              </span>
              {command.shortcut && <kbd className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${themeStyle.subtle}`}>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
