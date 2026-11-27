import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://sozluk.gov.tr/',
}

async function gtsLookup(word: string): Promise<TDKEntry[] | null> {
  try {
    const res = await fetch(
      `https://sozluk.gov.tr/gts?ara=${encodeURIComponent(word)}`,
      { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return null
    const data = await res.json() as TDKEntry[] | { error: string }
    if (Array.isArray(data) && data.length > 0) return data
    return null
  } catch {
    return null
  }
}

async function yazimLookup(word: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://sozluk.gov.tr/yazim?ara=${encodeURIComponent(word)}`,
      { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(4000) }
    )
    if (!res.ok) return null
    const data = await res.json() as Array<{ sozu: string }> | { error: string }
    if (Array.isArray(data) && data.length > 0) return data[0].sozu
    return null
  } catch {
    return null
  }
}

// Clean invisible/zero-width chars from PDF text
function cleanWord(raw: string) {
  return raw
    .replace(/[­​‌‍﻿⁠]/g, '') // soft hyphen, ZWS, etc.
    .replace(/["""«»]/g, '')   // quote chars
    .trim()
    .toLowerCase()
}

// Progressive stem truncation — tries yazim for progressively shorter prefixes
// to find the dictionary base form of an agglutinated Turkish word.
function addCandidate(candidates: string[], seen: Set<string>, value: string) {
  const candidate = value.trim()
  if (candidate.length < 3 || seen.has(candidate)) return
  seen.add(candidate)
  candidates.push(candidate)
}

function softenedRootCandidates(stem: string) {
  const last = stem.at(-1)
  const base = stem.slice(0, -1)
  const map: Record<string, string[]> = {
    'ğ': ['k'],
    'g': ['k'],
    'b': ['p'],
    'c': ['ç'],
    'd': ['t'],
  }
  return last && map[last] ? map[last].map(replacement => `${base}${replacement}`) : []
}

function generateBaseCandidates(word: string) {
  const candidates: string[] = []
  const seen = new Set<string>()
  const minLen = Math.max(3, Math.ceil(word.length * 0.5))

  for (let len = word.length; len >= minLen; len--) {
    const stem = word.slice(0, len)
    addCandidate(candidates, seen, stem)
    for (const softened of softenedRootCandidates(stem)) {
      addCandidate(candidates, seen, softened)
    }
  }

  return candidates
}

async function findBase(word: string): Promise<string | null> {
  for (const candidate of generateBaseCandidates(word)) {
    const exact = await gtsLookup(candidate)
    if (exact) return candidate

    const found = await yazimLookup(candidate)
    if (found) return found
  }
  return null
}

interface TDKAnlam {
  anlam: string
  anlam_html: string
  ozelliklerListe?: Array<{ tam_adi: string; kisa_adi: string }>
}
interface TDKEntry {
  madde: string
  anlamlarListe?: TDKAnlam[]
  birlesikler?: string
}

function normalizeLookupWord(raw: string) {
  return raw
    .normalize('NFC')
    .replace(/[\u00ad\u200b\u200c\u200d\ufeff\u2060]/g, '')
    .replace(/[“”"«»]/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim()
    .toLocaleLowerCase('tr')
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const q = req.nextUrl.searchParams.get('q')
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 })

  const word = normalizeLookupWord(cleanWord(q))
  if (!word) return NextResponse.json({ error: 'empty word' }, { status: 400 })

  // 1 — exact lookup
  let entries = await gtsLookup(word)
  let foundAs = word

  // 2 — yazim exact (may canonicalise spelling e.g. i vs İ)
  if (!entries) {
    const canonical = await yazimLookup(word)
    if (canonical && canonical !== word) {
      entries = await gtsLookup(canonical)
      if (entries) foundAs = canonical
    }
  }

  // 3 — progressive truncation to find Turkish root form
  if (!entries) {
    const base = await findBase(word)
    if (base) {
      entries = await gtsLookup(base)
      if (entries) foundAs = base
    }
  }

  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: 'not_found', word }, { status: 404 })
  }

  // Build a clean response
  const result = entries.map(entry => ({
    madde: entry.madde,
    foundAs,                          // what we actually looked up
    searchedAs: word,                 // what the user asked for
    definitions: (entry.anlamlarListe ?? []).map(a => ({
      anlam: a.anlam,
      tur: (a.ozelliklerListe ?? []).map(o => o.tam_adi).join(', '),
    })),
  }))

  return NextResponse.json(result)
}
