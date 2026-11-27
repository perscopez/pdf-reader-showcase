'use client'

import Link from 'next/link'
import { BookmarkPlus, FileText, ExternalLink } from 'lucide-react'
import type { Citation } from '@/lib/citedMultiDocumentAi'

export default function CitedAnswer({
  answer,
  citations,
  sourceNotFound,
  citationFallback,
  savingNote,
  savedMessage,
  onSaveNote,
  onSaveDraft,
}: {
  answer: string
  citations: Citation[]
  sourceNotFound: boolean
  citationFallback: boolean
  savingNote?: boolean
  savedMessage?: string
  onSaveNote?: () => void
  onSaveDraft?: () => void
}) {
  return (
    <section className="space-y-4" aria-live="polite">
      {sourceNotFound && (
        <div role="status" className="rounded-xl border border-amber-400/35 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-100">
          Kaynak bulunamadı. Bu yanıt seçilen kitapların doğrulanabilir sayfa metniyle desteklenmiyor.
        </div>
      )}
      {citationFallback && !sourceNotFound && (
        <div role="status" className="rounded-xl border border-[var(--lib-border)] bg-[var(--lib-accent-surface)] px-3 py-2.5 text-sm opacity-85">
          Yanıt üretildi. Model satır içi kaynak işareti eklemediği için eşleşen sayfalar aşağıda destekleyici kaynak olarak gösteriliyor.
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm leading-7">{answer}</p>
      {citations.length > 0 && (
        <div className="border-t border-[var(--lib-border)] pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wider opacity-70">
            <ExternalLink size={13} /> {citationFallback ? 'İlgili kaynaklar' : 'Kaynaklar'}
          </div>
          <div className="flex flex-wrap gap-2">
            {citations.map(citation => (
              <Link
                key={`${citation.bookId}-${citation.page}`}
                href={citation.href}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--lib-accent)]/40 bg-[var(--lib-accent-surface)] px-3 py-1.5 text-xs font-bold transition hover:border-[var(--lib-accent)]"
                title={citation.excerpt}
              >
                <span className="truncate">{citation.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {(onSaveNote || onSaveDraft) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--lib-border)] pt-4">
          {onSaveNote && (
            <button type="button" onClick={onSaveNote} disabled={savingNote || citations.length === 0} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--lib-accent)] px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
              <BookmarkPlus size={14} /> {savingNote ? 'Kaydediliyor…' : 'Kitap notu olarak kaydet'}
            </button>
          )}
          {onSaveDraft && (
            <button type="button" onClick={onSaveDraft} className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--lib-border)] px-3 py-2 text-xs font-bold">
              <FileText size={14} /> Araştırma taslağına kaydet
            </button>
          )}
          {savedMessage && <span role="status" className="text-xs font-semibold text-emerald-300">{savedMessage}</span>}
        </div>
      )}
    </section>
  )
}
