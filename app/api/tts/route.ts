import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'
import { checkAndIncrementTtsQuota, estimateTtsDuration } from '@/lib/quotas'
import {
  curateMappedVoices,
  languageCodeFromVoiceName,
  mapGcpVoice,
  type MappedTtsVoice,
} from '@/lib/tts'

export const runtime = 'nodejs'

const FALLBACK_VOICES: MappedTtsVoice[] = [
  { Name: 'tr-TR-Chirp3-HD-Aoede', Locale: 'tr-TR', Gender: 'Female', FriendlyName: 'tr-TR · Chirp3 HD · Aoede (Kız)', Quality: 'chirp3' },
  { Name: 'tr-TR-Chirp3-HD-Charon', Locale: 'tr-TR', Gender: 'Male', FriendlyName: 'tr-TR · Chirp3 HD · Charon (Erkek)', Quality: 'chirp3' },
  { Name: 'tr-TR-Wavenet-A', Locale: 'tr-TR', Gender: 'Female', FriendlyName: 'tr-TR · WaveNet · A (Kız)', Quality: 'wavenet' },
  { Name: 'tr-TR-Wavenet-B', Locale: 'tr-TR', Gender: 'Male', FriendlyName: 'tr-TR · WaveNet · B (Erkek)', Quality: 'wavenet' },
  { Name: 'en-US-Chirp3-HD-Aoede', Locale: 'en-US', Gender: 'Female', FriendlyName: 'en-US · Chirp3 HD · Aoede (Kız)', Quality: 'chirp3' },
  { Name: 'en-US-Chirp3-HD-Charon', Locale: 'en-US', Gender: 'Male', FriendlyName: 'en-US · Chirp3 HD · Charon (Erkek)', Quality: 'chirp3' },
  { Name: 'en-US-Neural2-A', Locale: 'en-US', Gender: 'Female', FriendlyName: 'en-US · Neural2 · A (Kız)', Quality: 'neural2' },
  { Name: 'en-US-Neural2-J', Locale: 'en-US', Gender: 'Male', FriendlyName: 'en-US · Neural2 · J (Erkek)', Quality: 'neural2' },
  { Name: 'de-DE-Chirp3-HD-Aoede', Locale: 'de-DE', Gender: 'Female', FriendlyName: 'de-DE · Chirp3 HD · Aoede (Kız)', Quality: 'chirp3' },
  { Name: 'de-DE-Chirp3-HD-Charon', Locale: 'de-DE', Gender: 'Male', FriendlyName: 'de-DE · Chirp3 HD · Charon (Erkek)', Quality: 'chirp3' },
  { Name: 'de-DE-Wavenet-A', Locale: 'de-DE', Gender: 'Female', FriendlyName: 'de-DE · WaveNet · A (Kız)', Quality: 'wavenet' },
  { Name: 'de-DE-Wavenet-B', Locale: 'de-DE', Gender: 'Male', FriendlyName: 'de-DE · WaveNet · B (Erkek)', Quality: 'wavenet' },
]

function getApiKey() {
  return process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY || ''
}

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = checkRateLimit(req, 'tts-list-voices', 100, 60 * 60 * 1000)
  if (limited) return limited

  const apiKey = getApiKey()
  if (!apiKey) {
    return NextResponse.json(FALLBACK_VOICES)
  }

  try {
    const url = `https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      console.warn('[tts GET] Google TTS API returned status:', res.status)
      return NextResponse.json(FALLBACK_VOICES)
    }

    const data = (await res.json()) as { voices?: Parameters<typeof mapGcpVoice>[0][] }
    if (!data.voices || !Array.isArray(data.voices)) {
      return NextResponse.json(FALLBACK_VOICES)
    }

    const mapped = data.voices
      .map(mapGcpVoice)
      .filter((voice): voice is MappedTtsVoice => voice !== null)

    const curated = curateMappedVoices(mapped)
    return NextResponse.json(curated.length > 0 ? curated : FALLBACK_VOICES)
  } catch (err) {
    console.error('[tts GET] Failed to fetch voices, falling back:', err)
    return NextResponse.json(FALLBACK_VOICES)
  }
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = checkRateLimit(req, 'tts-synthesize', 100, 60 * 60 * 1000)
  if (limited) return limited

  const apiKey = getApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'Google Cloud TTS API key not configured' }, { status: 400 })
  }

  try {
    const { text, voice, rate, ssml } = (await req.json()) as {
      text?: string
      voice?: string
      rate?: number
      ssml?: string
    }
    if ((!text && !ssml) || !voice) {
      return NextResponse.json({ error: 'text/ssml and voice required' }, { status: 400 })
    }

    const speakingRate = typeof rate === 'number' ? Math.max(0.25, Math.min(4.0, rate)) : 1.0
    const durationSeconds = estimateTtsDuration(text || ssml || '', speakingRate)

    const allowed = checkAndIncrementTtsQuota(user.id, durationSeconds, 1800)
    if (!allowed) {
      return NextResponse.json({ error: 'Daily TTS limit (30 minutes) exceeded.' }, { status: 429 })
    }

    const languageCode = languageCodeFromVoiceName(voice)

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: ssml ? { ssml } : { text: (text || '').slice(0, 10000) },
        voice: { name: voice, languageCode },
        audioConfig: { audioEncoding: 'MP3', speakingRate },
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[tts POST] Google TTS API error:', res.status, errText)
      return NextResponse.json({ error: `Google TTS API error: ${res.status}` }, { status: res.status })
    }

    const data = (await res.json()) as { audioContent?: string }
    if (!data.audioContent) {
      return NextResponse.json({ error: 'No audioContent returned from Google TTS API' }, { status: 500 })
    }

    const audioBuffer = Buffer.from(data.audioContent, 'base64')
    return new NextResponse(audioBuffer, {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  } catch (err) {
    console.error('[tts POST] Failed to synthesize speech:', err)
    return NextResponse.json({ error: 'Failed to synthesize speech' }, { status: 500 })
  }
}
