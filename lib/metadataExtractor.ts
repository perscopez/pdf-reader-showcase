import { cleanText } from './text'

export interface ExtractedMetadata {
  isbn?: string
  doi?: string
  year?: number
  language?: string
  title?: string
  author?: string
}

/**
 * Aggressively cleans a raw filename or title string into a human-readable
 * book title or author name.
 */
export function formatBookString(str: string): string {
  if (!str) return ''
  let s = cleanText(str)

  // Strip file extensions
  s = s.replace(/\.(pdf|epub|mobi|azw3|txt|djvu)$/i, '')

  // Strip [...] blocks
  s = s.replace(/^\[.*?\]\s*/, '')
  s = s.replace(/\[.*?\]/g, ' ')

  // Strip Anna's Archive full suffix chain: -- anything -- hex -- Anna_s_Archive
  // This handles the entire metadata chain at once
  s = s.replace(/\s*--\s*(?:[^-]+--)*.+--\s*Anna_?s?_?Archive\s*$/gi, '')
  // Strip simpler patterns: -- 16+ char hex -- Anna's Archive
  s = s.replace(/\s*--\s*[0-9a-f]{16,}\s*--\s*Anna_?s?_?Archive\s*$/gi, '')
  // Strip just Anna's Archive at end
  s = s.replace(/\s*--?\s*Anna_?s?_?Archive\.?\s*$/gi, '')

  // Now parse -- separated segments: first is title/author, rest is metadata junk
  // Pattern: "TITLE -- AUTHOR -- Publisher -- Year -- ISBN -- hash"
  const doubleDashParts = s.split(/\s*--\s*/).filter(Boolean)
  if (doubleDashParts.length >= 2) {
    // Keep only first part (title) and second part (author) if it looks like an author name
    const titlePart = doubleDashParts[0].trim()
    const secondPart = doubleDashParts[1].trim()

    // Check if second part is a hex hash or junk (not an author)
    const isHash = /^[0-9a-f]{16,}$/i.test(secondPart.replace(/[_\s]/g, ''))
    const isPublisher = /Publisher|Yay_n|Bas_m|LLC|Inc|Press|Books|Kitap|Random_House|Verso|Kronik|Hiperlink|Newtokrasi|KorPiracy|isbn/i.test(secondPart)
    const isYear = /^(19|20)\d{2}$/.test(secondPart.replace(/[_\s]/g, ''))

    if (!isHash && !isPublisher && !isYear && secondPart.length > 2 && secondPart.length < 60) {
      // Second part looks like an author name, keep it
      s = `${titlePart} - ${secondPart}`
    } else {
      s = titlePart
    }
  }

  // Strip PDFDrive tags
  s = s.replace(/\(?PDFDrive\.com\)?/gi, '')
  s = s.replace(/\(?PDFDrive\)?/gi, '')
  s = s.replace(/\(z-lib\.org\)/gi, '')

  // Strip leading timestamp-hash patterns: 1777390975528-abc123-
  s = s.replace(/^\d{10,}-[a-z0-9]{4,}-/i, '')

  // Strip leading ISBN
  s = s.replace(/^(978[0-9]{10}|[0-9]{9}[0-9X])[\s_-]+/i, '')

  // Strip leading sequence numbers
  s = s.replace(/^\d{1,10}[-_\s]+/, '')

  // Replace underscores with spaces
  s = s.replace(/_/g, ' ')

  // Replace hyphens with spaces (these are word separators in filenames)
  s = s.replace(/-/g, ' ')

  // Strip "dokumen.pub" prefix
  s = s.replace(/^dokumen\.pub\s*/i, '')

  // Strip ".com" remnants
  s = s.replace(/\.com/gi, '')

  // Strip dots between words (e.g. "Crone.Patricia" -> "Crone Patricia")
  s = s.replace(/\.(?=[A-Za-z])/g, ' ')
  // Strip trailing dots
  s = s.replace(/\.\s*$/, '')

  // Strip edition markers
  s = s.replace(/\(?(\d+(?:st|nd|rd|th)\s*(?:ed|edition))\)?/gi, '')

  // Strip year patterns
  s = s.replace(/\(?(?:19|20)\d{2}\)?/g, '')

  // Strip "min" at end (minified indicator)
  s = s.replace(/\bmin\s*$/i, '')

  // Strip "edd" at end (editor indicator junk)
  s = s.replace(/\bedd\b/gi, '')

  // Strip single letters that are filename junk (like "y", "F", "N", "M" standing alone)
  s = s.replace(/\b[A-Z]\b(?=\s)/g, '')

  // Strip ISBN patterns inline
  s = s.replace(/\bisbn\d*\s*\d*\b/gi, '')
  s = s.replace(/\b97[89]\d{10}\b/g, '')
  s = s.replace(/\b\d{9}[0-9X]\b/g, '')

  // Common Turkish character fixes
  s = s
    .replace(/\bSuc\b/gi, 'Suç')
    .replace(/\bBaris\b/gi, 'Barış')
    .replace(/\bSavas\b/gi, 'Savaş')
    .replace(/\bDonusum\b/gi, 'Dönüşüm')
    .replace(/\bSimyaci\b/gi, 'Simyacı')
    .replace(/\bSatranc\b/gi, 'Satranç')

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()

  // Strip leading/trailing hyphens, dots, dashes
  s = s.replace(/^[-.\s]+|[-.\s]+$/g, '').trim()

  if (!s || s.length < 2) return ''

  // Title case if ALL CAPS or all lowercase
  if (s === s.toUpperCase() || s === s.toLowerCase()) {
    s = toTitleCase(s)
  } else {
    s = s.charAt(0).toUpperCase() + s.slice(1)
  }

  return s
}

