'use client'

import { useEffect, useState } from 'react'
import { Send, Check, Loader2, BookOpen, AlertCircle, FileText } from 'lucide-react'

type Recipient = {
  id: number
  username: string
  role: string
}

interface BookTransferModalProps {
  isOpen: boolean
  onClose: () => void
  bookIds: number[]
  bookTitles?: string[]
  onSuccess?: (message: string) => void
  onError?: (error: string) => void
}

export default function BookTransferModal({
  isOpen,
  onClose,
  bookIds,
  bookTitles = [],
  onSuccess,
  onError,
}: BookTransferModalProps) {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null)
  const [includeAnnotations, setIncludeAnnotations] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchingRecipients, setFetchingRecipients] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!isOpen) return
    let active = true
    fetch('/api/books/transfer')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!active) return
        if (data?.success && Array.isArray(data.recipients)) {
          setRecipients(data.recipients)
          if (data.recipients.length > 0) {
            setSelectedTargetId(data.recipients[0].id)
          }
        } else {
          setErrorMsg('Kullanıcı listesi alınamadı.')
        }
      })
      .catch(() => {
        if (active) setErrorMsg('Kullanıcı listesi alınamadı.')
      })
      .finally(() => {
        if (active) setFetchingRecipients(false)
      })

    return () => {
      active = false
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleTransfer = async () => {
    if (!selectedTargetId) {
      setErrorMsg('Lütfen hedef kullanıcı seçin.')
      return
    }
    setLoading(true)
    setErrorMsg('')

    try {
      const res = await fetch('/api/books/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookIds,
          targetUserId: selectedTargetId,
          includeAnnotations,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        onSuccess?.(data.message || 'Kitaplar başarıyla transfer edildi.')
        onClose()
      } else {
        const err = data.error || 'Transfer gerçekleştirilemedi.'
        setErrorMsg(err)
        onError?.(err)
      }
    } catch {
      const err = 'Sunucu bağlantı hatası.'
      setErrorMsg(err)
      onError?.(err)
    } finally {
      setLoading(false)
    }
  }

  const selectedTargetUser = recipients.find(r => r.id === selectedTargetId)

  return (
    <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#121212] p-6 shadow-2xl text-white">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-400">
              <Send size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Kitap Transfer Et / Gönder</h3>
              <p className="text-[11px] text-neutral-400">Seçilen {bookIds.length} kitabı başka bir kullanıcıya aktarın</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="mt-4 space-y-4">
          {/* Selected Books Summary */}
          {bookTitles.length > 0 && (
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs">
              <span className="font-semibold text-neutral-400 block mb-1">Seçili Kitaplar:</span>
              <ul className="space-y-1 max-h-24 overflow-y-auto text-neutral-200 font-medium">
                {bookTitles.map((t, idx) => (
                  <li key={idx} className="truncate flex items-center gap-1.5">
                    <BookOpen size={12} className="text-amber-400 shrink-0" />
                    <span className="truncate">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Target User Selection */}
          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
              Hedef Kullanıcı Seçin
            </label>
            {fetchingRecipients ? (
              <div className="flex items-center justify-center p-4 rounded-xl border border-white/10 bg-white/5 text-xs text-neutral-400">
                <Loader2 size={16} className="animate-spin mr-2 text-amber-400" />
                Kullanıcılar yükleniyor...
              </div>
            ) : recipients.length === 0 ? (
              <div className="p-3 text-xs text-neutral-400 bg-white/5 rounded-xl border border-white/10">
                Transfer edilebilecek başka kullanıcı bulunamadı.
              </div>
            ) : (
              <div className="grid gap-2 max-h-40 overflow-y-auto pr-1">
                {recipients.map(r => {
                  const isSelected = selectedTargetId === r.id
                  return (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => setSelectedTargetId(r.id)}
                      className={`flex items-center justify-between rounded-xl border p-2.5 text-xs transition-all ${
                        isSelected
                          ? 'border-amber-400/50 bg-amber-400/10 text-white font-semibold'
                          : 'border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold uppercase">
                          {r.username.slice(0, 1)}
                        </div>
                        <span>{r.username}</span>
                        {r.role === 'admin' && (
                          <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
                            ADMIN
                          </span>
                        )}
                      </div>
                      {isSelected && <Check size={16} className="text-amber-400" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Annotations Option */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAnnotations}
                onChange={e => setIncludeAnnotations(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black/40 text-amber-500 focus:ring-amber-400"
              />
              <div>
                <span className="font-bold text-xs text-white flex items-center gap-1.5">
                  <FileText size={14} className="text-emerald-400" />
                  Notları ve Vurguları da Gönder (Anotasyonlu)
                </span>
                <p className="mt-0.5 text-[11px] text-neutral-400 leading-snug">
                  İşaretlenirse, kitaplarınızdaki tüm vurgular, alt çizmeler ve notlar hedef kullanıcının kütüphanesine kopyalanır. İşaretlenmezse kitap temiz (notlarsız) olarak iletilir.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-white/10 transition-colors"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={loading || !selectedTargetId || recipients.length === 0}
            className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/20 px-5 py-2 text-xs font-bold text-amber-400 hover:bg-amber-400/30 transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Aktarılıyor...
              </>
            ) : (
              <>
                <Send size={14} />
                {selectedTargetUser ? `${selectedTargetUser.username} Hesabına Aktar` : 'Aktar'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
