import { describe, expect, it } from 'vitest'
import {
  buildDocumentRevisionFingerprint,
  buildNativePageTextModel,
  buildOcrPageTextModel,
  isValidPageTextModel,
  pageTextModelMatchesDocument,
  scoreNativeText,
} from '@/lib/pdfTextModel'

describe('PDF page text model', () => {
  it('reconstructs fragmented letters from geometry without joining real words', () => {
    const items = [
      ...'İSRAİL'.split('').map((str, index) => ({
        str,
        width: 6,
        height: 10,
        transform: [10, 0, 0, 10, 10 + index * 6, 90],
      })),
      { str: 'bir', width: 15, height: 10, transform: [10, 0, 0, 10, 55, 90] },
      { str: 'şey', width: 15, height: 10, transform: [10, 0, 0, 10, 78, 90] },
    ]
    const model = buildNativePageTextModel(items, { width: 120, height: 100 })
    expect(model.text).toContain('İSRAİL bir şey')
    expect(model.text).not.toContain('birşey')
  })

  it('routes corrupted and heavily fragmented native layers to OCR recovery', () => {
    const fragmented = 'OKUNABILIR'.split('').map(str => ({ str }))
    expect(scoreNativeText(fragmented, 'OKUNABILIR')).toBeLessThan(0.58)
    expect(scoreNativeText([{ str: '\uFFFD\uE000\uFFFD' }], '\uFFFD\uE000\uFFFD')).toBeLessThan(0.58)
    expect(scoreNativeText(
      [{ str: "scholars of the Qpr'an" }],
      "scholars of the Qpr'an",
    )).toBeLessThan(0.58)
    expect(scoreNativeText(
      [{ str: "study of the Qur'an" }],
      "study of the Qur'an",
    )).toBeGreaterThan(0.58)
  })

  it('builds normalized OCR word boxes and paragraph text from TSV', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t95\tBir',
      '5\t1\t1\t1\t1\t2\t45\t20\t25\t10\t93\tşey',
      '5\t1\t1\t1\t1\t3\t75\t20\t20\t10\t90\toldu.',
    ].join('\n')
    const model = buildOcrPageTextModel(tsv, { width: 100, height: 100 })
    expect(model.text).toBe('Bir şey oldu.')
    expect(model.words[0]).toMatchObject({ left: 0.1, top: 0.2, width: 0.3, height: 0.1 })
    expect(isValidPageTextModel(model)).toBe(true)
  })

  it('rejects out-of-bounds cached word geometry', () => {
    const invalid = {
      version: 4,
      source: 'ocr',
      quality: 0.9,
      needsOcr: false,
      text: 'x',
      blocks: [],
      words: [{ text: 'x', left: -1, top: 0, width: 1, height: 1, line: 0 }],
    }
    expect(isValidPageTextModel(invalid)).toBe(false)
  })

  it('invalidates a cached model when the source document revision changes', () => {
    const firstFingerprint = buildDocumentRevisionFingerprint({
      filename: 'Document.PDF',
      size: 1024,
      mtimeMs: 1_700_000_000_000,
    })
    const sameRevision = buildDocumentRevisionFingerprint({
      filename: 'document.pdf',
      size: 1024,
      mtimeMs: 1_700_000_000_000,
    })
    const replacedRevision = buildDocumentRevisionFingerprint({
      filename: 'document.pdf',
      size: 2048,
      mtimeMs: 1_700_000_000_500,
    })
    expect(sameRevision).toBe(firstFingerprint)
    expect(replacedRevision).not.toBe(firstFingerprint)

    const model = buildNativePageTextModel([
      { str: 'revision aware', width: 50, height: 10, transform: [10, 0, 0, 10, 10, 90] },
    ], { width: 100, height: 100 }, {
      documentFingerprint: firstFingerprint,
      engine: 'pdfjs',
      engineVersion: '5.4.296',
      rotation: 0,
    })
    expect(pageTextModelMatchesDocument(model, sameRevision)).toBe(true)
    expect(pageTextModelMatchesDocument(model, replacedRevision)).toBe(false)
  })

  it('gives native and OCR words deterministic identities with monotonic text offsets', () => {
    const nativeItems = [
      { str: 'Bir şey', width: 50, height: 10, transform: [10, 0, 0, 10, 10, 90] },
      { str: 'oldu', width: 25, height: 10, transform: [10, 0, 0, 10, 10, 70] },
    ]
    const first = buildNativePageTextModel(nativeItems, { width: 100, height: 100 })
    const second = buildNativePageTextModel(nativeItems, { width: 100, height: 100 })
    expect(first.words.map(word => word.id)).toEqual(second.words.map(word => word.id))
    expect(first.words.map(word => word.order)).toEqual([0, 1, 2])
    expect(first.words.every((word, index) => (
      word.startOffset !== undefined
      && word.endOffset !== undefined
      && first.text.slice(word.startOffset, word.endOffset) === word.text
      && (index === 0 || word.startOffset >= (first.words[index - 1].endOffset ?? 0))
    ))).toBe(true)

    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t95\tBir',
      '5\t1\t1\t1\t1\t2\t45\t20\t25\t10\t93\tşey',
    ].join('\n')
    const ocr = buildOcrPageTextModel(tsv, { width: 100, height: 100 }, {
      documentFingerprint: 'fixture',
      rotation: 90,
      dpi: 300,
    })
    expect(ocr.provenance).toMatchObject({
      documentFingerprint: 'fixture',
      engine: 'tesseract.js',
      rotation: 90,
      dpi: 300,
    })
    expect(ocr.words.map(word => [word.order, word.startOffset, word.endOffset]))
      .toEqual([[0, 0, 3], [1, 4, 7]])
  })
})
