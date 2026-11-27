import { describe, it, expect } from 'vitest'
import { cleanText, cleanTextDeep, isGarbledToken, isTextMostlyGarbled, joinWrappedTextLines, repairTurkishWordSpacing } from '@/lib/text'

describe('cleanText', () => {
  it('should return empty string for non-string input', () => {
    expect(cleanText(undefined)).toBe('')
    expect(cleanText(null)).toBe('')
    expect(cleanText(123)).toBe('')
    expect(cleanText({})).toBe('')
  })

  it('should fix common mojibake Turkish characters', () => {
    expect(cleanText('Ã‡')).toBe('Ç')
    expect(cleanText('Ã§')).toBe('ç')
    expect(cleanText('Äž')).toBe('Ğ')
    expect(cleanText('ÄŸ')).toBe('ğ')
    expect(cleanText('Ä°')).toBe('İ')
    expect(cleanText('Ä±')).toBe('ı')
    expect(cleanText('Ã–')).toBe('Ö')
    expect(cleanText('Ã¶')).toBe('ö')
    expect(cleanText('Åž')).toBe('Ş')
    expect(cleanText('ÅŸ')).toBe('ş')
    expect(cleanText('Ãœ')).toBe('Ü')
    expect(cleanText('Ã¼')).toBe('ü')
  })

  it('should fix mojibake accented characters', () => {
    expect(cleanText('Ã©')).toBe('é')
    expect(cleanText('Ã¡')).toBe('á')
    expect(cleanText('Ã±')).toBe('ñ')
    expect(cleanText('ÃŸ')).toBe('ß')
  })

  it('should fix mojibake punctuation', () => {
    // Each input is the raw UTF-8 byte sequence as it appears in mojibake
    expect(cleanText('\u00e2\u20ac\u2122')).toBe("'")
    expect(cleanText('\u00e2\u20ac\u0153')).toBe('"')
    expect(cleanText('\u00e2\u20ac\u201c')).toBe('-')
    expect(cleanText('\u00e2\u20ac\u00a6')).toBe('...')
  })

  it('should remove stray Â characters', () => {
    expect(cleanText('Â')).toBe('')
  })

  it('should handle full Turkish sentences', () => {
    const input = 'TÃ¼rkÃ§e karakter testi: Ä°stanbul, ÅŸofÃ¶r, Ã§Ã¶zÃ¼m'
    const expected = 'Türkçe karakter testi: İstanbul, şoför, çözüm'
    expect(cleanText(input)).toBe(expected)
  })

  it('should normalize NFC', () => {
    const composed = 'ç'
    const decomposed = 'c\u0327'
    expect(cleanText(composed)).toBe('ç')
    expect(cleanText(decomposed)).toBe('ç')
  })

  it('should return empty string for empty input', () => {
    expect(cleanText('')).toBe('')
  })
})

describe('cleanTextDeep', () => {
  it('should clean string values in nested objects', () => {
    const input = {
      title: 'TÃ¼rkÃ§e Kitap',
      author: 'Yazar Ä°smi',
      tags: ['Ã§Ã¶zÃ¼m', 'ÅŸifre'],
      meta: { description: 'Ã–zet metin' },
    }
    const result = cleanTextDeep(input)
    expect(result.title).toBe('Türkçe Kitap')
    expect(result.author).toBe('Yazar İsmi')
    expect(result.tags).toEqual(['çözüm', 'şifre'])
    expect(result.meta.description).toBe('Özet metin')
  })

  it('should clean arrays', () => {
    const input = ['Ã‡atal', 'KÃ¶pek', 'Åžehir']
    const result = cleanTextDeep(input)
    expect(result).toEqual(['Çatal', 'Köpek', 'Şehir'])
  })

  it('should handle null/undefined in objects', () => {
    const result = cleanTextDeep({ a: null, b: undefined, c: 'Ã–' })
    expect(result.a).toBeNull()
    expect(result.b).toBeUndefined()
    expect(result.c).toBe('Ö')
  })
})

describe('isGarbledToken', () => {
  it('should return false for short words', () => {
    expect(isGarbledToken('abc')).toBe(false)
    expect(isGarbledToken('kit')).toBe(false)
  })

  it('should return false for normal Turkish and English words', () => {
    expect(isGarbledToken('kütüphane')).toBe(false)
    expect(isGarbledToken('bilgisayar')).toBe(false)
    expect(isGarbledToken('reading')).toBe(false)
    expect(isGarbledToken('document')).toBe(false)
  })

  it('should return true for garbled CID/CMap tokens', () => {
    expect(isGarbledToken('($jt()!|)')).toBe(true)
    expect(isGarbledToken('^£$!@#%')).toBe(true)
    expect(isGarbledToken('xzqrstplk')).toBe(true) // no vowels, letters > 6
  })
})

describe('isTextMostlyGarbled', () => {
  it('should return false for normal readable text', () => {
    const text = 'Bu normal bir Türkçe cümledir. Kitap okumak çok güzeldir ve kütüphaneler faydalıdır.'
    expect(isTextMostlyGarbled(text)).toBe(false)
  })

  it('should return true for mostly garbled/corrupted text', () => {
    const text = '($jt()!|) ^£$!@#% xzqrstplk xzqrstplk normal (5Ei ^£) other'
    expect(isTextMostlyGarbled(text)).toBe(true)
  })

  it('should return false for empty/null text', () => {
    expect(isTextMostlyGarbled('')).toBe(false)
    expect(isTextMostlyGarbled('   ')).toBe(false)
  })
})

describe('repairTurkishWordSpacing', () => {
  it('preserves valid Turkish word boundaries', () => {
    expect(repairTurkishWordSpacing('bir şey oldu')).toBe('bir şey oldu')
    expect(repairTurkishWordSpacing('bu şekilde çalışır')).toBe('bu şekilde çalışır')
    expect(repairTurkishWordSpacing('iki şehir arasında')).toBe('iki şehir arasında')
    expect(repairTurkishWordSpacing('o şimdi geldi')).toBe('o şimdi geldi')
  })

  it('only applies safe character-level normalization without geometry', () => {
    expect(repairTurkishWordSpacing('ﬁkir ve ﬂüt')).toBe('fikir ve flüt')
    expect(repairTurkishWordSpacing('köyleri erimi ş;')).toBe('köyleri erimi ş;')
  })
})

describe('joinWrappedTextLines', () => {
  it('joins constrained Turkish suffix fragments only at an explicit line boundary', () => {
    expect(joinWrappedTextLines('Niçin geri çekiyor', 'sun elini?')).toBe('Niçin geri çekiyorsun elini?')
    expect(joinWrappedTextLines('köyleri erimi-', 'şti.')).toBe('köyleri erimişti.')
  })

  it('does not merge valid Turkish words that begin with diacritics', () => {
    expect(joinWrappedTextLines('bir', 'şey oldu')).toBe('bir şey oldu')
    expect(joinWrappedTextLines('bu', 'şekilde çalışır')).toBe('bu şekilde çalışır')
  })
})
