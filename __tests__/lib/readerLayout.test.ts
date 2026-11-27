import { describe, expect, it } from 'vitest'
import {
  calculateFitWidthScale,
  getNoteRailAnchor,
  getSelectionToolbarPosition,
  isTypingTarget,
  isOversizedPageSelection,
  isPhoneLandscapeViewport,
  isTouchSelectionSheetViewport,
  layoutNoteRailAnchors,
  mergeOverlappingHighlightRects,
  readBooleanSetting,
} from '@/lib/readerLayout'

describe('reader mobile layout helpers', () => {
  it('caps fit-width zoom on phone landscape so PDF text does not become oversized', () => {
    const scale = calculateFitWidthScale({
      readerWidth: 812,
      pageWidth: 612,
      pagesShown: 1,
      gap: 0,
      viewportWidth: 812,
      viewportHeight: 375,
      maxTouchPoints: 5,
    })

    expect(scale).toBe(0.92)
  })

  it('keeps normal fit-width behavior on phone portrait', () => {
    const scale = calculateFitWidthScale({
      readerWidth: 375,
      pageWidth: 612,
      pagesShown: 1,
      gap: 0,
      viewportWidth: 375,
      viewportHeight: 812,
      maxTouchPoints: 5,
    })

    expect(scale).toBe(0.55)
  })

  it('does not apply the phone landscape cap on desktop-like non-touch viewports', () => {
    const scale = calculateFitWidthScale({
      readerWidth: 900,
      pageWidth: 612,
      pagesShown: 1,
      gap: 0,
      viewportWidth: 900,
      viewportHeight: 500,
      maxTouchPoints: 0,
    })

    expect(scale).toBe(1.41)
  })

  it('detects short touch landscape viewports and touch selection sheet mode', () => {
    expect(isPhoneLandscapeViewport(812, 375, 5)).toBe(true)
    expect(isPhoneLandscapeViewport(812, 375, 0)).toBe(false)
    expect(isTouchSelectionSheetViewport(812, 5, 375)).toBe(true)
    expect(isTouchSelectionSheetViewport(390, 0, 844)).toBe(true)
    expect(isTouchSelectionSheetViewport(1024, 5, 768)).toBe(false)
    expect(isTouchSelectionSheetViewport(768, 5, 1024)).toBe(false)
  })

  it('identifies oversized whole-page accidental selections without blocking multi-line paragraphs', () => {
    const normalSelection = {
      text: 'Bu kısa bir cümlenin seçimi.',
      textLayerText: 'Bu kısa bir cümlenin seçimi. Sayfanın geri kalanında daha pek çok cümle ve paragraf yer alıyor.',
      rectsCount: 2,
      unionCoverage: 0.05,
      unionTop: 0.10,
      unionBottom: 0.15,
    }
    expect(isOversizedPageSelection(normalSelection)).toBe(false)

    const multiLineParagraphSelection = {
      text: 'Buradan başlayarak 10 satır boyunca devam eden normal bir paragraf seçimi ' + 'a'.repeat(400),
      textLayerText: 'Sayfanın başı. ' + 'a'.repeat(1200),
      rectsCount: 10,
      unionCoverage: 0.40,
      unionTop: 0.45,
      unionBottom: 0.85,
    }
    expect(isOversizedPageSelection(multiLineParagraphSelection)).toBe(false)

    const wholePageSelection = {
      text: 'a'.repeat(1500),
      textLayerText: 'a'.repeat(1600),
      rectsCount: 30,
      unionCoverage: 0.88,
      unionTop: 0.05,
      unionBottom: 0.95,
    }
    expect(isOversizedPageSelection(wholePageSelection)).toBe(true)
  })

  it('places the selection toolbar above the final range with a stable gap', () => {
    expect(getSelectionToolbarPosition({
      selection: { left: 420, top: 280, width: 160, height: 24 },
      viewportWidth: 1200,
      viewportHeight: 800,
      toolbarWidth: 520,
      toolbarHeight: 44,
      gap: 12,
    })).toEqual({ left: 240, top: 224 })
  })

  it('places the toolbar below near the viewport top and clamps it horizontally', () => {
    expect(getSelectionToolbarPosition({
      selection: { left: 8, top: 30, width: 70, height: 20 },
      viewportWidth: 390,
      viewportHeight: 844,
      toolbarWidth: 360,
      toolbarHeight: 44,
      gap: 12,
    })).toEqual({ left: 12, top: 62 })
  })

  it('anchors a saved note rail to the right edge near the final selected line', () => {
    expect(getNoteRailAnchor([
      { left: 0.18, top: 0.32, width: 0.56, height: 0.025 },
      { left: 0.18, top: 0.35, width: 0.30, height: 0.025 },
    ])).toEqual({ left: 1, top: 0.3625 })
  })

  it('merges duplicate and overlapping highlight fragments without joining separate words or lines', () => {
    expect(mergeOverlappingHighlightRects([
      { left: 0.20, top: 0.40, width: 0.42, height: 0.03 },
      { left: 0.21, top: 0.402, width: 0.22, height: 0.028 },
      { left: 0.44, top: 0.401, width: 0.18, height: 0.029 },
      { left: 0.66, top: 0.40, width: 0.08, height: 0.03 },
      { left: 0.20, top: 0.45, width: 0.18, height: 0.03 },
    ])).toEqual([
      { left: 0.20, top: 0.40, width: 0.42, height: 0.03 },
      { left: 0.66, top: 0.40, width: 0.08, height: 0.03 },
      { left: 0.20, top: 0.45, width: 0.18, height: 0.03 },
    ])
  })

  it('keeps already separated note rail anchors close to their source positions', () => {
    expect(layoutNoteRailAnchors([
      { id: 1, top: 0.2 },
      { id: 2, top: 0.5 },
    ], { minGap: 0.08 })).toEqual([
      { id: 1, sourceTop: 0.2, top: 0.2 },
      { id: 2, sourceTop: 0.5, top: 0.5 },
    ])
  })

  it('orders clustered note anchors, separates them, and clamps the group to safe bounds', () => {
    expect(layoutNoteRailAnchors([
      { id: 30, top: 0.94 },
      { id: 10, top: 0.9 },
      { id: 20, top: 0.92 },
    ], { minGap: 0.08, minTop: 0.08, maxTop: 0.92 })).toEqual([
      { id: 10, sourceTop: 0.9, top: 0.76 },
      { id: 20, sourceTop: 0.92, top: 0.84 },
      { id: 30, sourceTop: 0.94, top: 0.92 },
    ])
  })

  it('detects typing targets so reader shortcuts do not fire while editing', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('preserves an explicit global page-note visibility preference and rejects invalid values', () => {
    expect(readBooleanSetting({ showPageNotes: false }, 'showPageNotes', true)).toBe(false)
    expect(readBooleanSetting({ showPageNotes: 'false' }, 'showPageNotes', true)).toBe(true)
    expect(readBooleanSetting({}, 'showPageNotes', true)).toBe(true)
  })
})
