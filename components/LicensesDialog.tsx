import { useState, useEffect } from 'react'
import { X, Search } from 'lucide-react'
import { useI18n } from './I18nProvider'

interface LicenseItem {
  name: string
  version: string
  license: string
}

export default function LicensesDialog({
  libraryTheme,
  onClose,
}: {
  libraryTheme: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const [licenses, setLicenses] = useState<LicenseItem[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const cinematic = libraryTheme !== 'seoul'

  useEffect(() => {
    fetch('/licenses.json')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setLicenses(data)
        }
      })
      .catch((err) => console.error('Failed to load licenses:', err))
      .finally(() => setLoading(false))
  }, [])

  const filtered = licenses.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75 p-3 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border p-5 shadow-[0_24px_90px_rgba(0,0,0,0.65)] ${
          cinematic
            ? 'liquid-glass-panel border-white/10 text-white'
            : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className={`text-lg font-black ${cinematic ? 'text-white' : 'text-[#1C1A17]'}`}>
            Açık Kaynak Lisansları
          </h2>
          <button
            onClick={onClose}
            className={`rounded-lg p-1 transition ${
              cinematic ? 'hover:bg-white/10 text-slate-400 hover:text-white' : 'hover:bg-[#EDE9E1] text-[#7A7060]'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 relative">
          <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
            <Search size={15} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kütüphane ara..."
            className={`w-full rounded-lg border pl-9 pr-3 py-2 text-xs outline-none focus:border-[var(--lib-accent)]/70 ${
              cinematic
                ? 'border-white/10 bg-white/[0.06] text-white placeholder:text-slate-500'
                : 'border-[#DDD9D0] bg-white text-[#1C1A17] placeholder:text-[#9A9080]'
            }`}
          />
        </div>

        <div className="mt-4 flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="py-10 text-center text-xs text-slate-400">Yükleniyor...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">Sonuç bulunamadı.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((item) => (
                <div
                  key={item.name}
                  className={`flex flex-col gap-1 rounded-lg border p-3 text-xs ${
                    cinematic
                      ? 'border-white/5 bg-white/[0.02]'
                      : 'border-[#EDE9E1] bg-[#FAF8F3]'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className={cinematic ? 'text-white' : 'text-[#1C1A17]'}>
                      {item.name}
                    </span>
                    <span className="opacity-70">{item.version}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] opacity-70">
                    <span>Lisans:</span>
                    <span className="rounded bg-[var(--lib-accent)]/10 px-1.5 py-0.5 font-semibold text-[var(--lib-accent)]">
                      {item.license}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
