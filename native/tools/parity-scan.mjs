#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'

const root = process.cwd()
const webDirs = ['app', 'components'].map(d => join(root, d))
const nativeDirs = ['native/android', 'native/apple', 'native/windows'].map(d => join(root, d))
const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.kt', '.swift', '.cs'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.next' || name.name === 'build' || name.name === 'bin' || name.name === 'obj' || name.name === 'dist' || name.name === 'api') continue
    const p = join(dir, name.name)
    if (name.isDirectory()) walk(p, out)
    else if (exts.has(extname(name.name))) out.push(p)
  }
  return out
}

function normalize(path) {
  return path
    .replace(/\\+/g, '/')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/\$\{[A-Za-z0-9_.$()]+$/g, ':param')
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/\[[^\]]+\]/g, ':param')
    .replace(/\?.*$/, '')
    .replace(/\/api\/pdf\/[^/]+$/g, '/api/pdf/:param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

function collect(files) {
  const map = new Map()
  const re = /\/api\/[A-Za-z0-9_./?=&{}$%:+\-\[\]]+/g
  for (const file of files) {
    const txt = readFileSync(file, 'utf8')
    for (const m of txt.matchAll(re)) {
      const raw = m[0].replace(/["'`),;]+$/g, '')
      const key = normalize(raw)
      if (!map.has(key)) map.set(key, { endpoint: key, examples: new Set(), files: new Set() })
      map.get(key).examples.add(raw)
      map.get(key).files.add(file.replace(root + '/', ''))
    }
  }
  return map
}

const web = collect(webDirs.flatMap(d => statSync(d, { throwIfNoEntry: false }) ? walk(d) : []))
const native = collect(nativeDirs.flatMap(d => statSync(d, { throwIfNoEntry: false }) ? walk(d) : []))
const rows = [...web.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint)).map(item => ({
  endpoint: item.endpoint,
  native: native.has(item.endpoint),
  webFiles: [...item.files].slice(0, 8),
  examples: [...item.examples].slice(0, 5),
}))
const missing = rows.filter(r => !r.native)
const report = { generatedAt: 'deterministic', totalWebEndpoints: rows.length, coveredNativeEndpoints: rows.length - missing.length, missingNativeEndpoints: missing.length, rows }
const out = join(root, 'native', 'parity-report.json')
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(`Wrote ${out}`)
console.log(`Web endpoints: ${report.totalWebEndpoints}`)
console.log(`Native covered: ${report.coveredNativeEndpoints}`)
console.log(`Missing native: ${report.missingNativeEndpoints}`)
for (const row of missing.slice(0, 30)) console.log(`- ${row.endpoint} <= ${row.webFiles[0] || ''}`)
