'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Cloud, RefreshCw, X } from 'lucide-react'
import SmoothOverlay from './SmoothOverlay'
import { getDirtyRecords, initDb } from '@/lib/indexedDb'
import { useSync, type SyncConflict } from './SyncProvider'

type PendingItem = {
  key: string
  storeName: string
  status: string
  title: string
  updatedAt: string
}

const STORE_LABELS: Record<string, string> = {
  books: 'Kitap',
  annotations: 'Not',
  bookmarks: 'Yer imi',
  word_library: 'Kelime',
  reading_sessions: 'Okuma oturumu',
}

function formatRecordTitle(storeName: string, record: Record<string, unknown>) {
  const value = record.title || record.word || record.note || record.label
  return typeof value === 'string' && value.trim() ? value.trim() : `${STORE_LABELS[storeName] || 'Kayıt'} #${record.server_id || record.local_id || '?'}`
}

function conflictTitle(conflict: SyncConflict) {
  return formatRecordTitle(conflict.storeName, conflict.localRecord)
}

export default function SyncCenterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { conflicts, isSyncing, syncPhase, error, triggerSync, resolveConflict } = useSync()
  const [pending, setPending] = useState<PendingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busyConflict, setBusyConflict] = useState<string | null>(null)

  const loadPending = useCallback(async () => {
    setLoading(true)
    try {
      await initDb()
      const stores = Object.keys(STORE_LABELS)
      const rows = await Promise.all(stores.map(async storeName => {
        const records = await getDirtyRecords(storeName)
        return records.map(record => ({
          key: `${storeName}:${record.local_id}`,
          storeName,
          status: record.local_status,
          title: formatRecordTitle(storeName, record),
          updatedAt: record.updated_at,
        }))
      }))
      setPending(rows.flat())
    } catch {
      setPending([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => { void loadPending() }, 0)
    return () => window.clearTimeout(id)
  }, [open, loadPending, conflicts, isSyncing])

  async function handleResolve(id: string, resolution: 'local' | 'server') {
    setBusyConflict(id)
    try {
      await resolveConflict(id, resolution)
      await loadPending()
    } finally {
      setBusyConflict(null)
    }
  }

  return (
    <SmoothOverlay open={open} onClose={onClose} zIndex={500}>
      <section className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#121212] p-5 text-white shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sync-center-title">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><Cloud size={19} /></span>
            <div>
              <h2 id="sync-center-title" className="text-base font-bold">Senkronizasyon Merkezi</h2>
              <p className="mt-1 text-xs text-white/55">Bekleyen kayıtları ve çakışmaları buradan kontrol edebilirsin.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Kapat"><X size={17} /></button>
        </header>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs">
          <span className={error ? 'text-red-300' : 'text-white/70'}>{error || (isSyncing ? `Senkronize ediliyor (${syncPhase})…` : `${pending.length} bekleyen kayıt · ${conflicts.length} çakışma`)}</span>
          <button type="button" onClick={() => void triggerSync()} disabled={isSyncing} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 font-semibold text-cyan-200 disabled:opacity-50">
            <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} /> Şimdi senkronize et
          </button>
        </div>

        {conflicts.length > 0 && (
          <div className="mt-4 space-y-2">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-200"><AlertTriangle size={14} /> Çakışmalar</h3>
            {conflicts.map(conflict => (
              <div key={conflict.id} className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3">
                <p className="truncate text-sm font-semibold">{conflictTitle(conflict)}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/55">Bu kayıt başka bir cihazda da değiştirildi. Hangi sürüm korunmalı?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busyConflict === conflict.id} onClick={() => void handleResolve(conflict.id, 'local')} className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold hover:bg-white/10 disabled:opacity-50">Bu cihazı koru</button>
                  <button type="button" disabled={busyConflict === conflict.id} onClick={() => void handleResolve(conflict.id, 'server')} className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-300/20 disabled:opacity-50">Sunucuyu kullan</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-white/50">Bekleyen kayıtlar</h3>
          {loading ? <p className="py-8 text-center text-xs text-white/45">Kuyruk okunuyor…</p> : pending.length === 0 ? <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-xs text-white/45">Bekleyen kayıt yok.</p> : (
            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {pending.map(item => (
                <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                  <div className="min-w-0"><p className="truncate font-semibold">{item.title}</p><p className="text-[10px] text-white/45">{STORE_LABELS[item.storeName] || item.storeName} · {item.status}</p></div>
                  <time className="shrink-0 text-[10px] text-white/40">{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''}</time>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </SmoothOverlay>
  )
}
