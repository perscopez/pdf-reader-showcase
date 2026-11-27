'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Trash2, RotateCcw, X, FileText, Bookmark, BookOpen, RefreshCw } from 'lucide-react'
import SmoothOverlay from './SmoothOverlay'

export interface TrashItem {
  id: number
  item_type: 'book' | 'annotation' | 'bookmark'
  item_id: number
  data_json: string
  deleted_at: string
  expires_at?: string
}

interface TrashBinModalProps {
  isOpen: boolean
  onClose: () => void
  onRestored?: () => void
}

export default function TrashBinModal({ isOpen, onClose, onRestored }: TrashBinModalProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const loadTrash = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/trash')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Çöp kutusu yüklenemedi.')
      setItems(data.items || [])
    } catch {
      setItems([])
      setError('Çöp kutusu yüklenemedi. Bağlantıyı kontrol edip yeniden dene.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTrash()
  }, [isOpen, loadTrash])

  const handleRestore = async (id: number) => {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`/api/trash/${id}/restore`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Geri yükleme başarısız.')
      setItems(prev => prev.filter(item => item.id !== id))
      onRestored?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Geri yükleme başarısız.')
    } finally {
      setBusyId(null)
    }
  }

  const handlePermanentDelete = async (id: number) => {
    if (!window.confirm('Bu kitap ve saklanan dosyası kalıcı olarak silinecek. Bu işlem geri alınamaz.')) return
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`/api/trash/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Kalıcı silme başarısız.')
      setItems(prev => prev.filter(item => item.id !== id))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Kalıcı silme başarısız.')
    } finally {
      setBusyId(null)
    }
  }

  const getItemTitle = (item: TrashItem) => {
    try {
      const parsed = JSON.parse(item.data_json)
      return parsed.book?.title || parsed.title || parsed.note || parsed.word || `Öğe #${item.item_id}`
    } catch {
      return `Öğe #${item.item_id}`
    }
  }

  return (
    <SmoothOverlay open={isOpen} onClose={onClose} zIndex={50} labelledBy="trash-bin-title">
      <div className="relative w-full max-w-xl bg-[#141414] border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-6 text-slate-100" aria-busy={loading}>
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-500" />
            <h3 id="trash-bin-title" className="text-lg font-bold text-white">Çöp Kutusu & Geri Yükleme</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Çöp kutusunu kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          Silinen kitaplar 30 gün boyunca dosyaları ve notlarıyla saklanır. Süre dolmadan geri yükleyebilir veya kalıcı silebilirsin.
        </p>

        {error && (
          <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-200">
            <span className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</span>
            <button type="button" onClick={loadTrash} className="flex items-center gap-1 rounded-lg border border-red-300/20 px-2 py-1 font-semibold hover:bg-white/10"><RefreshCw className="h-3.5 w-3.5" />Yeniden dene</button>
          </div>
        )}

        {loading ? (
          <p className="py-12 text-center text-sm text-slate-400">Yükleniyor...</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            Çöp kutusu boş. Silinen öge bulunmuyor.
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {items.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/10 hover:border-white/20 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {item.item_type === 'book' ? (
                    <BookOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  ) : item.item_type === 'bookmark' ? (
                    <Bookmark className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-red-400 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate text-white">{getItemTitle(item)}</p>
                    <p className="text-[11px] text-slate-400">
                      {item.item_type.toUpperCase()} • Silinme: {new Date(item.deleted_at).toLocaleDateString()}{item.expires_at ? ` • Kalıcı silinme: ${new Date(item.expires_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => handleRestore(item.id)}
                    disabled={busyId !== null}
                    className="flex min-h-9 items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${busyId === item.id ? 'animate-spin' : ''}`} /> {busyId === item.id ? 'İşleniyor…' : 'Geri Yükle'}
                  </button>
                  <button
                    onClick={() => handlePermanentDelete(item.id)}
                    disabled={busyId !== null}
                    aria-label={`${getItemTitle(item)} kalıcı sil`}
                    title="Kalıcı sil"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/20 text-red-300 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SmoothOverlay>
  )
}
