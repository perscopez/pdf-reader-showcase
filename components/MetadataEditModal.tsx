'use client'

import { useState } from 'react'
import { Star, X, Upload, Sparkles, Globe, BookOpen, Layers, Download } from 'lucide-react'
import SmoothOverlay from './SmoothOverlay'
import { extractMetadataFromText } from '@/lib/metadataExtractor'

export interface BookMetadataForm {
  title: string
  author: string
  isbn: string
  doi: string
  publication_year?: number
  publisher: string
  publication: string
  volume: string
  issue: string
  pages: string
  edition: string
  language: string
  total_pages: number
  rating: number
  description: string
  status: string
  rtl: number
  thumbnail?: string
}

interface MetadataEditModalProps {
  initialData: BookMetadataForm & { id: number }
  categories: Array<{ id: number; name: string; color: string }>
  onSave: (data: Partial<BookMetadataForm>) => Promise<void>
  onClose: () => void
}

const STATUSES = [
  { value: 'inbox', label: 'Inbox (Gelen Kutusu)' },
  { value: 'planned', label: 'Planlanan (Okunacak)' },
  { value: 'reading', label: 'Okunuyor' },
  { value: 'paused', label: 'Duraklatıldı' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'reference', label: 'Referans / Kaynak' },
  { value: 'archived', label: 'Arşivlendi' },
]

