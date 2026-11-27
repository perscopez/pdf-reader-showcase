import { describe, expect, it } from 'vitest'
import {
  getVisiblePageNumbers,
  mapTextMatchToSpanSegments,
  rotateNormalizedRect,
} from '@/lib/pageInteraction'

describe('page interaction helpers', () => {
  describe('search-to-span mapping', () => {
    it('maps a phrase across adjacent native/OCR word spans', () => {
      expect(mapTextMatchToSpanSegments(
        ['The', 'academic', 'study', 'continues'],
        'academic study',
        0,
      )).toEqual([
        { spanIndex: 1, startOffset: 0, endOffset: 8 },
        { spanIndex: 2, startOffset: 0, endOffset: 5 },
      ])
    })

    it('collapses real whitespace while preserving source offsets', () => {
      expect(mapTextMatchToSpanSegments(
        ['önce', '  akademik', '\n\tçalışma  ', 'sonra'],
        'AKADEMİK   ÇALIŞMA',
        0,
      )).toEqual([
        { spanIndex: 1, startOffset: 2, endOffset: 10 },
        { spanIndex: 2, startOffset: 2, endOffset: 9 },
      ])
    })

    it('selects the requested occurrence instead of marking every matching span', () => {
      expect(mapTextMatchToSpanSegments(
        ['test', 'ilk', 'test', 'ikinci'],
        'test',
        1,
      )).toEqual([{ spanIndex: 2, startOffset: 0, endOffset: 4 }])
    })

    it('keeps punctuation and explicitly joined PDF fragments attached', () => {
      expect(mapTextMatchToSpanSegments(
        ['Qur', { text: "'an", joinWithPrevious: true }, ',', 'study'],
        "Qur'an, study",
      )).toEqual([
        { spanIndex: 0, startOffset: 0, endOffset: 3 },
        { spanIndex: 1, startOffset: 0, endOffset: 3 },
        { spanIndex: 2, startOffset: 0, endOffset: 1 },
        { spanIndex: 3, startOffset: 0, endOffset: 5 },
      ])
    })

    it('returns no segments for invalid or missing occurrences', () => {
      expect(mapTextMatchToSpanSegments(['one'], '', 0)).toEqual([])
      expect(mapTextMatchToSpanSegments(['one'], 'two', 0)).toEqual([])
      expect(mapTextMatchToSpanSegments(['one'], 'one', -1)).toEqual([])
      expect(mapTextMatchToSpanSegments(['one'], 'one', 1)).toEqual([])
    })
  })

  describe('normalized rotation geometry', () => {
    const source = { left: 0.1, top: 0.2, width: 0.3, height: 0.1 }

    it('maps rectangles clockwise for every supported page rotation', () => {
      expect(rotateNormalizedRect(source, 0)).toEqual(source)
      expect(rotateNormalizedRect(source, 90)).toEqual({ left: 0.7, top: 0.1, width: 0.1, height: 0.3 })
      expect(rotateNormalizedRect(source, 180)).toEqual({ left: 0.6, top: 0.7, width: 0.3, height: 0.1 })
      expect(rotateNormalizedRect(source, 270)).toEqual({ left: 0.2, top: 0.6, width: 0.1, height: 0.3 })
    })

    it('normalizes negative/overflow rotations and round-trips without drift', () => {
      expect(rotateNormalizedRect(source, -90)).toEqual(rotateNormalizedRect(source, 270))
      expect(rotateNormalizedRect(source, 450)).toEqual(rotateNormalizedRect(source, 90))

      const roundTrip = [90, 90, 90, 90].reduce(
        rect => rotateNormalizedRect(rect, 90),
        source,
      )
      expect(roundTrip).toEqual(source)
    })

    it('clamps malformed legacy rectangles before transforming them', () => {
      expect(rotateNormalizedRect({ left: -0.2, top: 0.9, width: 1.4, height: 0.4 }, 90))
        .toEqual({ left: 0, top: 0, width: 0.1, height: 1 })
    })
  })

  describe('visible page identity', () => {
    it('returns two distinct page identities in double-page mode', () => {
      expect(getVisiblePageNumbers(7, 'double', 20)).toEqual([7, 8])
    })

    it('never fabricates a second page at the end of a document', () => {
      expect(getVisiblePageNumbers(20, 'double', 20)).toEqual([20])
      expect(getVisiblePageNumbers(20, 'single', 20)).toEqual([20])
    })

    it('clamps stale saved page numbers and rejects invalid document state', () => {
      expect(getVisiblePageNumbers(0, 'double', 20)).toEqual([1, 2])
      expect(getVisiblePageNumbers(99, 'double', 20)).toEqual([20])
      expect(getVisiblePageNumbers(1, 'double', 0)).toEqual([])
    })
  })
})
