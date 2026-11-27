'use client'

import type { PageTextModel } from '@/lib/pdfTextModel'

type ThemeStyle = { panel: string; subtle: string; text: string; button: string; active: string; accent?: string }

export function ReaderQualityCenter({
  model,
  recoveryBusy,
  encrypted,
  text,
  themeStyle,
  labels,
  onRebuild,
  onCopy,
}: {
  model: PageTextModel | null
  recoveryBusy: boolean
  encrypted: boolean
  text: string
  themeStyle: ThemeStyle
  labels: { title: string; native: string; ocr: string; quality: string; revision: string; engine: string; rebuild: string; encrypted: string; unavailable: string; recovery: string; copyCleanText: string }
  onRebuild: () => void
  onCopy: () => void
}) {
  const quality = model ? Math.round(Math.max(0, Math.min(1, model.quality)) * 100) : 0
  const sourceLabel = model?.source === 'ocr' ? labels.ocr : model?.source === 'native' ? labels.native : labels.unavailable
  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-4 ${themeStyle.button}`}>
        <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${themeStyle.subtle}`}>{labels.title}</p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className={`text-3xl font-black ${themeStyle.text}`}>{model ? `${quality}%` : '—'}</p>
            <p className={`mt-1 text-xs ${themeStyle.subtle}`}>{sourceLabel}</p>
          </div>
          <div className="h-12 w-12 rounded-full border-4" style={{ borderColor: `${themeStyle.accent || '#e50914'}55`, borderTopColor: themeStyle.accent || '#e50914' }} aria-label={`${labels.quality}: ${quality}%`} />
        </div>
      </div>
      {encrypted && <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100">{labels.encrypted}</div>}
      {model ? (
        <dl className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
          <div className="flex items-center justify-between gap-3"><dt className={themeStyle.subtle}>{labels.revision}</dt><dd className="max-w-[12rem] truncate text-right">{model.provenance.documentFingerprint || '—'}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className={themeStyle.subtle}>{labels.engine}</dt><dd className="max-w-[12rem] truncate text-right">{model.provenance.engine} {model.provenance.engineVersion}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className={themeStyle.subtle}>{labels.quality}</dt><dd className="text-right">{quality}% · {model.words.length} words</dd></div>
        </dl>
      ) : <p className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs ${themeStyle.subtle}`}>{labels.unavailable}</p>}
      {text.trim() && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${themeStyle.subtle}`}>Clean text preview</p><button type="button" onClick={onCopy} className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${themeStyle.button}`}>{labels.copyCleanText}</button></div>
          <p className={`max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed ${themeStyle.text}`}>{text}</p>
        </div>
      )}
      <button type="button" onClick={onRebuild} disabled={recoveryBusy || encrypted} className={`flex min-h-11 w-full items-center justify-center rounded-xl border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${themeStyle.active}`}>
        {recoveryBusy ? labels.recovery : labels.rebuild}
      </button>
    </div>
  )
}
