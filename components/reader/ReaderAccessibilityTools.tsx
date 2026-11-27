'use client'

type ThemeStyle = { subtle: string; button: string; active: string }

export function ReaderAccessibilityTools({
  themeStyle,
  readingRuler,
  focusLine,
  highContrast,
  eInkMode,
  reducedMotion,
  fontScale,
  lineHeight,
  columnWidth,
  onToggle,
  onNumberChange,
  readingDirection,
  onDirectionChange,
  labels,
}: {
  themeStyle: ThemeStyle
  readingRuler: boolean
  focusLine: boolean
  highContrast: boolean
  eInkMode: boolean
  reducedMotion: boolean
  fontScale: number
  lineHeight: number
  columnWidth: number
  onToggle: (key: 'readingRuler' | 'focusLine' | 'highContrast' | 'eInkMode' | 'reducedMotion') => void
  onNumberChange: (key: 'fontScale' | 'lineHeight' | 'columnWidth', value: number) => void
  readingDirection: 'auto' | 'ltr' | 'rtl'
  onDirectionChange: (value: 'auto' | 'ltr' | 'rtl') => void
  labels: { readingRuler: string; focusLine: string; highContrast: string; eInkMode: string; reducedMotion: string; textSize: string; lineHeight: string; columnWidth: string; readingDirection: string; auto: string; ltr: string; rtl: string; on: string; off: string }
}) {
  const toggle = (key: 'readingRuler' | 'focusLine' | 'highContrast' | 'eInkMode' | 'reducedMotion', label: string, active: boolean) => (
    <button type="button" onClick={() => onToggle(key)} aria-pressed={active} className={`flex min-h-11 items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs font-semibold ${active ? themeStyle.active : themeStyle.button}`}><span>{label}</span><span className="text-[10px]">{active ? labels.on : labels.off}</span></button>
  )
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {toggle('readingRuler', labels.readingRuler, readingRuler)}
        {toggle('focusLine', labels.focusLine, focusLine)}
        {toggle('highContrast', labels.highContrast, highContrast)}
        {toggle('eInkMode', labels.eInkMode, eInkMode)}
        {toggle('reducedMotion', labels.reducedMotion, reducedMotion)}
      </div>
      <label className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border p-3 text-xs ${themeStyle.button}`}>
        <span className="font-semibold">{labels.readingDirection}</span>
        <select value={readingDirection} onChange={event => onDirectionChange(event.target.value as 'auto' | 'ltr' | 'rtl')} aria-label={labels.readingDirection} className="min-h-11 rounded-lg border bg-transparent px-2 text-xs">
          <option value="auto">{labels.auto}</option><option value="ltr">{labels.ltr}</option><option value="rtl">{labels.rtl}</option>
        </select>
      </label>
      <label className={`block rounded-xl border p-3 text-xs ${themeStyle.button}`}>
        <span className="mb-2 flex justify-between"><span>{labels.textSize}</span><span className={themeStyle.subtle}>{Math.round(fontScale * 100)}%</span></span>
        <input type="range" min="0.8" max="1.8" step="0.05" value={fontScale} onChange={event => onNumberChange('fontScale', Number(event.target.value))} className="w-full" />
      </label>
      <label className={`block rounded-xl border p-3 text-xs ${themeStyle.button}`}>
        <span className="mb-2 flex justify-between"><span>{labels.lineHeight}</span><span className={themeStyle.subtle}>{lineHeight.toFixed(1)}</span></span>
        <input type="range" min="1.1" max="2.4" step="0.1" value={lineHeight} onChange={event => onNumberChange('lineHeight', Number(event.target.value))} className="w-full" />
      </label>
      <label className={`block rounded-xl border p-3 text-xs ${themeStyle.button}`}>
        <span className="mb-2 flex justify-between"><span>{labels.columnWidth}</span><span className={themeStyle.subtle}>{columnWidth}ch</span></span>
        <input type="range" min="42" max="110" step="2" value={columnWidth} onChange={event => onNumberChange('columnWidth', Number(event.target.value))} className="w-full" />
      </label>
    </div>
  )
}
