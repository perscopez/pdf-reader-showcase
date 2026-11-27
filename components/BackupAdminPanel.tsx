'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive, Cloud, HardDrive, Play, RefreshCw, Server } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import type { LibraryTheme } from '@/lib/libraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'
import type { BackupStatusFile } from '@/lib/backupAdmin'

interface BackupPayload {
  status: BackupStatusFile
  capabilities: {
    s3Configured: boolean
    localDir: string
    hostDir: string
    s3IntervalHours: number
    localKeep: number
    hostKeep: number
  }
  cron: {
    expected: string
    logTail: string
  }
}

function formatWhen(value: string | null | undefined, locale: string) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
  }
}

export default function BackupAdminPanel({ libraryTheme }: { libraryTheme: LibraryTheme }) {
  const { t, locale } = useI18n()
  const th = LIBRARY_THEME[libraryTheme]
  const [data, setData] = useState<BackupPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/admin/backups', { cache: 'no-store' })
      if (!res.ok) throw new Error('load_failed')
      setData(await res.json())
    } catch {
      setError(t('backup.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const boot = window.setTimeout(() => { void load() }, 0)
    const timer = window.setInterval(() => { void load() }, 15000)
    return () => {
      window.clearTimeout(boot)
      window.clearInterval(timer)
    }
  }, [load])

  async function runBackup() {
    setTriggering(true)
    setError('')
    try {
      const res = await fetch('/api/admin/backups', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'trigger_failed')
      }
      await load()
    } catch {
      setError(t('backup.triggerFailed'))
    } finally {
      setTriggering(false)
    }
  }

  if (loading && !data) {
    return <p className={`text-sm ${th.bookMeta}`}>{t('common.loading')}</p>
  }

  const status = data?.status
  const last = status?.lastRun
  const card = `${th.card} shadow-[0_20px_70px_var(--lib-shadow)]`

  return (
    <div className="space-y-5">
      <section className={`library-panel rounded-2xl border p-4 sm:p-6 ${card}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={`text-xs font-black uppercase tracking-[0.18em] ${th.bookCat}`}>{t('backup.overviewLabel')}</p>
            <h2 className={`mt-1 text-2xl font-black ${th.title}`}>{t('backup.overviewTitle')}</h2>
            <p className={`mt-2 max-w-2xl text-sm ${th.bookMeta}`}>{t('backup.overviewHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={load}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold ${th.filterInactive}`}
            >
              <RefreshCw size={16} />
              {t('backup.refresh')}
            </button>
            <button
              onClick={runBackup}
              disabled={triggering || status?.running}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-50 ${th.addBtn}`}
            >
              <Play size={16} fill="currentColor" />
              {triggering || status?.running ? t('backup.running') : t('backup.runNow')}
            </button>
          </div>
        </div>

        {error && <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            [HardDrive, t('backup.layer.local'), last?.local?.ok ? t('backup.status.ok') : (last?.local?.error ? t('backup.status.failed') : t('backup.status.unknown')), formatWhen(last?.local?.finishedAt || last?.finishedAt, locale), last?.local?.sizeLabel || '—'],
            [Server, t('backup.layer.host'), last?.local?.ok ? t('backup.status.ok') : t('backup.status.unknown'), formatWhen(last?.finishedAt, locale), `${data?.capabilities.hostKeep || 14} ${t('backup.keepLabel')}`],
            [Cloud, t('backup.layer.s3'), data?.capabilities.s3Configured ? (last?.s3?.skipped ? t('backup.status.skipped') : (last?.s3?.ok ? t('backup.status.ok') : t('backup.status.failed'))) : t('backup.status.notConfigured'), formatWhen(last?.s3?.finishedAt, locale), data?.capabilities.s3Configured ? t('backup.s3Every', { hours: data.capabilities.s3IntervalHours }) : t('backup.s3Missing')],
          ].map(([Icon, title, state, when, meta]) => {
            const IconComp = Icon as typeof HardDrive
            return (
              <article key={title as string} className={`rounded-xl border p-4 ${th.cardBadge}`}>
                <div className="flex items-center gap-2">
                  <IconComp size={16} className="text-[var(--lib-accent-soft)]" />
                  <p className={`text-sm font-bold ${th.bookTitle}`}>{title as string}</p>
                </div>
                <p className={`mt-3 text-lg font-black ${th.title}`}>{state as string}</p>
                <p className={`mt-1 text-xs ${th.bookMeta}`}>{when as string}</p>
                <p className={`mt-2 text-xs ${th.bookMeta}`}>{meta as string}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className={`rounded-2xl border p-4 sm:p-5 ${card}`}>
        <h3 className={`text-lg font-black ${th.title}`}>{t('backup.archivesTitle')}</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[
            [t('backup.archives.local'), status?.archives?.local || []],
            [t('backup.archives.host'), status?.archives?.host || []],
          ].map(([title, items]) => (
            <div key={title as string}>
              <p className={`mb-2 text-xs font-black uppercase tracking-[0.16em] ${th.bookCat}`}>{title as string}</p>
              <div className="space-y-2">
                {(items as BackupPayload['status']['archives']['local']).slice(0, 8).map(item => (
                  <div key={item.name} className={`rounded-lg border px-3 py-2 text-sm ${th.cardBadge}`}>
                    <p className={`font-semibold ${th.bookTitle}`}>{item.name}</p>
                    <p className={`text-xs ${th.bookMeta}`}>{item.sizeLabel} · {formatWhen(item.modifiedAt, locale)}</p>
                  </div>
                ))}
                {(items as BackupPayload['status']['archives']['local']).length === 0 && (
                  <p className={`text-sm ${th.bookMeta}`}>{t('backup.noArchives')}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={`rounded-2xl border p-4 sm:p-5 ${card}`}>
        <div className="flex items-center gap-2">
          <Archive size={16} className="text-[var(--lib-accent-soft)]" />
          <h3 className={`text-lg font-black ${th.title}`}>{t('backup.historyTitle')}</h3>
        </div>
        <div className="mt-3 space-y-2">
          {(status?.history || []).slice(0, 10).map((entry, index) => (
            <div key={`${entry.finishedAt}-${index}`} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${th.cardBadge}`}>
              <span className={th.bookTitle}>{formatWhen(entry.finishedAt, locale)}</span>
              <span className={th.bookMeta}>{entry.trigger} · {entry.success ? t('backup.status.ok') : t('backup.status.failed')}{entry.localSizeLabel ? ` · ${entry.localSizeLabel}` : ''}</span>
            </div>
          ))}
          {!status?.history?.length && <p className={`text-sm ${th.bookMeta}`}>{t('backup.noHistory')}</p>}
        </div>
      </section>

      {data?.cron.logTail && (
        <section className={`rounded-2xl border p-4 sm:p-5 ${card}`}>
          <h3 className={`text-lg font-black ${th.title}`}>{t('backup.logTitle')}</h3>
          <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-[var(--lib-border)] bg-[var(--lib-surface-strong)] p-3 text-xs leading-relaxed text-[var(--lib-text-secondary)]">{data.cron.logTail}</pre>
        </section>
      )}
    </div>
  )
}
