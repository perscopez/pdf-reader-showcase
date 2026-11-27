export type GcpVoice = {
  name: string
  ssmlGender?: string
  languageCodes?: string[]
}

import { repairTurkishWordSpacing } from './text'

export type MappedTtsVoice = {
  Name: string
  Locale: string
  Gender: string
  FriendlyName: string
  Quality: 'chirp3' | 'chirp' | 'neural2' | 'wavenet' | 'studio' | 'standard' | 'other'
}

/** Preferred Chirp 3 HD speaker shortlist — natural and widely available. */
export const PREFERRED_CHIRP3_SPEAKERS = [
  'Aoede',
  'Charon',
  'Fenrir',
  'Kore',
  'Leda',
  'Orus',
  'Puck',
  'Zephyr',
] as const

const UI_LANG_TO_LOCALE: Record<string, string> = {
  tr: 'tr-TR',
  en: 'en-US',
  de: 'de-DE',
}

export function uiLanguageToLocale(uiLang: string): string {
  return UI_LANG_TO_LOCALE[uiLang] || 'en-US'
}

export function voiceQuality(name: string): MappedTtsVoice['Quality'] {
  const lower = name.toLowerCase()
  if (lower.includes('chirp3')) return 'chirp3'
  if (lower.includes('chirp')) return 'chirp'
  if (lower.includes('neural2')) return 'neural2'
  if (lower.includes('wavenet')) return 'wavenet'
  if (lower.includes('studio')) return 'studio'
  if (lower.includes('standard')) return 'standard'
  return 'other'
}

const QUALITY_RANK: Record<MappedTtsVoice['Quality'], number> = {
  chirp3: 0,
  chirp: 1,
  neural2: 2,
  wavenet: 3,
  studio: 4,
  standard: 5,
  other: 6,
}

