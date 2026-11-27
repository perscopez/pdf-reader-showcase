'use client'

import { useState, useEffect, useCallback } from 'react'
import { TabletSmartphone, LogOut, X, ShieldCheck, Clock } from 'lucide-react'
import SmoothOverlay from './SmoothOverlay'

export interface DeviceInfo {
  id: number
  device_id: string
  device_name: string
  last_seen_at: string
  created_at: string
}

interface DeviceManagementModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function DeviceManagementModal({ isOpen, onClose }: DeviceManagementModalProps) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadDevices = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sync/devices')
      if (res.ok) {
        const data = await res.json()
        setDevices(data.devices || [])
      }
    } catch {
      setDevices([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDevices()
  }, [isOpen, loadDevices])

  const handleSignOutRemote = async (deviceId: string) => {
    try {
      await fetch(`/api/sync/devices?device_id=${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
      setDevices(prev => prev.filter(d => d.device_id !== deviceId))
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <SmoothOverlay open={isOpen} onClose={onClose} zIndex={50}>
      <div className="relative w-full max-w-xl bg-[#141414] border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-6 text-slate-100">
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <TabletSmartphone className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-bold text-white">Bağlı Cihazlar & Senkronizasyon Geçmişi</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-4 flex items-center gap-1">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Hesabınıza bağlı cihazlar ve en son senkronizasyon zamanları.
        </p>

        {loading ? (
          <p className="py-12 text-center text-sm text-slate-400">Cihazlar yükleniyor...</p>
        ) : devices.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            Kayıtlı aktif cihaz bulunmuyor.
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
            {devices.map(device => (
              <div
                key={device.id}
                className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.04] border border-white/10"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <TabletSmartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{device.device_name || 'Bilinmeyen Cihaz'}</p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" /> Son görülme: {new Date(device.last_seen_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handleSignOutRemote(device.device_id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 text-xs font-semibold border border-red-500/30 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" /> Oturumu Kapat
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </SmoothOverlay>
  )
}
