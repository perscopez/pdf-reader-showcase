const REPLACEMENTS: Array<[string, string]> = [
  ['Ã‡', 'Ç'],
  ['Ã§', 'ç'],
  ['Äž', 'Ğ'],
  ['ÄŸ', 'ğ'],
  ['Ä°', 'İ'],
  ['Ä±', 'ı'],
  ['Ã–', 'Ö'],
  ['Ã¶', 'ö'],
  ['Åž', 'Ş'],
  ['ÅŸ', 'ş'],
  ['Ãœ', 'Ü'],
  ['Ã¼', 'ü'],
  ['Ã¡', 'á'],
  ['Ã ', 'à'],
  ['Ã¢', 'â'],
  ['Ã¤', 'ä'],
  ['Ã©', 'é'],
  ['Ã¨', 'è'],
  ['Ãª', 'ê'],
  ['Ã«', 'ë'],
  ['Ã­', 'í'],
  ['Ã¬', 'ì'],
  ['Ã®', 'î'],
  ['Ã¯', 'ï'],
  ['Ã³', 'ó'],
  ['Ã²', 'ò'],
  ['Ã´', 'ô'],
  ['Ãµ', 'õ'],
  ['Ãº', 'ú'],
  ['Ã¹', 'ù'],
  ['Ã»', 'û'],
  ['Ã±', 'ñ'],
  ['ÃŸ', 'ß'],
  ['Ã—', '×'],
  ['Ã·', '÷'],
  ['â€™', "'"],
  ['â€˜', "'"],
  ['â€œ', '"'],
  ['â€ ', '"'],
  ['â€“', '-'],
  ['â€”', '-'],
  ['â€¦', '...'],
  ['Â', ''],
]

export function cleanText(value: unknown) {
  if (typeof value !== 'string') return ''

  let next = value
  for (const [bad, good] of REPLACEMENTS) {
    next = next.split(bad).join(good)
  }

  return next.normalize('NFC')
}

export function cleanTextDeep<T>(value: T): T {
  if (typeof value === 'string') return cleanText(value) as T
  if (Array.isArray(value)) return value.map(item => cleanTextDeep(item)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cleanTextDeep(item)])
    ) as T
  }

  return value
}

/**
 * Applies character-level cleanup that is safe without layout information.
 *
 * Word-boundary repair belongs in the geometry-aware PDF text model. A plain
 * string cannot distinguish a fragmented glyph from valid Turkish phrases such
 * as "bir şey" or "bu şekilde", so this function must never join tokens.
 */
export function repairTurkishWordSpacing(text: string): string {
  if (!text) return ''
  return cleanText(text)
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
}

const TURKISH_WRAPPED_SUFFIXES = new Set([
  'm', 'n', 'k',
  'ım', 'im', 'um', 'üm', 'ın', 'in', 'un', 'ün', 'ız', 'iz', 'uz', 'üz',
  'sın', 'sin', 'sun', 'sün', 'sınız', 'siniz', 'sunuz', 'sünüz',
  'lar', 'ler', 'lık', 'lik', 'luk', 'lük', 'cı', 'ci', 'cu', 'cü', 'çı', 'çi', 'çu', 'çü',
  'dır', 'dir', 'dur', 'dür', 'tır', 'tir', 'tur', 'tür',
  'mış', 'miş', 'muş', 'müş', 'acak', 'ecek', 'yor',
  'dan', 'den', 'tan', 'ten', 'da', 'de', 'ta', 'te',
  'ya', 'ye', 'a', 'e',
])

/**
 * Reflows one explicit visual line break. Unlike the old whole-string regex,
 * this can only join a small allowlist of Turkish suffix fragments at an
 * observed line boundary.
 */
export function joinWrappedTextLines(left: string, right: string): string {
  const cleanLeft = left.trimEnd()
  const cleanRight = right.trimStart()
  if (!cleanLeft) return cleanRight
  if (!cleanRight) return cleanLeft
  if (/\p{L}-$/u.test(cleanLeft) && /^\p{Ll}/u.test(cleanRight)) {
    return `${cleanLeft.slice(0, -1)}${cleanRight}`
  }

  const suffix = /^\p{Ll}+/u.exec(cleanRight)?.[0]?.toLocaleLowerCase('tr-TR') || ''
  const stem = /\p{L}+$/u.exec(cleanLeft)?.[0] || ''
  if (
    stem.length >= 3
    && suffix
    && TURKISH_WRAPPED_SUFFIXES.has(suffix)
    && !/[.!?…:;]$/.test(cleanLeft)
  ) {
    return `${cleanLeft}${cleanRight}`
  }
  return `${cleanLeft} ${cleanRight}`.replace(/\s+/g, ' ').trim()
}

// Returns true if a string looks like garbled/CID-encoded text
export function isGarbledToken(token: string): boolean {
  if (token.length < 4) return false
  const letters = (token.match(/\p{L}/gu) || []).length
  if (letters === 0) {
    const digits = (token.match(/\p{N}/gu) || []).length
    if (digits === 0) {
      const first = token[0]
      const isRepeating = token.split('').every(c => c === first)
      return !isRepeating
    }
    return false
  }
  const vowels = (token.match(/[aeıioöuüAEIİOÖUÜaeiouáéíóúàèìòùâêîôûäëïöüãõ]/gi) || []).length
  const vowelRatio = vowels / letters
  const nonLetterDigit = (token.match(/[^\p{L}\p{N}]/gu) || []).length
  const nonRatio = nonLetterDigit / token.length
  return (letters > 6 && vowelRatio < 0.08) || nonRatio > 0.6
}

// Checks if a text string is mostly garbled (indicates corrupted font encoding)
export function isTextMostlyGarbled(text: string): boolean {
  if (!text || text.trim().length === 0) return false
  const tokens = text.split(/\s+/).filter(t => t.length >= 4)
  if (tokens.length === 0) return false
  let garbledCount = 0
  for (const token of tokens) {
    if (isGarbledToken(token)) {
      garbledCount++
    }
  }
  return (garbledCount / tokens.length) > 0.35
}
