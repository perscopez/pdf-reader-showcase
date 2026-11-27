'use client'

import { useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import type { LibraryTheme } from '@/lib/libraryTheme'
import SmoothOverlay from '@/components/SmoothOverlay'
import { LIBRARY_THEME } from '@/lib/libraryTheme'

export default function BugReportDialog({ libraryTheme, onClose, onSent }: {
  libraryTheme: LibraryTheme
  onClose: () => void
  onSent: () => void
}) {
  const { t } = useI18n()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const cinematic = libraryTheme !== 'seoul'
  const th = LIBRARY_THEME[libraryTheme]

  async function submit() {
    if (message.trim().length < 5) {
      setError(t('bug.tooShort'))
      return
    }
    setSending(true)
    setError('')
    try {
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, pageUrl: window.location.href }),
      })
      if (!response.ok) throw new Error()
      onSent()
    } catch {
      setError(t('bug.failed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <SmoothOverlay open onClose={onClose} zIndex={60} panelClassName={`max-w-md rounded-xl border p-5 shadow-2xl ${cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'}`}>
        <h2 className={`text-lg font-bold ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>{t('bug.title')}</h2>
        <p className={`mt-1 text-sm ${cinematic ? 'text-slate-400' : 'text-[#7A7060]'}`}>{t('bug.hint')}</p>
        <textarea
          value={message}
          onChange={event => setMessage(event.target.value)}
          placeholder={t('bug.placeholder')}
          rows={6}
          maxLength={2000}
          className={`mt-4 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-[var(--lib-accent)]/70 ${cinematic ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500' : 'border-[#DDD9D0] bg-white text-[#1C1A17] placeholder:text-[#9A9080]'}`}
        />
        {error && (
          <p className={`mt-2 text-xs font-semibold ${cinematic ? 'text-red-300' : 'text-red-600'}`}>
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className={`flex-1 rounded-lg py-2.5 text-sm transition ${cinematic ? 'bg-white/10 text-white hover:bg-white/15' : 'border border-[#DDD9D0] bg-white text-[#5A5245] hover:bg-[#EDE9E1]'}`}>{t('common.cancel')}</button>
          <button onClick={submit} disabled={sending} className={`flex-1 rounded-lg py-2.5 text-sm font-bold text-white transition disabled:opacity-50 ${libraryTheme === 'dark' ? 'bg-[#e50914] hover:bg-[#f6121d]' : libraryTheme === 'seoul' ? 'bg-[#4A9B8E] hover:bg-[#3D8A7E]' : th.addBtn}`}>
            {sending ? t('bug.sending') : t('bug.send')}
          </button>
        </div>
    </SmoothOverlay>
  )
}