export default function MetadataEditModal({ initialData, onSave, onClose }: MetadataEditModalProps) {
  const [title, setTitle] = useState(initialData.title || '')
  const [author, setAuthor] = useState(initialData.author || '')
  const [isbn, setIsbn] = useState(initialData.isbn || '')
  const [doi, setDoi] = useState(initialData.doi || '')
  const [publicationYear, setPublicationYear] = useState(initialData.publication_year || '')
  const [publisher, setPublisher] = useState(initialData.publisher || '')
  const [publication, setPublication] = useState(initialData.publication || '')
  const [volume, setVolume] = useState(initialData.volume || '')
  const [issue, setIssue] = useState(initialData.issue || '')
  const [pages, setPages] = useState(initialData.pages || '')
  const [edition, setEdition] = useState(initialData.edition || '')
  const [language, setLanguage] = useState(initialData.language || 'tr')
  const [totalPages, setTotalPages] = useState(initialData.total_pages || 0)
  const [rating, setRating] = useState(initialData.rating || 0)
  const [description, setDescription] = useState(initialData.description || '')
  const [status, setStatus] = useState(initialData.status || 'reading')
  const [rtl, setRtl] = useState(initialData.rtl || 0)
  const [thumbnail, setThumbnail] = useState(initialData.thumbnail || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        author: author.trim(),
        isbn: isbn.trim(),
        doi: doi.trim(),
        publication_year: Number(publicationYear) || undefined,
        publisher: publisher.trim(), publication: publication.trim(), volume: volume.trim(), issue: issue.trim(), pages: pages.trim(), edition: edition.trim(),
        language: language.trim(),
        total_pages: Number(totalPages) || 0,
        rating,
        description: description.trim(),
        status,
        rtl,
        thumbnail,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleAutoExtract = () => {
    const extracted = extractMetadataFromText(`${title} ${author} ${description} ${doi} ${isbn}`)
    if (extracted.isbn) setIsbn(extracted.isbn)
    if (extracted.doi) setDoi(extracted.doi)
    if (extracted.year) setPublicationYear(extracted.year)
    if (extracted.title && !title.trim()) setTitle(extracted.title)
    if (extracted.author && !author.trim()) setAuthor(extracted.author)
    if (extracted.language) setLanguage(extracted.language)
  }

  const handleThumbnailFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setThumbnail(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const citationTextFields: Array<[string, string, (value: string) => void, string]> = [
    ['DOI', doi, setDoi, '10.1000/xyz123'],
    ['Yayıncı', publisher, setPublisher, 'Yayıncı adı'],
    ['Yayın / Dergi', publication, setPublication, 'Yayın adı'],
    ['Cilt', volume, setVolume, '1'],
    ['Sayı', issue, setIssue, '2'],
    ['Sayfalar', pages, setPages, '10-25'],
    ['Baskı', edition, setEdition, '2'],
  ]

  return (
    <SmoothOverlay open={true} onClose={onClose} zIndex={50}>
      <div className="relative w-full max-w-xl bg-[#141414] border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-6 text-slate-100">
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#e50914]" />
            <h3 className="text-lg font-bold text-white">Kitap Metaverisini Düzenle</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* Cover & Rating */}
          <div className="flex gap-4 items-start">
            <div className="w-24 h-32 bg-black/40 rounded-xl border border-white/10 overflow-hidden flex-shrink-0 relative group">
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnail} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-xs text-slate-500 p-2 text-center">
                  <Upload className="w-5 h-5 mb-1 opacity-50" />
                  Kapak Ekle
                </div>
              )}
              <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-xs text-white cursor-pointer transition-opacity">
                Değiştir
                <input type="file" accept="image/*" onChange={handleThumbnailFile} className="hidden" />
              </label>
            </div>

            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Kitap Başlığı</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm focus:outline-none focus:border-[#e50914]"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Yazar</label>
                <input
                  type="text"
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm focus:outline-none focus:border-[#e50914]"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Derecelendirme (Rating)</label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star === rating ? 0 : star)}
                      className="p-1 text-slate-400 hover:text-amber-400 transition-colors"
                    >
                      <Star
                        className={`w-5 h-5 ${star <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`}
                      />
                    </button>
                  ))}
                  <span className="text-xs text-slate-400 ml-2">{rating ? `${rating}/5 Yıldız` : 'Puan Verilmedi'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ISBN & Language */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-400">ISBN</label>
                <button
                  type="button"
                  onClick={handleAutoExtract}
                  className="text-[10px] text-[#e50914] hover:underline flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" /> Tespit Et
                </button>
              </div>
              <input
                type="text"
                value={isbn}
                onChange={e => setIsbn(e.target.value)}
                placeholder="Örn. 9789750800000"
                className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm focus:outline-none focus:border-[#e50914]"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
                <Globe className="w-3.5 h-3.5 text-slate-400" /> Doküman Dili
              </label>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#202020] border border-white/10 text-white text-sm focus:outline-none focus:border-[#e50914]"
              >
                <option value="tr">Türkçe (TR)</option>
                <option value="en">English (EN)</option>
                <option value="de">Deutsch (DE)</option>
                <option value="fr">Français (FR)</option>
                <option value="es">Español (ES)</option>
                <option value="other">Diğer / Bilinmiyor</option>
              </select>
            </div>
          </div>

          {/* Status & Total Pages */}
          <section className="rounded-2xl border border-[#e50914]/25 bg-[#e50914]/[0.06] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div><h4 className="text-sm font-semibold text-white">Kaynakça bilgileri</h4><p className="text-[11px] text-slate-400">DOI, ISBN ve yayın alanları dışa aktarımlarda kullanılır.</p></div>
              <button type="button" onClick={handleAutoExtract} className="inline-flex items-center gap-1 rounded-lg border border-[#e50914]/40 px-2.5 py-1.5 text-[11px] text-red-200 hover:bg-[#e50914]/15"><Sparkles className="h-3 w-3" /> Otomatik doldur</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {citationTextFields.map(([label, value, setter, placeholder]) => <label key={label} className="text-xs text-slate-400">{label}<input value={value} onChange={e => setter(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white focus:border-[#e50914] focus:outline-none" /></label>)}
              <label className="text-xs text-slate-400">Yıl<input type="number" min="1000" max="9999" value={publicationYear} onChange={e => setPublicationYear(e.target.value ? Number(e.target.value) : '')} placeholder="2026" className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white focus:border-[#e50914] focus:outline-none" /></label>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3"><span className="mr-auto self-center text-[11px] uppercase tracking-wider text-slate-500">Dışa aktar</span>{[['bibtex', 'BibTeX', 'bib'], ['ris', 'RIS', 'ris'], ['csl-json', 'CSL-JSON', 'json']].map(([format, label]) => <a key={format} href={`/api/books/${initialData.id}/citation?format=${format}`} download={`citation-${initialData.id}.${label === 'CSL-JSON' ? 'json' : label.toLowerCase()}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-xs text-slate-200 hover:border-[#e50914] hover:text-white"><Download className="h-3 w-3" />{label}</a>)}</div>
          </section>

          {/* Status & Total Pages */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-slate-400" /> Okuma Durumu
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#202020] border border-white/10 text-white text-sm focus:outline-none focus:border-[#e50914]"
              >
                {STATUSES.map(s => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Toplam Sayfa Sayısı</label>
              <input
                type="number"
                min="0"
                value={totalPages}
                onChange={e => setTotalPages(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm focus:outline-none focus:border-[#e50914]"
              />
            </div>
          </div>

          {/* RTL Reading Direction Checkbox */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="rtl-checkbox"
              checked={Boolean(rtl)}
              onChange={e => setRtl(e.target.checked ? 1 : 0)}
              className="w-4 h-4 rounded accent-[#e50914]"
            />
            <label htmlFor="rtl-checkbox" className="text-xs text-slate-300 cursor-pointer">
              Sağdan Sola (RTL) Okuma Düzeni (Arapça, İbranice vb. kitaplar için)
            </label>
          </div>

          {/* Personal Description / Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Kişisel İnceleme ve Notlar</label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Bu kitap hakkında kişisel notlarınız, özetiniz veya değerlendirmeniz..."
              className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-white text-sm focus:outline-none focus:border-[#e50914] resize-none"
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-[#e50914] hover:bg-[#e50914]/90 text-white shadow-lg transition-all disabled:opacity-50"
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </SmoothOverlay>
  )
}
