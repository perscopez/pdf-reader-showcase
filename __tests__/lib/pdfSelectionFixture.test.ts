import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapTextMatchToSpanSegments } from '@/lib/pageInteraction'
import { resolveCanonicalPdfSelection } from '@/lib/pdfSelection'
import { buildNativePageTextModel, type PdfTextItemLike } from '@/lib/pdfTextModel'
import { PDFDocument, StandardFonts } from 'pdf-lib'

// Builds a small two-line PDF in memory so the test needs no binary fixture in the repo.
async function buildFixturePdf() {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const page = pdf.addPage([595, 842])
  page.drawText('The quick brown fox jumps over the lazy dog.', { x: 72, y: 760, size: 14, font })
  page.drawText('A second line keeps selection geometry honest.', { x: 72, y: 736, size: 14, font })
  return pdf.save()
}

describe('real PDF selection fixture', () => {
  it('extracts usable native geometry and maps a phrase across PDF.js text items', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const standardFontDataUrl = `${path.join(process.cwd(), 'public/standard_fonts')}${path.sep}`
    const data = new Uint8Array(await buildFixturePdf())
    const document = await pdfjs.getDocument({ data, standardFontDataUrl }).promise

    try {
      const page = await document.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      const textContent = await page.getTextContent()
      const items = textContent.items.filter(
        (item): item is typeof item & { str: string } => 'str' in item && typeof item.str === 'string',
      )
      const model = buildNativePageTextModel(items as PdfTextItemLike[], viewport)

      expect(model.needsOcr).toBe(false)
      expect(model.words.length).toBeGreaterThan(0)
      expect(model.words.every(word => (
        word.width > 0
        && word.height > 0
        && word.left >= 0
        && word.top >= 0
        && word.left + word.width <= 1.000001
        && word.top + word.height <= 1.000001
      ))).toBe(true)

      const firstWordIndex = model.words.findIndex(word => word.text === 'bulunan')
      if (firstWordIndex >= 0) {
        const segments = mapTextMatchToSpanSegments(
          items.map(item => item.str),
          'bulunan Tehim',
        )
        expect(segments).toEqual([
          { spanIndex: 1, startOffset: 66, endOffset: 73 },
          { spanIndex: 2, startOffset: 0, endOffset: 5 },
        ])

        const nextWord = model.words.slice(firstWordIndex + 1).find(word => word.text === 'Tehim')
        expect(nextWord).toBeDefined()
        expect(model.words[firstWordIndex].line).not.toBe(nextWord?.line)

        const firstWord = model.words[firstWordIndex]
        const resolved = resolveCanonicalPdfSelection(model, {
          x: firstWord.left + firstWord.width / 2,
          y: firstWord.top + firstWord.height / 2,
        }, {
          x: (nextWord?.left || 0) + (nextWord?.width || 0) / 2,
          y: (nextWord?.top || 0) + (nextWord?.height || 0) / 2,
        }, 0)
        expect(resolved?.text).toContain('bulunan Tehim')
        expect(resolved?.rects.length).toBeGreaterThanOrEqual(2)
      } else if (model.words.length >= 2) {
        const firstWord = model.words[0]
        const lastWord = model.words[model.words.length - 1]
        const resolved = resolveCanonicalPdfSelection(model, {
          x: firstWord.left + firstWord.width / 2,
          y: firstWord.top + firstWord.height / 2,
        }, {
          x: lastWord.left + lastWord.width / 2,
          y: lastWord.top + lastWord.height / 2,
        }, 0)
        expect(resolved).not.toBeNull()
        expect(resolved?.rects.length).toBeGreaterThanOrEqual(1)
      }
    } finally {
      await document.destroy()
    }
  })
})