export function languageCodeFromVoiceName(voiceName: string): string {
  const parts = voiceName.split('-')
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`
  return 'en-US'
}

function speakerFromVoiceName(name: string): string {
  const parts = name.split('-')
  return parts[parts.length - 1] || name
}

function friendlyLabel(voice: MappedTtsVoice): string {
  const lang = voice.Locale
  const quality =
    voice.Quality === 'chirp3'
      ? 'Chirp3 HD'
      : voice.Quality === 'chirp'
        ? 'Chirp HD'
        : voice.Quality === 'neural2'
          ? 'Neural2'
          : voice.Quality === 'wavenet'
            ? 'WaveNet'
            : voice.Quality === 'studio'
              ? 'Studio'
              : voice.Quality === 'standard'
                ? 'Standard'
                : 'Voice'
  const speaker = speakerFromVoiceName(voice.Name)
  const genderTr = voice.Gender === 'Female' ? 'Kız' : voice.Gender === 'Male' ? 'Erkek' : voice.Gender
  return `${lang} · ${quality} · ${speaker} (${genderTr})`
}

export function mapGcpVoice(voice: GcpVoice): MappedTtsVoice | null {
  const locale = voice.languageCodes?.[0]
  if (!locale || !voice.name) return null
  const gender =
    voice.ssmlGender === 'FEMALE' ? 'Female' : voice.ssmlGender === 'MALE' ? 'Male' : voice.ssmlGender || 'Neutral'
  const quality = voiceQuality(voice.name)
  const mapped: MappedTtsVoice = {
    Name: voice.name,
    Locale: locale,
    Gender: gender,
    Quality: quality,
    FriendlyName: '',
  }
  mapped.FriendlyName = friendlyLabel(mapped)
  return mapped
}

/**
 * Keep the best voices per locale so the UI stays usable.
 * Prefer Chirp3 HD preferred speakers; otherwise a few Neural2/WaveNet/Standard.
 */
export function curateMappedVoices(voices: MappedTtsVoice[], maxPerLocale = 8): MappedTtsVoice[] {
  const byLocale = new Map<string, MappedTtsVoice[]>()
  for (const voice of voices) {
    const list = byLocale.get(voice.Locale) || []
    list.push(voice)
    byLocale.set(voice.Locale, list)
  }

  const curated: MappedTtsVoice[] = []
  for (const [, list] of byLocale) {
    const sorted = [...list].sort((a, b) => {
      const q = QUALITY_RANK[a.Quality] - QUALITY_RANK[b.Quality]
      if (q !== 0) return q
      const aPref = PREFERRED_CHIRP3_SPEAKERS.indexOf(speakerFromVoiceName(a.Name) as (typeof PREFERRED_CHIRP3_SPEAKERS)[number])
      const bPref = PREFERRED_CHIRP3_SPEAKERS.indexOf(speakerFromVoiceName(b.Name) as (typeof PREFERRED_CHIRP3_SPEAKERS)[number])
      const ap = aPref === -1 ? 99 : aPref
      const bp = bPref === -1 ? 99 : bPref
      if (ap !== bp) return ap - bp
      return a.Name.localeCompare(b.Name)
    })

    const bestQuality = sorted[0]?.Quality
    let picked: MappedTtsVoice[]
    if (bestQuality === 'chirp3' || bestQuality === 'chirp') {
      const preferred = sorted.filter(v =>
        PREFERRED_CHIRP3_SPEAKERS.includes(speakerFromVoiceName(v.Name) as (typeof PREFERRED_CHIRP3_SPEAKERS)[number]),
      )
      picked = (preferred.length > 0 ? preferred : sorted).slice(0, maxPerLocale)
    } else {
      picked = sorted.slice(0, Math.min(4, maxPerLocale))
    }
    curated.push(...picked)
  }

  return curated.sort((a, b) => {
    const q = QUALITY_RANK[a.Quality] - QUALITY_RANK[b.Quality]
    if (q !== 0) return q
    return a.Locale.localeCompare(b.Locale) || a.Name.localeCompare(b.Name)
  })
}

export function pickBestVoiceForLocale(voices: MappedTtsVoice[], locale: string): MappedTtsVoice | null {
  const exact = voices.filter(v => v.Locale === locale)
  const prefix = locale.split('-')[0]
  const candidates = exact.length > 0 ? exact : voices.filter(v => v.Locale.startsWith(prefix))
  if (candidates.length === 0) return null
  return (
    [...candidates].sort((a, b) => {
      const q = QUALITY_RANK[a.Quality] - QUALITY_RANK[b.Quality]
      if (q !== 0) return q
      const aPref = PREFERRED_CHIRP3_SPEAKERS.indexOf(speakerFromVoiceName(a.Name) as (typeof PREFERRED_CHIRP3_SPEAKERS)[number])
      const bPref = PREFERRED_CHIRP3_SPEAKERS.indexOf(speakerFromVoiceName(b.Name) as (typeof PREFERRED_CHIRP3_SPEAKERS)[number])
      const ap = aPref === -1 ? 99 : aPref
      const bp = bPref === -1 ? 99 : bPref
      return ap - bp || a.Name.localeCompare(b.Name)
    })[0] || null
  )
}

/**
 * Lightweight script/character heuristics for page TTS language.
 * Not a full detector — good enough to pick a Google voice locale.
 */
export function detectSpeechLocale(text: string, fallbackLocale = 'en-US'): string {
  const sample = text.slice(0, 4000)
  if (!sample.trim()) return fallbackLocale

  const counts = {
    arabic: (sample.match(/[\u0600-\u06FF]/g) || []).length,
    cyrillic: (sample.match(/[\u0400-\u04FF]/g) || []).length,
    greek: (sample.match(/[\u0370-\u03FF]/g) || []).length,
    hebrew: (sample.match(/[\u0590-\u05FF]/g) || []).length,
    hiragana: (sample.match(/[\u3040-\u309F]/g) || []).length,
    katakana: (sample.match(/[\u30A0-\u30FF]/g) || []).length,
    hangul: (sample.match(/[\uAC00-\uD7AF]/g) || []).length,
    cjk: (sample.match(/[\u4E00-\u9FFF]/g) || []).length,
    latin: (sample.match(/[A-Za-zÀ-ÖØ-öø-ÿĞğÜüŞşİıÖöÇçÄäẞß]/g) || []).length,
  }

  const nonLatin = counts.arabic + counts.cyrillic + counts.greek + counts.hebrew + counts.hiragana + counts.katakana + counts.hangul + counts.cjk
  if (counts.arabic > 20 && counts.arabic >= nonLatin * 0.4) return 'ar-XA'
  if (counts.hebrew > 20 && counts.hebrew >= nonLatin * 0.4) return 'he-IL'
  if (counts.cyrillic > 20 && counts.cyrillic >= nonLatin * 0.4) return 'ru-RU'
  if (counts.greek > 20 && counts.greek >= nonLatin * 0.4) return 'el-GR'
  if (counts.hangul > 20) return 'ko-KR'
  if (counts.hiragana + counts.katakana > 10) return 'ja-JP'
  if (counts.cjk > 20) return 'cmn-CN'

  const trChars = (sample.match(/[ğüşıöçĞÜŞİÖÇ]/g) || []).length
  const deChars = (sample.match(/[äöüÄÖÜß]/g) || []).length
  const frChars = (sample.match(/[àâæçéèêëïîôœùûüÿÀÂÆÇÉÈÊËÏÎÔŒÙÛÜŸ]/g) || []).length
  const esChars = (sample.match(/[ñáéíóúü¿¡ÑÁÉÍÓÚÜ]/g) || []).length

  if (trChars >= 3) return 'tr-TR'
  if (deChars >= 3 && deChars >= frChars) return 'de-DE'
  if (frChars >= 4 && frChars > esChars) return 'fr-FR'
  if (esChars >= 4) return 'es-ES'

  // Common Turkish function words without diacritics
  const lower = sample.toLowerCase()
  const trHits = (lower.match(/\b(ve|bir|bu|için|ile|olan|olarak|daha|çok|gibi|ama|değil|kadar|sonra|önce)\b/g) || []).length
  const enHits = (lower.match(/\b(the|and|of|to|in|is|that|for|with|as|was|are|this|from|by|which|have|been|not|you|your|their|would|could|should|about)\b/g) || []).length
  const deHits = (lower.match(/\b(der|die|das|und|ist|nicht|ein|eine|mit|auf|für|den|dem)\b/g) || []).length
  // Short chunks: even 2 strong hits are enough to switch language.
  const minHits = sample.length < 120 ? 2 : 4
  if (trHits >= minHits && trHits >= enHits && trHits >= deHits) return 'tr-TR'
  if (deHits >= minHits && deHits > enHits) return 'de-DE'
  if (enHits >= minHits) return 'en-US'

  return fallbackLocale
}

export function resolveAutoGcpVoice(
  voices: MappedTtsVoice[],
  text: string,
  uiLang: string,
): MappedTtsVoice | null {
  const fallback = uiLanguageToLocale(uiLang)
  const detected = detectSpeechLocale(text, fallback)
  return pickBestVoiceForLocale(voices, detected) || pickBestVoiceForLocale(voices, fallback)
}

/** Prefer short sentence chunks so the first audio can start quickly. */
export function splitTtsChunks(text: string, maxChars = 220): string[] {
  const normalized = joinHyphenatedBreaks(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const sentences = normalized.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [normalized]
  const chunks: string[] = []
  let current = ''

  const pushCurrent = () => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }

  for (const sentence of sentences) {
    const piece = sentence.trim()
    if (!piece) continue
    if (piece.length > maxChars) {
      pushCurrent()
      let rest = piece
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(' ', maxChars)
        if (cut < maxChars * 0.4) cut = maxChars
        chunks.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest) current = rest
      continue
    }
    if (!current) {
      current = piece
      continue
    }
    if (`${current} ${piece}`.length <= maxChars) {
      current = `${current} ${piece}`
    } else {
      pushCurrent()
      current = piece
    }
  }
  pushCurrent()
  return chunks
}

/** Join PDF line-break hyphenation: "kelime-\\nsi" -> "kelimesi". */
export function joinHyphenatedBreaks(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/(\p{L})(?:\u00AD|‐|-)\s*\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/(\p{L})(?:\u00AD|‐|-)\s+(\p{Ll})/gu, '$1$2')
}

export type TtsSpanBox = {
  text: string
  left: number
  top: number
  width: number
  height: number
  key: number
}

export type TtsWordUnit = {
  text: string
  normalized: string
  spanKeys: number[]
}

/**
 * Build reading-order text from positioned PDF.js spans (same idea as RSVP).
 * Keeps span keys so hyphen-joined words can highlight every visual fragment.
 */
export function buildReadingOrderUnits(spans: TtsSpanBox[]): TtsWordUnit[] {
  const usable = spans
    .map(span => ({ ...span, text: span.text.replace(/\u00AD/g, '') }))
    .filter(span => span.text.trim() && span.width > 0 && span.height > 0)
    .sort((a, b) => (Math.abs(a.top - b.top) > 3 ? a.top - b.top : a.left - b.left))

  const lines: TtsSpanBox[][] = []
  for (const span of usable) {
    const line = lines.find(items => Math.abs(items[0].top - span.top) <= Math.max(4, span.height * 0.35))
    if (line) line.push(span)
    else lines.push([span])
  }

  const rawParts: { text: string; spanKey: number }[] = []
  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.left - b.left)
    for (let index = 0; index < sorted.length; index += 1) {
      const item = sorted[index]
      const previous = sorted[index - 1]
      let piece = item.text
      if (index > 0 && previous) {
        const gap = item.left - (previous.left + previous.width)
        const isTurkishDiacritic = /^[şğışçöüŞĞİŞÇÖÜ]/u.test(item.text)
        const gapThreshold = isTurkishDiacritic ? Math.max(3.2, previous.height * 0.28) : Math.max(1.5, previous.height * 0.15)
        const needsSpace =
          gap > gapThreshold
          && !/[\s([{'"“‘\-‐]$/u.test(previous.text)
          && !/^[,.;:!?%)\]}'"”’]/u.test(item.text)
        if (needsSpace) piece = ` ${piece}`
      } else if (rawParts.length > 0) {
        piece = ` ${piece}`
      }
      rawParts.push({ text: piece, spanKey: item.key })
    }
  }

  const joined = repairTurkishWordSpacing(joinHyphenatedBreaks(rawParts.map(part => part.text).join('')))
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .trim()

  // Rebuild word units by walking original parts and merging hyphen tails.
  const units: TtsWordUnit[] = []
  let pending: TtsWordUnit | null = null

  const flush = () => {
    if (!pending) return
    const normalized = normalizeTtsToken(pending.text)
    if (normalized) units.push({ ...pending, text: pending.text.trim(), normalized })
    pending = null
  }

  for (const part of rawParts) {
    const cleaned = part.text.replace(/[\u00AD]/g, '')
    const tokens = cleaned.match(/[^\s]+|\s+/g) || []
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        // Keep hyphenated line-break tails open: "kelime-" + " si" should still join.
        if (pending && /(?:\u00AD|‐|-)$/u.test(pending.text)) continue
        flush()
        continue
      }
      const softJoin = pending && /(?:\u00AD|‐|-)$/u.test(pending.text) && /^\p{Ll}/u.test(token)
      if (softJoin && pending) {
        pending = {
          text: pending.text.replace(/(?:\u00AD|‐|-)$/u, '') + token,
          normalized: '',
          spanKeys: [...pending.spanKeys, part.spanKey],
        }
        continue
      }
      if (pending) flush()
      pending = { text: token, normalized: '', spanKeys: [part.spanKey] }
    }
  }
  flush()

  // If geometry walk failed, fall back to plain joined text tokens.
  if (units.length === 0 && joined) {
    for (const token of tokenizeTtsWords(joined)) {
      const normalized = normalizeTtsToken(token)
      if (!normalized) continue
      units.push({ text: token, normalized, spanKeys: [] })
    }
  }
  return units
}

export function splitWordUnitsIntoChunks(
  units: TtsWordUnit[],
  maxChars = 350,
): { text: string; startWord: number; endWord: number }[] {
  if (units.length === 0) return []
  const chunks: { text: string; startWord: number; endWord: number }[] = []
  let start = 0
  while (start < units.length) {
    let end = start
    let text = units[start].text
    while (end + 1 < units.length) {
      const nextWord = units[end + 1].text
      const candidate = `${text} ${nextWord}`
      const isSentenceEnd = /[.!?:]+$/.test(units[end].text)

      if (isSentenceEnd && text.length >= 60) {
        break
      }
      if (candidate.length > maxChars && (isSentenceEnd || text.length >= Math.min(20, maxChars))) {
        break
      }
      if (candidate.length > maxChars + 180) {
        break
      }

      end += 1
      text = candidate
    }
    chunks.push({ text, startWord: start, endWord: end })
    start = end + 1
  }
  return chunks
}

/** Map a preferred voice onto another locale while keeping the same speaker when possible. */
export function mapVoiceToLocale(
  voices: MappedTtsVoice[],
  preferredVoiceName: string,
  locale: string,
): string {
  if (languageCodeFromVoiceName(preferredVoiceName) === locale) return preferredVoiceName
  const speaker = preferredVoiceName.split('-').pop() || ''
  const quality = voiceQuality(preferredVoiceName)
  const sameSpeaker = voices.find(v => (
    v.Locale === locale
    && v.Quality === quality
    && v.Name.endsWith(`-${speaker}`)
  ))
  if (sameSpeaker) return sameSpeaker.Name
  return pickBestVoiceForLocale(voices, locale)?.Name || preferredVoiceName
}

export function resolveChunkVoice(
  voices: MappedTtsVoice[],
  chunkText: string,
  preferredVoiceName: string,
  uiLang: string,
): string {
  const fallback = languageCodeFromVoiceName(preferredVoiceName) || uiLanguageToLocale(uiLang)
  const detected = detectSpeechLocale(chunkText, fallback)
  return mapVoiceToLocale(voices, preferredVoiceName, detected)
}

function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const ENGLISH_CONTENT_WORDS = new Set([
  'the', 'and', 'with', 'from', 'this', 'that', 'have', 'will', 'your', 'what', 'when', 'which',
  'about', 'would', 'could', 'should', 'there', 'their', 'these', 'those', 'where', 'while',
  'because', 'through', 'between', 'without', 'another', 'system', 'algorithm', 'function',
  'computer', 'software', 'hardware', 'network', 'internet', 'science', 'university', 'research',
])

/** Guess a better locale for an individual token inside a base-language chunk. */
export function guessTokenLocale(token: string, baseLocale: string): string | null {
  const bare = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (bare.length < 3) return null
  if (/[\u0600-\u06FF]/.test(bare)) return 'ar-XA'
  if (/[\u0400-\u04FF]/.test(bare)) return 'ru-RU'
  if (/[\u0370-\u03FF]/.test(bare)) return 'el-GR'
  if (/[\u3040-\u30FF]/.test(bare)) return 'ja-JP'
  if (/[\uAC00-\uD7AF]/.test(bare)) return 'ko-KR'
  if (/[\u4E00-\u9FFF]/.test(bare)) return 'cmn-CN'
  if (/[ğüşıöçĞÜŞİÖÇ]/.test(bare)) return 'tr-TR'
  if (/[äöüßÄÖÜ]/.test(bare) && !baseLocale.startsWith('de')) return 'de-DE'
  if (/[àâæçéèêëïîôùûüÿ]/i.test(bare) && !baseLocale.startsWith('fr') && !baseLocale.startsWith('tr')) return 'fr-FR'

  if (baseLocale.startsWith('tr') && /^[A-Za-z]{4,}$/.test(bare)) {
    const lower = bare.toLowerCase()
    if (ENGLISH_CONTENT_WORDS.has(lower)) return 'en-US'
    if (/(tion|sion|ment|ness|ity|ous|ical|able|ence|ance|ology|ography)$/i.test(bare)) return 'en-US'
  }
  return null
}

/**
 * Build SSML that switches Chirp/Neural voices for clearly foreign tokens.
 * Returns null when the whole chunk can stay on the base voice.
 */
export function buildChunkSsml(
  text: string,
  baseVoice: string,
  voices: MappedTtsVoice[],
): string | null {
  const baseLocale = languageCodeFromVoiceName(baseVoice)
  const parts = text.match(/\S+|\s+/g) || []
  let needsSwitch = false
  let body = ''
  for (const part of parts) {
    if (/^\s+$/.test(part)) {
      body += part
      continue
    }
    const guessed = guessTokenLocale(part, baseLocale)
    if (!guessed || guessed === baseLocale) {
      body += escapeSsml(part)
      continue
    }
    const voiceName = mapVoiceToLocale(voices, baseVoice, guessed)
    if (voiceName === baseVoice) {
      body += escapeSsml(part)
      continue
    }
    needsSwitch = true
    body += `<voice name="${voiceName}">${escapeSsml(part)}</voice>`
  }
  if (!needsSwitch) return null
  return `<speak>${body}</speak>`
}

export function tokenizeTtsWords(text: string): string[] {
  return text.match(/[^\s]+/g) || []
}

export function findPhraseStartIndex(words: string[], phrase: string): number {
  const needle = tokenizeTtsWords(joinHyphenatedBreaks(phrase))
    .map(token => normalizeTtsToken(token))
    .filter(Boolean)
  if (needle.length === 0 || words.length === 0) return 0
  const hay = words.map(token => normalizeTtsToken(token))
  for (let i = 0; i <= hay.length - needle.length; i += 1) {
    let matched = true
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j] && !tokensMatch(needle[j], hay[i + j])) {
        matched = false
        break
      }
    }
    if (matched) return i
  }
  const single = findNextPageTokenIndex(hay, 0, needle[0], Math.max(24, hay.length))
  return single >= 0 ? single : 0
}

export type TtsStartMode = 'page-start' | 'selection' | 'viewport'

export function resolveStartWordIndex(
  words: string[],
  mode: TtsStartMode,
  options?: { selectedText?: string; viewportIndex?: number },
): number {
  if (words.length === 0) return 0
  if (mode === 'selection' && options?.selectedText?.trim()) {
    return findPhraseStartIndex(words, options.selectedText)
  }
  if (mode === 'viewport' && typeof options?.viewportIndex === 'number' && options.viewportIndex >= 0) {
    return Math.min(options.viewportIndex, words.length - 1)
  }
  return 0
}

/** Strip punctuation so spoken tokens can match PDF text-layer tokens. */
export function normalizeTtsToken(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function tokensMatch(spoken: string, page: string): boolean {
  if (!spoken || !page) return false
  if (spoken === page) return true
  // Only allow prefix matches for longer tokens so "ve"/"a" do not latch onto unrelated words.
  if (Math.min(spoken.length, page.length) < 3) return false
  return spoken.startsWith(page) || page.startsWith(spoken)
}

/**
 * Advance through page tokens in reading order only — never wrap to earlier words.
 * Returns the matched page index, or -1 when no forward match exists in the window.
 */
export function findNextPageTokenIndex(
  pageTokens: string[],
  fromIndex: number,
  spokenToken: string,
  lookahead = 16,
): number {
  const needle = normalizeTtsToken(spokenToken)
  if (!needle || pageTokens.length === 0) return -1
  const start = Math.max(0, Math.min(fromIndex, pageTokens.length))
  const end = Math.min(pageTokens.length, start + Math.max(1, lookahead))
  for (let i = start; i < end; i += 1) {
    if (tokensMatch(needle, pageTokens[i])) return i
  }
  return -1
}

/** Map audio progress (0–1) to the active word index inside a chunk. */
export function wordIndexAtProgress(wordCount: number, progress: number): number {
  if (wordCount <= 0) return -1
  const clamped = Math.max(0, Math.min(0.999, progress))
  return Math.min(wordCount - 1, Math.floor(clamped * wordCount))
}

export function setupMediaSession(
  metadata: { title: string; author?: string; artworkUrl?: string },
  handlers: { onPlay?: () => void; onPause?: () => void }
) {
  if (typeof window === 'undefined' || !('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: metadata.title,
    artist: metadata.author || 'Dijital Kütüphane',
    album: 'Sesli Okuma',
    artwork: metadata.artworkUrl ? [{ src: metadata.artworkUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
  })

  if (handlers.onPlay) navigator.mediaSession.setActionHandler('play', handlers.onPlay)
  if (handlers.onPause) navigator.mediaSession.setActionHandler('pause', handlers.onPause)
}

export function startSleepTimer(minutes: number, onExpire: () => void): () => void {
  const ms = minutes * 60 * 1000
  const timeoutId = setTimeout(onExpire, ms)
  return () => clearTimeout(timeoutId)
}
