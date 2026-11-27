'use client'

import { useEffect, useState } from 'react'
import { Bug } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { useToast } from '@/components/Toast'
import type { LibraryTheme } from '@/lib/libraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'

export interface BugReportRow {
  id: number
  username: string
  message: string
  page_url: string
  created_at: string
  resolved: number
  resolved_at: string | null
}

export default function BugReportsPanel({ libraryTheme }: { libraryTheme: LibraryTheme }) {
  const { t, locale } = useI18n()
  const { toast } = useToast()
  const [reports, setReports] = useState<BugReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const th = LIBRARY_THEME[libraryTheme]
  const inboxFailedMessage = t('bug.inboxFailed')
  const visibleReports = reports.filter(report => showResolved || !report.resolved)
  const openCount = reports.filter(report => !report.resolved).length

  useEffect(() => {
    let active = true
    fetch('/api/bug-reports', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error()
        return response.json()
      })
      .then(data => {
        if (active) setReports(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (active) setError(inboxFailedMessage)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [inboxFailedMessage])

  function formatDate(value: string) {
    const parsed = new Date(`${value.replace(' ', 'T')}Z`)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(locale)
  }

  function safePageUrl(value: string) {
    if (value.startsWith('/') || /^https?:\/\//i.test(value)) return value
    return ''
  }

  async function updateResolved(report: BugReportRow) {
    setUpdatingId(report.id)
    try {
      const response = await fetch('/api/bug-reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: report.id, resolved: !report.resolved }),
      })
      if (!response.ok) throw new Error()
      setReports(current => current.map(item => item.id === report.id
        ? { ...item, resolved: report.resolved ? 0 : 1, resolved_at: report.resolved ? null : new Date().toISOString() }
        : item))
      toast(report.resolved ? t('bug.reopened') : t('bug.resolved'))
    } catch {
      toast(t('bug.updateFailed'), 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <section className={`library-panel overflow-hidden rounded-2xl border p-4 shadow-[0_24px_80px_var(--lib-shadow)] sm:p-6 ${th.card}`}>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bug size={20} className="text-[var(--lib-accent-soft)]" />
            <h2 className={`truncate text-2xl font-black sm:text-3xl ${th.title}`}>{t('bug.inboxTitle')}</h2>
          </div>
          <p className={`mt-1 text-sm ${th.subtitle}`}>{t('library.bugsPageHint')}</p>
          {!loading && !error && (
            <p className={`mt-2 text-xs font-semibold ${th.cardMuted}`}>{t('bug.openCount', { count: openCount })}</p>
          )}
        </div>
        {!loading && !error && reports.some(report => report.resolved) && (
          <button
            type="button"
            onClick={() => setShowResolved(value => !value)}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition ${th.filterInactive}`}
          >
            {showResolved ? t('bug.hideResolved') : t('bug.showResolved')}
          </button>
        )}
      </header>

      <div className={`max-h-[calc(100dvh-16rem)] min-h-48 overflow-y-auto rounded-xl border ${th.emptyPanel}`}>
        {loading && <p className={`p-6 text-sm ${th.cardMuted}`}>{t('common.loading')}</p>}
        {error && <p className="p-6 text-sm font-semibold text-red-200">{error}</p>}
        {!loading && !error && visibleReports.length === 0 && (
          <p className={`p-6 text-sm ${th.cardMuted}`}>{showResolved ? t('bug.noResolved') : t('bug.inboxEmpty')}</p>
        )}
        {!loading && !error && visibleReports.map(report => {
          const pageUrl = safePageUrl(report.page_url)
          return (
            <article key={report.id} className={`border-b px-4 py-4 last:border-b-0 sm:px-5 border-[var(--lib-border)]`}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p className={`text-sm font-bold ${th.title}`}>{report.username}</p>
                <div className="flex items-center gap-2">
                  {Boolean(report.resolved) && (
                    <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-300">
                      {t('bug.statusResolved')}
                    </span>
                  )}
                  <time className={`text-xs ${th.cardMuted}`}>{formatDate(report.created_at)}</time>
                </div>
              </div>
              <p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed ${th.cardSub}`}>{report.message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {pageUrl && (
                    <a href={pageUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 truncate text-xs font-bold text-[var(--lib-accent-soft)] hover:text-[var(--lib-text)]">
                    {t('bug.openPage')}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => updateResolved(report)}
                  disabled={updatingId === report.id}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${th.filterInactive}`}
                >
                  {report.resolved ? t('bug.reopen') : t('bug.resolve')}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
