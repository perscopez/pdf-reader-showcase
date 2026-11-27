import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function cssRule(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'))?.[1] ?? ''
}

describe('OCR selection overlay CSS contract', () => {
  it('keeps OCR glyphs invisible while preserving native selection paint', async () => {
    const css = await fs.readFile(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    const spanRule = cssRule(css, '.ocr-text-layer span')
    const selectionRule = cssRule(css, '.ocr-text-layer span::selection')

    expect(spanRule).toMatch(/color:\s*transparent\s*!important/)
    expect(spanRule).toMatch(/-webkit-text-fill-color:\s*transparent\s*!important/)
    expect(spanRule).toMatch(/user-select:\s*text/)
    expect(spanRule).toMatch(/pointer-events:\s*auto|cursor:\s*text/)
    expect(selectionRule).toMatch(/background:\s*rgba\(/)
    expect(selectionRule).toMatch(/color:\s*transparent/)
    expect(selectionRule).toMatch(/-webkit-text-fill-color:\s*transparent/)
  })

  it('disables the native PDF text layer whenever OCR owns selection', async () => {
    const css = await fs.readFile(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    const nativeRule = cssRule(
      css,
      '.ocr-selection-active .reader-pdf-page .react-pdf__Page__textContent',
    )

    expect(nativeRule).toMatch(/pointer-events:\s*none\s*!important/)
    expect(nativeRule).toMatch(/user-select:\s*none\s*!important/)
    expect(nativeRule).toMatch(/-webkit-user-select:\s*none\s*!important/)
  })
})
