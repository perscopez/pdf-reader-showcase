import { describe, expect, it } from 'vitest'
import type { PageTextModel, PageTextWord } from '@/lib/pdfTextModel'
import {
  displayPointToCanonical,
  getCanonicalPointerSelectionMode,
  isCanonicalSelectionModelUsable,
  resolveCanonicalPdfSelection,
  resolveCanonicalPdfSelectionFromRange,
} from '@/lib/pdfSelection'

function model(words: PageTextWord[], text = words.map(word => word.text).join(' ')): PageTextModel {
  return {
    version: 5,
    source: 'native',
    quality: 0.96,
    needsOcr: false,
    text,
    blocks: [],
    words: words.map((word, order) => ({
      ...word,
      id: word.id || `word-${order}`,
      order: word.order ?? order,
    })),
    provenance: { engine: 'pdfjs', rotation: 0 },
  }
}

const word = (text: string, left: number, top: number, width: number, line: number): PageTextWord => ({
  text,
  left,
  top,
  width,
  height: 0.04,
  line,
})

describe('canonical PDF selection', () => {
  it('takes over selection only for a primary mouse drag and leaves finger and stylus gestures native', () => {
    const page = model([word('Metin', 0.1, 0.1, 0.1, 0)])
    expect(getCanonicalPointerSelectionMode({ pointerType: 'mouse', button: 0, isPrimary: true, model: page })).toBe('immediate')
    expect(getCanonicalPointerSelectionMode({ pointerType: '', button: 0, isPrimary: true, model: page })).toBe('immediate')
    expect(getCanonicalPointerSelectionMode({ pointerType: 'touch', button: 0, isPrimary: true, model: page })).toBe('native')
    expect(getCanonicalPointerSelectionMode({ pointerType: 'pen', button: 0, isPrimary: true, model: page })).toBe('native')
    expect(getCanonicalPointerSelectionMode({ pointerType: 'mouse', button: 1, isPrimary: true, model: page })).toBe('native')
    expect(getCanonicalPointerSelectionMode({ pointerType: 'mouse', button: 0, isPrimary: false, model: page })).toBe('native')
    expect(getCanonicalPointerSelectionMode({ pointerType: 'mouse', button: 0, isPrimary: true, model: null })).toBe('native')
  })

  it('resolves canonical PDF selection from a native DOM selection range', () => {
    const page = model([
      word('İlk', 0.10, 0.10, 0.05, 0),
      word('cümle', 0.16, 0.10, 0.08, 0),
      word('burada.', 0.25, 0.10, 0.10, 0),
    ])
    const fakeRange = {
      getClientRects: () => [
        { left: 100, top: 100, right: 150, bottom: 140, width: 50, height: 40 },
        { left: 250, top: 100, right: 350, bottom: 140, width: 100, height: 40 },
      ],
    } as unknown as Range
    const pageRect = { left: 0, top: 0, width: 1000, height: 1000 }
    const result = resolveCanonicalPdfSelectionFromRange(page, fakeRange, pageRect, 0)
    expect(result?.text).toBe('İlk cümle burada.')
    expect(result?.rects).toHaveLength(1)
  })

  it('maps displayed points back to canonical coordinates for every rotation', () => {
    expect(displayPointToCanonical({ x: 0.2, y: 0.3 }, 0)).toEqual({ x: 0.2, y: 0.3 })
    expect(displayPointToCanonical({ x: 0.7, y: 0.2 }, 90)).toEqual({ x: 0.2, y: 0.3 })
    expect(displayPointToCanonical({ x: 0.8, y: 0.7 }, 180)).toEqual({ x: 0.2, y: 0.3 })
    expect(displayPointToCanonical({ x: 0.3, y: 0.8 }, 270)).toEqual({ x: 0.2, y: 0.3 })
  })

  it('returns the same clean range for forward and reverse drags', () => {
    const page = model([
      word('Bir', 0.10, 0.10, 0.06, 0),
      word('seçim', 0.18, 0.10, 0.10, 0),
      word('örneği.', 0.30, 0.10, 0.12, 0),
    ])
    const forward = resolveCanonicalPdfSelection(page, { x: 0.11, y: 0.12 }, { x: 0.40, y: 0.12 }, 0)
    const reverse = resolveCanonicalPdfSelection(page, { x: 0.40, y: 0.12 }, { x: 0.11, y: 0.12 }, 0)

    expect(forward?.text).toBe('Bir seçim örneği.')
    expect(reverse).toEqual(forward)
    expect(forward?.rects).toEqual([{ left: 0.1, top: 0.1, width: 0.32, height: 0.04 }])
  })

  it('joins wrapped lines and removes a soft visual hyphen', () => {
    const page = model([
      word('PDF', 0.10, 0.10, 0.06, 0),
      word('seçim-', 0.18, 0.10, 0.11, 0),
      word('lerinin', 0.10, 0.16, 0.13, 1),
      word('kararlı', 0.25, 0.16, 0.12, 1),
      word('olması.', 0.39, 0.16, 0.12, 1),
    ])
    const result = resolveCanonicalPdfSelection(page, { x: 0.11, y: 0.12 }, { x: 0.49, y: 0.18 }, 0)
    expect(result?.text).toBe('PDF seçimlerinin kararlı olması.')
    expect(result?.rects).toHaveLength(2)
  })

  it('keeps a drag inside its visual column instead of crossing the neighbouring column', () => {
    const page = model([
      word('Sol', 0.08, 0.10, 0.06, 0),
      word('bir', 0.16, 0.10, 0.05, 0),
      word('Sağ', 0.58, 0.10, 0.07, 0),
      word('bir', 0.67, 0.10, 0.05, 0),
      word('Sol', 0.08, 0.16, 0.06, 1),
      word('iki', 0.16, 0.16, 0.05, 1),
      word('Sağ', 0.58, 0.16, 0.07, 1),
      word('iki', 0.67, 0.16, 0.05, 1),
    ])
    const result = resolveCanonicalPdfSelection(page, { x: 0.09, y: 0.12 }, { x: 0.20, y: 0.18 }, 0)
    expect(result?.text).toBe('Sol bir Sol iki')
    expect(result?.words.map(item => item.text)).toEqual(['Sol', 'bir', 'Sol', 'iki'])
  })

  it('uses the same contract for OCR words and rotated display points', () => {
    const page = model([
      word('OCR', 0.20, 0.30, 0.08, 0),
      word('metni', 0.30, 0.30, 0.10, 0),
    ])
    page.source = 'ocr'
    page.provenance = { engine: 'tesseract.js', rotation: 0 }
    const result = resolveCanonicalPdfSelection(page, { x: 0.68, y: 0.21 }, { x: 0.68, y: 0.39 }, 90)
    expect(result?.text).toBe('OCR metni')
  })

  it('rejects missing, OCR-pending, and very low quality geometry', () => {
    const valid = model([word('metin', 0.1, 0.1, 0.1, 0)])
    expect(isCanonicalSelectionModelUsable(valid)).toBe(true)
    expect(isCanonicalSelectionModelUsable({ ...valid, needsOcr: true })).toBe(false)
    expect(isCanonicalSelectionModelUsable({ ...valid, source: 'ocr', quality: 0.2 })).toBe(false)
    expect(isCanonicalSelectionModelUsable({ ...valid, provenance: { ...valid.provenance, rotation: 90 } })).toBe(false)
    expect(isCanonicalSelectionModelUsable(null)).toBe(false)
  })

  it('returns null when an endpoint is outside bounded word tolerance', () => {
    const page = model([word('metin', 0.1, 0.1, 0.1, 0)])
    expect(resolveCanonicalPdfSelection(page, { x: 0.8, y: 0.8 }, { x: 0.15, y: 0.12 }, 0)).toBeNull()
  })

  it('snaps a drag ending in nearby line whitespace to the final word', () => {
    const page = model([
      word('yakın', 0.1, 0.1, 0.08, 0),
      word('boşluk', 0.2, 0.1, 0.1, 0),
    ])
    expect(resolveCanonicalPdfSelection(page, { x: 0.11, y: 0.12 }, { x: 0.35, y: 0.12 }, 0)?.text).toBe('yakın boşluk')
  })
})
