import { describe, expect, it } from 'vitest'
import {
  buildChunkSsml,
  buildReadingOrderUnits,
  curateMappedVoices,
  detectSpeechLocale,
  findNextPageTokenIndex,
  findPhraseStartIndex,
  guessTokenLocale,
  joinHyphenatedBreaks,
  languageCodeFromVoiceName,
  mapGcpVoice,
  mapVoiceToLocale,
  normalizeTtsToken,
  pickBestVoiceForLocale,
  resolveAutoGcpVoice,
  resolveChunkVoice,
  resolveStartWordIndex,
  splitTtsChunks,
  splitWordUnitsIntoChunks,
  tokenizeTtsWords,
  tokensMatch,
  voiceQuality,
  wordIndexAtProgress,
  type MappedTtsVoice,
} from '@/lib/tts'

describe('lib/tts', () => {
  it('ranks Chirp3 above Neural2 and Standard', () => {
    expect(voiceQuality('tr-TR-Chirp3-HD-Aoede')).toBe('chirp3')
    expect(voiceQuality('en-US-Neural2-A')).toBe('neural2')
    expect(voiceQuality('de-DE-Standard-A')).toBe('standard')
  })

  it('parses language codes from Chirp voice names', () => {
    expect(languageCodeFromVoiceName('tr-TR-Chirp3-HD-Aoede')).toBe('tr-TR')
    expect(languageCodeFromVoiceName('cmn-CN-Chirp3-HD-Charon')).toBe('cmn-CN')
    expect(languageCodeFromVoiceName('ar-XA-Wavenet-A')).toBe('ar-XA')
  })

  it('detects Turkish, German, Arabic, and Japanese from sample text', () => {
    expect(detectSpeechLocale('Bu kitap için daha çok bilgi var ve olan her şey önemli.', 'en-US')).toBe('tr-TR')
    expect(detectSpeechLocale('Der Mann und die Frau sind mit dem Auto auf der Straße.', 'en-US')).toBe('de-DE')
    expect(detectSpeechLocale('مرحبا كيف حالك اليوم يا صديقي العزيز', 'en-US')).toBe('ar-XA')
    expect(detectSpeechLocale('こんにちは、今日は良い天気ですね。カタカナも少し。', 'en-US')).toBe('ja-JP')
    expect(detectSpeechLocale('The book is on the table and this is from the library.', 'tr-TR')).toBe('en-US')
  })

  it('curates preferred Chirp3 speakers and keeps other locales', () => {
    const raw = [
      mapGcpVoice({ name: 'tr-TR-Chirp3-HD-Aoede', ssmlGender: 'FEMALE', languageCodes: ['tr-TR'] }),
      mapGcpVoice({ name: 'tr-TR-Chirp3-HD-Charon', ssmlGender: 'MALE', languageCodes: ['tr-TR'] }),
      mapGcpVoice({ name: 'tr-TR-Chirp3-HD-RandomStar', ssmlGender: 'FEMALE', languageCodes: ['tr-TR'] }),
      mapGcpVoice({ name: 'tr-TR-Standard-A', ssmlGender: 'FEMALE', languageCodes: ['tr-TR'] }),
      mapGcpVoice({ name: 'fr-FR-Neural2-A', ssmlGender: 'FEMALE', languageCodes: ['fr-FR'] }),
      mapGcpVoice({ name: 'fr-FR-Standard-A', ssmlGender: 'FEMALE', languageCodes: ['fr-FR'] }),
    ].filter((v): v is MappedTtsVoice => v !== null)

    const curated = curateMappedVoices(raw)
    const tr = curated.filter(v => v.Locale === 'tr-TR')
    const fr = curated.filter(v => v.Locale === 'fr-FR')
    expect(tr.every(v => v.Quality === 'chirp3')).toBe(true)
    expect(tr.some(v => v.Name.includes('Aoede'))).toBe(true)
    expect(tr.some(v => v.Name.includes('RandomStar'))).toBe(false)
    expect(fr[0]?.Name).toBe('fr-FR-Neural2-A')
  })

  it('picks Chirp3 Aoede as auto voice for Turkish text', () => {
    const voices: MappedTtsVoice[] = [
      {
        Name: 'tr-TR-Chirp3-HD-Aoede',
        Locale: 'tr-TR',
        Gender: 'Female',
        FriendlyName: 'x',
        Quality: 'chirp3',
      },
      {
        Name: 'tr-TR-Wavenet-A',
        Locale: 'tr-TR',
        Gender: 'Female',
        FriendlyName: 'y',
        Quality: 'wavenet',
      },
      {
        Name: 'en-US-Chirp3-HD-Aoede',
        Locale: 'en-US',
        Gender: 'Female',
        FriendlyName: 'z',
        Quality: 'chirp3',
      },
    ]
    const picked = resolveAutoGcpVoice(voices, 'Bu bir Türkçe metindir ve daha çok kelime vardır.', 'en')
    expect(picked?.Name).toBe('tr-TR-Chirp3-HD-Aoede')
    expect(pickBestVoiceForLocale(voices, 'en-US')?.Name).toBe('en-US-Chirp3-HD-Aoede')
  })

  it('splits long text into short progressive chunks', () => {
    const text = 'Birinci cumle burada. Ikinci cumle biraz daha uzun olsun ki bolunsun. Ucuncu cumle de gelsin. Dorduncu cumle bitirsin.'
    const chunks = splitTtsChunks(text, 40)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.length <= 40 || !chunk.includes(' '))).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('Birinci cumle')
  })

  it('maps audio progress to word indices', () => {
    expect(tokenizeTtsWords('Merhaba guzel dunya').length).toBe(3)
    expect(wordIndexAtProgress(4, 0)).toBe(0)
    expect(wordIndexAtProgress(4, 0.26)).toBe(1)
    expect(wordIndexAtProgress(4, 0.99)).toBe(3)
    expect(wordIndexAtProgress(0, 0.5)).toBe(-1)
  })

  it('advances highlight only forward for repeated words', () => {
    const page = ['bir', 'kitap', 've', 'bir', 'kalem', 've', 'defter'].map(normalizeTtsToken)
    expect(findNextPageTokenIndex(page, 0, 'bir')).toBe(0)
    expect(findNextPageTokenIndex(page, 1, 'bir')).toBe(3)
    expect(findNextPageTokenIndex(page, 4, 've')).toBe(5)
    expect(findNextPageTokenIndex(page, 6, 'bir')).toBe(-1)
    expect(tokensMatch('kitap', 'kit')).toBe(true)
    expect(tokensMatch('ve', 'vergi')).toBe(false)
  })

  it('joins hyphenated line breaks into one spoken word', () => {
    expect(joinHyphenatedBreaks('kelime-\nsi burada')).toBe('kelimesi burada')
    expect(joinHyphenatedBreaks('kelime- si burada')).toBe('kelimesi burada')

    const units = buildReadingOrderUnits([
      { text: 'Bu ', left: 0, top: 0, width: 20, height: 12, key: 0 },
      { text: 'kelime-', left: 20, top: 0, width: 40, height: 12, key: 1 },
      { text: 'si', left: 0, top: 20, width: 16, height: 12, key: 2 },
      { text: ' burada', left: 16, top: 20, width: 40, height: 12, key: 3 },
    ])
    expect(units.map(unit => unit.text)).toEqual(['Bu', 'kelimesi', 'burada'])
    expect(units[1].spanKeys).toEqual([1, 2])
  })

  it('switches chunk voice and wraps foreign tokens in SSML', () => {
    const voices: MappedTtsVoice[] = [
      {
        Name: 'tr-TR-Chirp3-HD-Aoede',
        Locale: 'tr-TR',
        Gender: 'Female',
        FriendlyName: 'tr',
        Quality: 'chirp3',
      },
      {
        Name: 'en-US-Chirp3-HD-Aoede',
        Locale: 'en-US',
        Gender: 'Female',
        FriendlyName: 'en',
        Quality: 'chirp3',
      },
    ]
    expect(resolveChunkVoice(
      voices,
      'This book is from the library and that is clear.',
      'tr-TR-Chirp3-HD-Aoede',
      'tr',
    )).toBe('en-US-Chirp3-HD-Aoede')
    expect(mapVoiceToLocale(voices, 'tr-TR-Chirp3-HD-Aoede', 'en-US')).toBe('en-US-Chirp3-HD-Aoede')
    expect(guessTokenLocale('algorithm', 'tr-TR')).toBe('en-US')
    expect(guessTokenLocale('kitap', 'tr-TR')).toBe(null)

    const ssml = buildChunkSsml('Bu algorithm burada', 'tr-TR-Chirp3-HD-Aoede', voices)
    expect(ssml).toContain('<voice name="en-US-Chirp3-HD-Aoede">algorithm</voice>')
    expect(ssml).toContain('Bu')
  })

  it('splits word units into indexed chunks', () => {
    const units = ['Bir', 'iki', 'uc', 'dort', 'bes'].map(text => ({
      text,
      normalized: text.toLowerCase(),
      spanKeys: [],
    }))
    const chunks = splitWordUnitsIntoChunks(units, 10)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].startWord).toBe(0)
    expect(chunks[chunks.length - 1].endWord).toBe(units.length - 1)
  })

  it('resolves playback start from selection, viewport, or page start', () => {
    const words = ['Bir', 'kitap', 'okumak', 'guzeldir', 've', 'faydalidir']
    expect(findPhraseStartIndex(words, 'okumak guzeldir')).toBe(2)
    expect(resolveStartWordIndex(words, 'page-start')).toBe(0)
    expect(resolveStartWordIndex(words, 'selection', { selectedText: 'guzeldir' })).toBe(3)
    expect(resolveStartWordIndex(words, 'selection', { selectedText: '' })).toBe(0)
    expect(resolveStartWordIndex(words, 'viewport', { viewportIndex: 4 })).toBe(4)
    expect(resolveStartWordIndex(words, 'viewport', { viewportIndex: 99 })).toBe(5)
  })
})
