'use client'

import { useEffect, useState } from 'react'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import ReadingStatsPanel from '@/components/ReadingStatsPanel'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import { useI18n } from '@/components/I18nProvider'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'
import type { ReadingSummary } from '@/lib/readingDisplay'
import { getSyncMeta, saveSyncMeta } from '@/lib/indexedDb'

export default function ReadingStatsPage() {
  const { t } = useI18n()
  const libraryTheme = useLibraryTheme()
  const [summary, setSummary] = useState<ReadingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const th = LIBRARY_THEME[libraryTheme]

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const cached = await getSyncMeta('reading_summary')
        if (cached && active) setSummary(JSON.parse(cached))
        const res = await fetch('/api/reading-summary')
        if (!res.ok) throw new Error()
        const data = await res.json() as ReadingSummary
        if (!active) return
        await saveSyncMeta('reading_summary', JSON.stringify(data))
        setSummary(data)
        setError(false)
      } catch {
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  return (
    <LibraryPageShell
      title={t('library.nav.stats')}
      subtitle={t('library.statsPageHint')}
      libraryTheme={libraryTheme}
      active="stats"
    >
      <div className="mb-4 flex items-center justify-end gap-2">
        <SyncStatusBadge compact={false} />
        <LanguageSwitcher compact />
      </div>

      {loading && (
        <div className={`rounded-2xl border p-8 text-center text-sm ${th.card} ${th.cardMuted}`}>
          {t('common.loading')}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-red-400/25 bg-red-400/10 p-8 text-center text-sm text-red-200">
          {t('library.statsLoadFailed')}
        </div>
      )}

      {!loading && summary && <ReadingStatsPanel summary={summary} libraryTheme={libraryTheme} />}
    </LibraryPageShell>
  )
}
