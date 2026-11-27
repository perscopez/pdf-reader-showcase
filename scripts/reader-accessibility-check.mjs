import { chromium } from 'playwright'

const url = process.env.READER_ACCESSIBILITY_URL || 'http://127.0.0.1:3000/reader/1'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 414, height: 896 }, userAgent: 'reader-accessibility-check' })
await page.goto(url, { waitUntil: 'domcontentloaded' })
const reader = page.locator('[data-reader-mode]')
if (await reader.count() === 0) throw new Error(`Reader shell not found at ${url}; provide an authenticated reader URL if needed.`)
const result = await reader.evaluate(node => {
  const focusable = [...node.querySelectorAll('button, a, input, select, textarea')]
  const unlabeled = focusable.filter(item => !item.getAttribute('aria-label') && !item.textContent?.trim()).length
  const undersized = focusable.filter(item => { const rect = item.getBoundingClientRect(); return rect.width > 0 && (rect.width < 44 || rect.height < 44) }).length
  return { mode: node.getAttribute('data-reader-mode'), unlabeled, undersized, overflow: document.documentElement.scrollWidth > window.innerWidth }
})
if (result.unlabeled || result.undersized || result.overflow) throw new Error(JSON.stringify(result))
await page.keyboard.press('ArrowRight')
console.log(JSON.stringify({ url, ...result, keyboardNavigation: 'sent ArrowRight' }))
await browser.close()
