'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

export default function PrivacyPage() {
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
            <ShieldCheck size={18} />
            <span className="text-sm font-bold tracking-wider uppercase">Dijital Kütüphane</span>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-3xl px-4 mt-8">
        <div className="liquid-glass-panel border-white/10 p-6 sm:p-8 rounded-2xl bg-[#141414]/70 shadow-[0_32px_90px_rgba(0,0,0,0.65)]">
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white mb-2">Gizlilik Politikası</h1>
          <p className="text-xs text-[#8d8986] mb-6">Son güncelleme: 20 Haziran 2026</p>

          <div className="space-y-6 text-[#b3b3b3] text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-bold text-white mb-2">1. Genel Bilgilendirme</h2>
              <p>
                Dijital Kütüphane, kullanıcı gizliliğini en üst düzeyde korumayı ilke edinmiştir. Uygulamamız, kişisel belgelerinizi güvenle saklamanız ve okumanız için tasarlanmıştır. Bu gizlilik politikası, kapalı beta sürümü kapsamında toplanan minimum verileri ve bu verilerin işlenme süreçlerini açıklar.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">2. Toplanan Veriler ve Amacı</h2>
              <p>
                Uygulama kapsamında yalnızca hizmetin sunulması ve kotaların denetlenmesi amacıyla sınırlı veriler toplanır:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                <li><strong>Hesap Bilgileri:</strong> Kayıt sırasında alınan kullanıcı adı, doğrulanmış e-posta adresi ve şifrenizin kriptografik karması (hash).</li>
                <li><strong>Kütüphane Verileri:</strong> Yüklediğiniz kitap dosyaları (PDF/EPUB), kitap başlığı, yazar bilgisi, okuma durumu, en son kaldığınız sayfa, yer imleriniz, altını çizdiğiniz kelimeler ve eklediğiniz notlar.</li>
                <li><strong>Oturum Verileri:</strong> Günlük AI ve TTS limitlerinizin takibi için gerekli olan kullanım sayaçları ve okuma ritmini gösteren anonim süre kayıtları.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">3. Sıfır Bilgi (Zero-Knowledge) ve Şifreleme Tercihi</h2>
              <p>
                Gizlilik mimarimiz, dökümanlarınızın sunucu yöneticileri dahil kimse tarafından okunmamasını hedefleyen local-first prensiplerine dayanır:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                <li><strong>Uçtan Uca Şifreleme (E2EE):</strong> İstemci uygulaması üzerinden (Tauri/Capacitor) PDF dökümanlarınızı kendi belirleyeceğiniz özel bir kasa anahtarıyla yerelde şifreleyerek sunucuya gönderebilirsiniz. Sunucu yöneticisi veya herhangi bir üçüncü taraf, bu şifre çözme anahtarına sahip olamaz.</li>
                <li><strong>Şifre Kurtarma:</strong> Şifreleme anahtarınızı kaybetmeniz durumunda, şifre sıfırlama yalnızca üyelik sırasında size sağlanan 24 kelimelik &quot;Kurtarma Kodu&quot; ile yerelde yapılabilir. Sunucu bu kodu veya şifreyi bilmez; dolayısıyla kurtarma kodu kaybolursa verilerinize erişim kalıcı olarak yitirilir.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">4. Üçüncü Taraf API ve Veri Paylaşımı</h2>
              <p>
                Uygulamadaki gelişmiş özellikleri sunmak amacıyla seçkin bulut sağlayıcıları kullanılır:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                <li><strong>Yapay Zeka (Google Gemini):</strong> Sayfa içeriği hakkında soru sorduğunuzda veya metin açıkladığınızda, yalnızca ilgili sayfanın metin içeriği Google Gemini API sunucularına gönderilir. Bu veriler reklam amaçlı kullanılmaz veya yapay zeka modellerini eğitmek amacıyla kaydedilmez.</li>
                <li><strong>Seslendirme (Google Cloud TTS):</strong> Seçilen metni seslendirmek istediğinizde, metin içeriği ses sentezi amacıyla resmi Google Cloud Text-to-Speech REST API uç noktasına iletilir ve işleme sonrasında geçici olarak bellekte tutularak istemciye dinletilir.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">5. GDPR ve KVKK Kapsamındaki Haklarınız</h2>
              <p>
                Kullanıcılar yasal mevzuat kapsamındaki haklarını uygulama üzerinden doğrudan kullanabilirler:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 pl-2">
                <li><strong>Veri Taşınabilirliği (Export):</strong> Ayarlar sayfasındaki &quot;Verileri Dışa Aktar&quot; düğmesiyle kütüphanenizi, notlarınızı, yer imlerinizi ve kelime listenizi içeren şifreli bir ZIP dosyasını dilediğiniz zaman indirebilirsiniz.</li>
                <li><strong>Unutulma Hakkı (Silme):</strong> Hesabınızı sildiğinizde, verileriniz önce 7 gün boyunca pasifleştirilir. 7 günün sonunda kitap dökümanları ve veritabanı kayıtları sunucudan kalıcı olarak kazınır.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-white mb-2">6. İletişim ve Hak İhlalleri</h2>
              <p>
                Gizlilik politikamız veya verilerinizle ilgili sorularınız için bizimle doğrudan iletişime geçebilirsiniz. Telif hakkı bildirimi veya yasal talepleriniz için lütfen Telif Hakkı (DMCA) Bildirim Sayfasını kullanın.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
