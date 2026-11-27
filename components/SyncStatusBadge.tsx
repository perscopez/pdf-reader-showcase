'use client'

import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { useI18n } from './I18nProvider'
import { useSync } from './SyncProvider'
import { getDirtyRecords, initDb } from '@/lib/indexedDb'
import SyncCenterModal from './SyncCenterModal'

interface SyncStatusBadgeProps {
  className?: string
  compact?: boolean
}

export default function SyncStatusBadge({ className = '', compact = false }: SyncStatusBadgeProps) {
  const { t, locale } = useI18n()
  const { isSyncing, isOffline, syncPhase, lastSyncAt, error, conflicts } = useSync()
  const [pendingCount, setPendingCount] = useState(0)
  const [centerOpen, setCenterOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadPending() {
      try {
        await initDb()
        const stores = ['books', 'annotations', 'bookmarks', 'word_library', 'reading_sessions']
        const counts = await Promise.all(stores.map(store => getDirtyRecords(store)))
        if (!cancelled) {
          setPendingCount(counts.reduce((sum, rows) => sum + rows.length, 0))
        }
      } catch {
        if (!cancelled) setPendingCount(0)
      }
    }

    loadPending()
    window.addEventListener('sync-completed', loadPending)
    const interval = window.setInterval(loadPending, 30000)
    return () => {
      cancelled = true
      window.removeEventListener('sync-completed', loadPending)
      window.clearInterval(interval)
    }
  }, [isSyncing, lastSyncAt])

  const lastSyncLabel = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
    : t('library.sync.never')

  const statusLabel = isOffline
    ? 'Çevrimdışı'
    : error
    ? t('library.sync.error')
    : isSyncing
      ? t('library.sync.syncing')
    : conflicts.length > 0
      ? `${conflicts.length} çakışma`
      : pendingCount > 0
        ? t('library.sync.pending', { count: pendingCount })
        : t('library.sync.synced')

  const Icon = isOffline || error ? CloudOff : Cloud

  return (
    <>
      <button
      type="button"
      onClick={() => setCenterOpen(true)}
      title={`${statusLabel} · ${t('library.sync.last', { time: lastSyncLabel })}`}
      aria-label={statusLabel}
        disabled={isSyncing}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${isOffline || error ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-white/10 bg-white/[0.06] text-[#d6d3d1] hover:bg-white/[0.1]'} ${className}`}
    >
      {isSyncing ? <RefreshCw size={13} className="animate-spin" /> : <Icon size={13} />}
      {!compact && <span className="max-w-[9rem] truncate">{statusLabel}</span>}
      {isSyncing && !compact && <span className="sr-only">{syncPhase}</span>}
      </button>
      <SyncCenterModal open={centerOpen} onClose={() => setCenterOpen(false)} />
    </>
  )
}