function toTitleCase(str: string): string {
  const minorWords = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to',
    'by', 'in', 'of', 'up', 'as', 'is', 'it', 'if',
    've', 'bir', 'da', 'de', 'ile', 'için',
  ])
  return str.split(' ').map((word, i) => {
    if (!word) return ''
    const lower = word.toLowerCase()
    if (i > 0 && minorWords.has(lower)) return lower
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

/**
 * Parses a -- separated filename to extract author from the second segment.
 * Returns the raw author string before formatBookString is applied.
 */
function extractAuthorFromDoubleDash(raw: string): string | undefined {
  const parts = raw.split(/\s*--\s*/).filter(Boolean)
  if (parts.length < 2) return undefined

  let candidate = parts[1].trim()
  // Skip if it's a hash, publisher, year, or too short
  const isHash = /^[0-9a-f]{16,}$/i.test(candidate.replace(/[_\s]/g, ''))
  const isPublisher = /Publisher|Yay_n|Bas_m|LLC|Inc|Press|Books|Kitap|Random_House|Verso|Kronik|Hiperlink|Newtokrasi|KorPiracy|isbn/i.test(candidate)
  const isYear = /^(19|20)\d{2}$/.test(candidate.replace(/[_\s]/g, ''))

  if (isHash || isPublisher || isYear || candidate.length < 3) return undefined

  // Clean underscores, extra spaces
  candidate = candidate.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return candidate
}

/**
 * Parses filename to extract Author and Title using common patterns.
 */
export function parseFilenameMetadata(filename: string): ExtractedMetadata {
  const result: ExtractedMetadata = {}

  // Extract ISBN from raw filename before cleaning
  const isbnFromFile = extractIsbn(filename)
  if (isbnFromFile) result.isbn = isbnFromFile

  // Try extracting author from raw -- pattern before cleaning destroys it
  let rawNoExt = filename.replace(/\.(pdf|epub)$/i, '')
  // Strip leading timestamp-hash
  rawNoExt = rawNoExt.replace(/^\d{10,}-[a-z0-9]{4,}-/i, '')
  // Strip leading sequence numbers
  rawNoExt = rawNoExt.replace(/^\d{1,10}[-_\s]+/, '')

  const rawAuthor = extractAuthorFromDoubleDash(rawNoExt)

  // Clean the title
  const cleaned = formatBookString(filename)
  if (!cleaned || cleaned.length < 2) return result

  // If the cleaned result has " - " (from Author - Title), parse it
  if (cleaned.includes(' - ')) {
    const parts = cleaned.split(' - ').map(s => s.trim()).filter(Boolean)
    if (parts.length >= 2 && parts[0].length > 2 && parts[1].length > 2) {
      // For -- separated files, first part is title, author comes from rawAuthor
      if (rawAuthor) {
        // The " - " was inserted by formatBookString from the -- separator
        result.title = parts[0]
        result.author = formatBookString(rawAuthor)
      } else {
        // Traditional "Author - Title" filename pattern
        result.author = parts[0]
        result.title = parts.slice(1).join(' - ')
      }
      return result
    }
  }

  // If we have a raw author from -- parsing, use it
  if (rawAuthor) {
    result.author = formatBookString(rawAuthor)
    // Title is the cleaned string without the author part
    result.title = cleaned
    return result
  }

  // Try "Title by Author" pattern
  if (/\sby\s/i.test(cleaned)) {
    const parts = cleaned.split(/\sby\s/i).map(s => s.trim())
    if (parts.length >= 2 && parts[0].length > 2 && parts[1].length > 2) {
      result.title = parts[0]
      result.author = parts[1]
      return result
    }
  }

  // Just a clean title
  result.title = cleaned
  return result
}

/**
 * Extracts ISBN from raw text using common patterns.
 */
function extractIsbn(text: string): string | undefined {
  const isbn13 = text.match(/\b(97[89]\d{10})\b/)
  if (isbn13) return isbn13[1]

  const isbnSep = text.match(/\bISBN[-:]?\s*([\d-]{10,17}X?)\b/i)
  if (isbnSep) return isbnSep[1].replace(/[-\s]/g, '')

  const isbnField = text.match(/isbn13[_\s]+(97[89]\d{10})/i)
  if (isbnField) return isbnField[1]

  return undefined
}

export function extractMetadataFromText(text: string, filename?: string): ExtractedMetadata {
  const result: ExtractedMetadata = {}

  if (filename) {
    const fnMeta = parseFilenameMetadata(filename)
    if (fnMeta.title) result.title = fnMeta.title
    if (fnMeta.author) result.author = fnMeta.author
    if (fnMeta.isbn) result.isbn = fnMeta.isbn
  }

  // ISBN from text body
  if (!result.isbn) {
    const isbnFromText = extractIsbn(text)
    if (isbnFromText) result.isbn = isbnFromText
  }

  const doi = text.match(/\b10\.\d{4,9}\/[\w.!#$%&'*+/=?^_`{|}~-]+/i)?.[0]?.replace(/[.,;:)]+$/, '')
  if (doi) result.doi = doi.toLowerCase()
  const year = text.match(/\b((?:18|19|20|21)\d{2})\b/)?.[1]
  if (year) result.year = Number(year)

  // Language Detection
  const sample = text.slice(0, 5000).toLowerCase()
  if (sample.length > 50) {
    const trScore = (sample.match(/\b(ve|bir|bu|da|de|için|ile|olarak|var|yok|şimdi|çok|daha|kadar)\b/g) || []).length
    const enScore = (sample.match(/\b(the|and|is|in|it|you|that|was|for|on|are|with|as|this)\b/g) || []).length
    const deScore = (sample.match(/\b(der|die|das|und|ist|den|von|mit|sich|des|auf|für)\b/g) || []).length
    const frScore = (sample.match(/\b(le|la|les|de|et|un|une|est|dans|en|du|par|sur|pour)\b/g) || []).length

    const scores = [
      { lang: 'tr', score: trScore },
      { lang: 'en', score: enScore },
      { lang: 'de', score: deScore },
      { lang: 'fr', score: frScore },
    ].sort((a, b) => b.score - a.score)

    if (scores[0].score > 3) {
      result.language = scores[0].lang
    }
  }

  // Header text parsing for Author / Title lines if still missing
  const lines = text.slice(0, 2000).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const authorMatch = line.match(/^(?:Yazar|Author|Writer):\s*(.+)$/i)
    if (authorMatch && !result.author) {
      result.author = formatBookString(authorMatch[1])
    }
    const titleMatch = line.match(/^(?:Başlık|Title|Eser):\s*(.+)$/i)
    if (titleMatch && !result.title) {
      result.title = formatBookString(titleMatch[1])
    }
  }

  return result
}
