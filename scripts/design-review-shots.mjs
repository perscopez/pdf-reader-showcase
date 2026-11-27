#!/usr/bin/env node
/**
 * Design-review screenshot harness.
 *
 * Captures desktop (1440x900) and iPhone 11 (414x896) screenshots of the key
 * pages against a local dev server, logging in via the dev-only legacy auth
 * token cookie. Output goes to design-review/screens/ (gitignored).
 *
 * Usage:
 *   PDF_LIBRARY_AUTH_TOKEN=localtest PORT=3005 npm run dev   # in one terminal
 *   node scripts/design-review-shots.mjs [baseUrl] [token]   # in another
 *
 * Defaults: baseUrl=http://localhost:3005, token=localtest
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const baseUrl = process.argv[2] || 'http://localhost:3005'
const token = process.argv[3] || process.env.PDF_LIBRARY_AUTH_TOKEN || 'localtest'
const outDir = path.join(process.cwd(), 'design-review', 'screens')
fs.mkdirSync(outDir, { recursive: true })

const pages = [
  { name: 'home', path: '/' },
  { name: 'stats', path: '/stats' },
  { name: 'words', path: '/words' },
  { name: 'bugs', path: '/bugs' },
  { name: 'reader', path: '/reader/1', settle: 4000 },
  { name: 'login', path: '/login', noAuth: true },
]

const viewports = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'iphone11', width: 414, height: 896, mobile: true },
]

const url = new URL(baseUrl)

async function run() {
  const browser = await chromium.launch()
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: Boolean(vp.mobile),
      hasTouch: Boolean(vp.mobile),
    })
    await context.addCookies([
      {
        name: 'pdf_library_auth',
        value: token,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    const page = await context.newPage()
    for (const target of pages) {
      const dest = path.join(outDir, `${target.name}-${vp.tag}.png`)
      try {
        await page.goto(baseUrl + target.path, { waitUntil: 'domcontentloaded', timeout: 45000 })
        if (target.name === 'home') {
          await page.locator('.library-hero-canvas, .library-stat-chip').first().waitFor({ timeout: 25000 }).catch(() => {})
        }
        await page.waitForTimeout(target.settle || (target.name === 'home' ? 2000 : 3000))
        await page.screenshot({ path: dest, fullPage: target.name !== 'reader' })
        console.log(`[ok] ${target.name} (${vp.tag}) -> ${path.relative(process.cwd(), dest)}`)
      } catch (err) {
        console.error(`[fail] ${target.name} (${vp.tag}): ${err.message}`)
      }
    }
    await context.close()
  }
  await browser.close()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
