/**
 * Verifies that a touch-driven text selection survives the reader's action bar.
 * The reader must canonicalize the platform selection without clearing it,
 * otherwise long press freezes on the first word and drag handles disappear.
 *
 * Usage: node scripts/reader-selection-check.mjs [baseUrl]
 */
import { readFileSync } from 'node:fs'
import { chromium, devices } from 'playwright'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
}

const baseUrl = process.argv[2] || process.env.READER_SELECTION_URL || 'http://127.0.0.1:3100'
const username = process.env.PDF_LIBRARY_USERNAME || 'owner'
const password = process.env.PDF_LIBRARY_TEST_PASSWORD || process.env.PDF_LIBRARY_PASSWORD

if (!password) throw new Error('PDF_LIBRARY_TEST_PASSWORD or PDF_LIBRARY_PASSWORD is required')

const failures = []
const check = (name, ok, detail) => {
  if (ok) console.log(`  PASS  ${name}`)
  else {
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`)
    failures.push(name)
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  ...devices['iPad Pro 11'],
  isMobile: false,
  hasTouch: true,
  baseURL: baseUrl,
})

const login = await context.request.post('/api/auth/login', { data: { username, password } })
if (!login.ok()) throw new Error(`Login failed: ${login.status()} ${await login.text()}`)

const booksResponse = await context.request.get('/api/books')
const booksPayload = await booksResponse.json()
const books = Array.isArray(booksPayload) ? booksPayload : booksPayload.books || []
const pinnedId = Number(process.env.READER_SELECTION_BOOK_ID)
const book = books.find(item => item.id === pinnedId) || books.find(item => !item.is_encrypted) || books[0]
if (!book) throw new Error('No book available to open in the reader')

const page = await context.newPage()
const consoleErrors = []
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })

/** PDF.js wraps glyph spans in display:contents markedContent nodes, so wait on
 *  rendered text rather than on element visibility. */
const waitForRenderedText = target => target.waitForFunction(() => {
  const layers = [...document.querySelectorAll('.react-pdf__Page__textContent, .ocr-text-layer')]
  return layers.some(layer => (layer.textContent || '').trim().length > 20)
}, null, { timeout: 90_000 })

await page.goto(`/reader/${book.id}`, { waitUntil: 'domcontentloaded' })
await waitForRenderedText(page)
await page.waitForTimeout(2000)

console.log(`\nReader selection check on "${book.title}" (${devices['iPad Pro 11'].viewport.width}x${devices['iPad Pro 11'].viewport.height}, touch)`)

/** Builds a selection over the first `characters` characters of the page text. */
const selectCharacters = async characters => page.evaluate(count => {
  const layer = [...document.querySelectorAll('.react-pdf__Page__textContent, .ocr-text-layer')]
    .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0]
  if (!layer || (layer.textContent || '').trim().length === 0) return { error: 'no text layer' }
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
  const nodes = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent || '').trim().length > 0) nodes.push(node)
  }
  if (nodes.length === 0) return { error: 'no text nodes' }
  const range = document.createRange()
  range.setStart(nodes[0], 0)
  let remaining = count
  let placed = false
  for (const node of nodes) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      range.setEnd(node, Math.max(1, remaining))
      placed = true
      break
    }
    remaining -= length
  }
  if (!placed) {
    const last = nodes[nodes.length - 1]
    range.setEnd(last, last.textContent?.length ?? 0)
  }
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  return { text: selection.toString(), nodeCount: nodes.length }
}, characters)

const readSelection = () => page.evaluate(() => {
  const selection = window.getSelection()
  return {
    text: selection ? selection.toString() : '',
    collapsed: !selection || selection.isCollapsed,
    rangeCount: selection ? selection.rangeCount : 0,
    popupOpen: !!document.querySelector('.selection-popover'),
    popupText: document.querySelector('.selection-popover')?.textContent?.slice(0, 60) || '',
    dragOverlays: document.querySelectorAll('[data-canonical-selection-overlay] > *').length,
  }
})

const first = await selectCharacters(6)
if (first.error) throw new Error(`Could not build a selection: ${first.error}`)
await page.waitForTimeout(600)
const afterFirst = await readSelection()

check('action bar opens for a platform selection', afterFirst.popupOpen, afterFirst)
check('platform selection survives the action bar', !afterFirst.collapsed && afterFirst.text.length > 1, afterFirst)
check('platform selection keeps its own painting instead of a drag overlay', afterFirst.dragOverlays === 0, afterFirst)

await selectCharacters(400)
await page.waitForTimeout(600)
const afterExtend = await readSelection()

check('selection can still be extended afterwards', !afterExtend.collapsed && afterExtend.text.length > afterFirst.text.length, {
  before: afterFirst.text,
  after: afterExtend.text,
})
check('action bar follows the extended selection', afterExtend.popupOpen, afterExtend)

await page.evaluate(() => window.getSelection()?.removeAllRanges())
await page.waitForTimeout(500)
const afterClear = await readSelection()
check('action bar closes when the selection is dropped', !afterClear.popupOpen, afterClear)

check('no browser console errors on touch', consoleErrors.length === 0, consoleErrors.slice(0, 3))
// Headless Chromium has no long-press word selection, not even on a plain HTML
// page, so that gesture can only be confirmed on a real device.

console.log('\nDesktop mouse drag (1440x900, no touch)')
const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: baseUrl })
await desktopContext.addCookies(await context.cookies())
const desktopPage = await desktopContext.newPage()
const desktopErrors = []
desktopPage.on('console', message => { if (message.type() === 'error') desktopErrors.push(message.text()) })
await desktopPage.goto(`/reader/${book.id}`, { waitUntil: 'domcontentloaded' })
await waitForRenderedText(desktopPage)
await desktopPage.waitForTimeout(2000)

const spanBox = await desktopPage.evaluate(() => {
  const layer = [...document.querySelectorAll('.react-pdf__Page__textContent, .ocr-text-layer')]
    .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0]
  const span = [...layer.querySelectorAll('span')]
    .filter(item => (item.textContent || '').trim().length > 3)
    .map(item => item.getBoundingClientRect())
    .find(rect => rect.width > 30 && rect.height > 4)
  return span ? { x: span.x, y: span.y, width: span.width, height: span.height } : null
})
await desktopPage.mouse.move(spanBox.x + 2, spanBox.y + spanBox.height / 2)
await desktopPage.mouse.down()
await desktopPage.mouse.move(spanBox.x + spanBox.width - 2, spanBox.y + spanBox.height / 2, { steps: 12 })
await desktopPage.mouse.up()
await desktopPage.waitForTimeout(700)

const desktopState = await desktopPage.evaluate(() => ({
  popupOpen: !!document.querySelector('.selection-popover'),
  dragOverlays: document.querySelectorAll('[data-canonical-selection-overlay] > *').length,
}))
check('mouse drag opens the action bar', desktopState.popupOpen, desktopState)
check('mouse drag paints the canonical selection overlay', desktopState.dragOverlays > 0, desktopState)
check('no browser console errors on desktop', desktopErrors.length === 0, desktopErrors.slice(0, 3))

await browser.close()

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll reader selection checks passed.')
