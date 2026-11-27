'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle, CheckCircle, Scale } from 'lucide-react'

export default function DmcaPage() {
  const router = useRouter()
  
  // Form states
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [infringingUrl, setInfringingUrl] = useState('')
  const [details, setDetails] = useState('')
  const [signature, setSignature] = useState('')
  const [agree, setAgree] = useState(false)

  // Status states
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!agree) {
      setError('Lütfen yasal beyanı ve doğruluğu onaylayın.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/dmca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporterName,
          reporterEmail,
          ownerName,
          infringingUrl,
          details,
          signature,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'İstek gönderilemedi.')
      }

      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#050505] text-[#f8f8f8] font-sans selection:bg-[#e50914] selection:text-white pb-12">
      {/* Background ambient glows */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-1/4 -top-1/4 h-[60vw] w-[60vw] rounded-full bg-red-950/15 blur-[120px] animate-float-slow" />
        <div className="absolute -bottom-1/4 -right-1/4 h-[60vw] w-[60vw] rounded-full bg-violet-950/10 blur-[120px] animate-float-slower" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#101010]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm font-semibold text-[#b3b3b3] hover:bg-white/10 hover:text-white transition-all active:scale-95"
          >
            <ArrowLeft size={16} />
            Geri Dön
          </button>
          <div className="flex items-center gap-2 text-[#e50914]">
            <Scale size={18} />
            <span className="text-sm font-bold tracking-wider uppercase">Dijital Kütüphane</span>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-4 mt-8">
        <div className="liquid-glass-panel border-white/10 p-6 sm:p-8 rounded-2xl bg-[#141414]/70 shadow-[0_32px_90px_rgba(0,0,0,0.65)]">
          {success ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 mb-4">
                <CheckCircle size={32} />
              </div>
              <h1 className="text-2xl font-black text-white mb-3">Telif Bildirimi Alındı</h1>
              <p className="text-sm text-[#b3b3b3] leading-relaxed max-w-md mx-auto">
                Telif hakkı ihlali bildiriminiz başarıyla sistem yöneticisine iletilmiştir. 
                5651 Sayılı Kanun (Yer Sağlayıcı sorumlulukları) ve Uyar-Kaldır prosedürleri uyarınca bildiriminiz incelenerek 24 saat içerisinde gerekli yasal işlemler gerçekleştirilecektir.
              </p>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="mt-6 rounded-xl bg-white/5 hover:bg-white/10 px-5 py-2.5 text-sm font-bold text-white transition active:scale-95"
              >
                Kütüphaneye Dön
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">Telif Hakkı İhlali Bildirim Formu (DMCA)</h1>
              <p className="text-sm text-[#b3b3b3] mb-6">
                Kütüphanemizde yer alan bir belgenin telif hakkınızı ihlal ettiğini düşünüyorsanız, aşağıdaki formu doldurarak yasal uyar-kaldır sürecini başlatabilirsiniz.
              </p>

              {error && (
                <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-950 bg-red-950/20 p-3.5 text-xs text-red-300">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wide text-[#b3b3b3]">Adınız Soyadınız</label>
                    <input
                      required
                      type="text"
                      value={reporterName}
                      onChange={e => setReporterName(e.target.value)}
                      placeholder="Örn. Ahmet Yılmaz"
                      className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white outline-none focus:border-[#e50914]/70 transition-all placeholder:text-slate-500"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold uppercase tracking-wide text-[#b3b3b3]">E-posta Adresiniz</label>
                    <input
                      required
                      type="email"
                      value={reporterEmail}
                      onChange={e => setReporterEmail(e.target.value)}
                      placeholder="Örn. ahmet@email.com"
                      className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white outline-none focus:border-[#e50914]/70 transition-all placeholder:text-slate-500"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-[#b3b3b3]">Telif Sahibi (Kişi / Kurum)</label>
                  <input
                    required
                    type="text"
                    value={ownerName}
                    onChange={e => setOwnerName(e.target.value)}
                    placeholder="Telif hakkı yasal sahibinin adı veya kurum ünvanı"
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white outline-none focus:border-[#e50914]/70 transition-all placeholder:text-slate-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-[#b3b3b3]">İhlal Eden Belge Adı veya Linki</label>
                  <input
                    required
                    type="text"
                    value={infringingUrl}
                    onChange={e => setInfringingUrl(e.target.value)}
                    placeholder="Örn. Kitap Adı veya kütüphane içi URL bağlantısı"
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white outline-none focus:border-[#e50914]/70 transition-all placeholder:text-slate-500"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-[#b3b3b3]">İhlal Açıklaması ve Ayrıntılar</label>
                  <textarea
                    required
                    rows={4}
                    value={details}
                    onChange={e => setDetails(e.target.value)}
                    placeholder="Lütfen hak sahibi olduğunuzu kanıtlayan detayları ve ihlalin yasal gerekçesini kısaca yazın."
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white outline-none focus:border-[#e50914]/70 transition-all placeholder:text-slate-500 resize-none leading-relaxed"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wide text-[#b3b3b3]">Elektronik İmza Beyanı (İsim Soyisim)</label>
                  <input
                    required
                    type="text"
                    value={signature}
                    onChange={e => setSignature(e.target.value)}
                    placeholder="Islak imza yerine geçecek şekilde adınızı soyadınızı yazın"
                    className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-white outline-none focus:border-[#e50914]/70 transition-all placeholder:text-slate-500"
                  />
                </div>

                <div className="flex items-start gap-2.5 pt-2">
                  <input
                    required
                    id="agree-checkbox"
                    type="checkbox"
                    checked={agree}
                    onChange={e => setAgree(e.target.checked)}
                    className="mt-1 accent-[#e50914]"
                  />
                  <label htmlFor="agree-checkbox" className="text-xs text-[#b3b3b3] leading-relaxed cursor-pointer select-none">
                    Bu bildirimdeki tüm iddiaların doğru olduğunu, yasal hak sahibi olduğumu veya hak sahibi adına yasal işlem başlatma yetkim bulunduğunu onaylıyorum. Yanıltıcı bildirimlerin yasal sorumluluk doğurabileceğini beyan ederim.
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl px-4 py-3 text-sm font-bold text-white shadow-lg transition disabled:opacity-40 hover:brightness-110 active:scale-[0.99] liquid-glass-btn-primary mt-4"
                  style={{ '--btn-color': '#e50914', '--btn-glow': 'rgba(229,9,20,0.55)' } as React.CSSProperties}
                >
                  {loading ? 'Gönderiliyor...' : 'Telif İhlal Bildirimini Gönder'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
