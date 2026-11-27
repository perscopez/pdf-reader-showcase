'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, Scale } from 'lucide-react'

export default function TermsPage() {
  const router = useRouter()

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

      <div className="relative z-10 mx-auto max-w-3xl px-4 mt-8">
        <div className="liquid-glass-panel border-white/10 p-6 sm:p-8 rounded-2xl bg-[#141414]/70 shadow-[0_32px_90px_rgba(0,0,0,0.65)]">
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white mb-2">Kullanım Koşulları</h1>
          <p className="text-xs text-[#8d8986] mb-6">Son güncelleme: 20 Haziran 2026</p>

          <div className="space-y-6 text-[#b3b3b3] text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-bold text-white mb-2">1. Hizmet ve Kapalı Beta Şartları</h2>
              <p>
                Dijital Kütüphane (bundan böyle &quot;Uygulama&quot; veya &quot;Hizmet&quot; olarak anılacaktır), kişisel belgelerinizi (PDF/EPUB) saklama, okuma ve RSVP, yapay zeka yardımıyla soru sorma, seslendirme (TTS) araçlarını kullanma imkanı sunan kişisel bir okuma alanıdır. Hizmet, davet koduna dayalı kapalı bir beta sürümü olarak işletilmektedir. Üyelik ve davet sistemi yönetici inisiyatifindedir.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">2. Kullanıcı Sorumluluğu ve Telif Hakları</h2>
              <p>
                Uygulama, kamuya açık bir dosya paylaşım, indirme veya korsan yayıncılık platformu değildir.
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                <li>Yüklediğiniz tüm PDF, EPUB ve dökümanların telif hakları ve yasal izinleri tamamen sizin (kullanıcının) sorumluluğundadır.</li>
                <li>Uygulamaya yalnızca yasal olarak hak sahibi olduğunuz, lisansına sahip olduğunuz, açık kaynaklı veya kamu malı niteliğindeki eserleri yüklemeniz gerekmektedir.</li>
                <li>Sunucu, yüklenen dökümanları varsayılan olarak özel tutar; herkese açık arama veya indeksleme mekanizması sunmaz.</li>
                <li>Telif hakkı ihlali iddialarında, ihlal ettiği bildirilen içerikler yasal mevzuat uyarınca derhal kaldırılır (Bkz. Uyar-Kaldır Bildirimi). İhlalleri alışkanlık haline getiren kullanıcıların hesapları sonlandırılır.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">3. Depolama Limitleri ve Kullanım Kotaları</h2>
              <p>
                Hizmet kalitesini ve operasyonel maliyetleri korumak amacıyla kapalı beta sürecinde aşağıdaki limitler uygulanır:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                <li><strong>Dosya Boyutu Limiti:</strong> Tek seferde yüklenebilecek maksimum dosya boyutu 100 MB&apos;tır.</li>
                <li><strong>Depolama Limiti:</strong> Kullanıcı başına toplam depolama kotası 2 GB ile sınırlıdır.</li>
                <li><strong>Yapay Zeka (AI) Kotası:</strong> Kullanıcı başına günlük maksimum 50 yapay zeka soru-cevap isteği yapılabilir.</li>
                <li><strong>Seslendirme (TTS) Kotası:</strong> Kullanıcı başına günlük maksimum 30 dakika ses sentezi süresi tanımlanmıştır.</li>
              </ul>
              <p className="mt-2">
                Limitlerin aşılması durumunda hizmet otomatik olarak sınırlandırılır ve ek kullanım hakkı tanımlanmaz.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">4. Hesap Silme ve Veri Saklama Politikası</h2>
              <p>
                Kullanıcılar hesaplarını diledikleri zaman profil ayarları bölümünden silme talebiyle işleme alabilirler:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                <li>Hesap silme işlemi onaylandıktan sonra hesaba 7 günlük bir &quot;kurtarma&quot; (geri alma) süresi tanınır. Bu süre boyunca kullanıcı tekrar giriş yaparak hesabı eski haline getirebilir.</li>
                <li>7 günlük geri alma süresinin sonunda hesap kalıcı olarak kapatılır.</li>
                <li>Kalıcı kapatmayı takiben veritabanı kayıtlarınız ve sunucuda saklanan tüm kitap dosyalarınız sistemden geri döndürülemez şekilde kalıcı olarak temizlenir.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">5. Hizmet Kesintileri ve Sorumluluk Sınırı</h2>
              <p>
                Dijital Kütüphane, &quot;olduğu gibi&quot; (as-is) esasıyla sunulan deneysel bir beta hizmetidir. Sunucu arızaları, veri kayıpları veya bağlantı kesintilerinden ötürü doğabilecek doğrudan veya dolaylı zararlardan sistem yönetimi sorumlu tutulamaz. Önemli belgelerinizin yerel yedeklerini her zaman saklamanız önerilir.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">6. Değişiklikler</h2>
              <p>
                Uygulama yönetimi, kapalı beta limitlerini, kotaları ve bu kullanım koşullarını önceden bildirim yapmaksızın güncelleme hakkını saklı tutar.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
