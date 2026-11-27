'use client'

import React from 'react'
import { Sparkles, CheckCircle2, Edit3, X, Info } from 'lucide-react'
import SmoothOverlay from './SmoothOverlay'
import { EnrichedBookDetail, UntouchedBookDetail } from '@/app/api/books/enrich-metadata/route'

export interface BookItem {
  id: number
  title: string
  author: string
  filename: string
  [key: string]: unknown
}

export interface EnrichReportData {
  totalScanned: number
  updatedCount: number
  updatedBooks: EnrichedBookDetail[]
  untouchedBooks: UntouchedBookDetail[]
}

interface Props {
  isOpen: boolean
  report: EnrichReportData | null
  libraryTheme: string
  cinematic: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t?: (key: any, params?: any) => string
  onClose: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditBook: (book: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allBooks: any[]
}

export default function MetadataEnrichReportModal({
  isOpen,
  report,
  cinematic,
  onClose,
  onEditBook,
  allBooks,
}: Props) {
  if (!isOpen || !report) return null

  return (
    <SmoothOverlay
      open={isOpen}
      onClose={onClose}
      panelClassName={`max-w-2xl w-full rounded-2xl border p-5 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col ${cinematic ? 'liquid-glass-panel border-white/10 text-white' : 'liquid-glass-panel-seoul border-[#D4CFC5] text-[#1C1A17]'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="text-lg font-black leading-tight">Metaveri İyileştirme Raporu</h3>
            <p className="text-xs opacity-70">
              {report.totalScanned} kitap tarandı • {report.updatedCount} kitap otomatik iyileştirildi
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-xl border border-white/10 p-2 opacity-70 hover:opacity-100 transition-opacity"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body List */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {/* Updated Books Section */}
        {report.updatedBooks.length > 0 && (
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2 flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Otomatik İyileştirilen Kitaplar ({report.updatedBooks.length})
            </h4>

            <div className="space-y-2.5">
              {report.updatedBooks.map(item => (
                <div
                  key={item.id}
                  className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-sm text-emerald-300">{item.newTitle}</p>
                      {item.oldTitle !== item.newTitle && (
                        <p className="text-[11px] opacity-60 line-through">Eski Ad: {item.oldTitle}</p>
                      )}
                      <p className="text-xs opacity-80 mt-0.5">
                        Yazar: <span className="font-semibold">{item.newAuthor || 'Bilinmeyen Yazar'}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {item.isbn && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono">
                          ISBN: {item.isbn}
                        </span>
                      )}
                      {item.language && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase font-bold">
                          {item.language}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-emerald-500/10 pt-1.5 flex flex-wrap gap-1">
                    {item.changes.map((ch, idx) => (
                      <span
                        key={idx}
                        className="rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-[10px] font-medium"
                      >
                        ✓ {ch}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Untouched / Manual Edit Needed Section */}
        {report.untouchedBooks.length > 0 && (
          <div className="pt-2">
            <h4 className="text-xs font-bold uppercase tracking-wider opacity-70 mb-2 flex items-center gap-1.5">
              <Info size={14} /> Elle Düzenlenebilecek Kitaplar ({report.untouchedBooks.length})
            </h4>

            <div className="space-y-2">
              {report.untouchedBooks.map(item => {
                const matchedBook = allBooks.find(b => b.id === item.id)
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-bold truncate">{item.title}</p>
                      <p className="opacity-60 text-[11px] truncate">{item.author || 'Yazar Belirtilmemiş'} • {item.filename}</p>
                    </div>

                    {matchedBook && (
                      <button
                        onClick={() => {
                          onClose()
                          onEditBook(matchedBook)
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/30 transition-colors shrink-0"
                      >
                        <Edit3 size={13} /> Düzenle
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 border-t border-white/10 pt-3 flex justify-end shrink-0">
        <button
          onClick={onClose}
          className="rounded-xl bg-[#e50914] px-5 py-2 text-xs font-bold text-white hover:bg-red-600 transition-colors"
        >
          Tamam
        </button>
      </div>
    </SmoothOverlay>
  )
}
