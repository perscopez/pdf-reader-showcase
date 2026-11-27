import { NextRequest, NextResponse } from 'next/server'
import { cleanText } from '@/lib/text'
import { getCurrentUser } from '@/lib/auth'

function getDeepLApiKey() {
  const fromEnv = process.env.DEEPL_API_KEY?.trim()
  if (fromEnv && fromEnv !== 'your_deepl_api_key_here') return fromEnv
  return ''
}

function getDeepLEndpoint(apiKey: string): string {
  // Free tier keys end with ':fx' → must use api-free.deepl.com
  // Pro keys use api.deepl.com
  return apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate'
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const rawText = typeof body?.text === 'string' ? body.text : ''
  const target_lang = body?.target_lang
  const targetLang = ['TR', 'EN', 'DE'].includes(target_lang) ? target_lang : 'TR'

  const cleaned = cleanText(rawText).trim()
  if (!cleaned) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }
  if (cleaned.length > 5000) {
    return NextResponse.json({ error: 'Text too long (max 5000 characters)' }, { status: 413 })
  }

  const apiKey = getDeepLApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Translation service not configured. Please set DEEPL_API_KEY in server environment.' },
      { status: 503 }
    )
  }

  const endpoint = getDeepLEndpoint(apiKey)

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${apiKey}` },
      body: JSON.stringify({ text: [cleaned], target_lang: targetLang }),
    })
  } catch {
    return NextResponse.json({ error: 'Translation request failed' }, { status: 502 })
  }

  if (!res.ok) {
    const status = res.status
    if (status === 403) {
      return NextResponse.json({ error: 'Translation API key invalid or unauthorized' }, { status: 502 })
    }
    if (status === 456) {
      return NextResponse.json({ error: 'Translation quota exceeded' }, { status: 429 })
    }
    return NextResponse.json({ error: `Translation service error (${status})` }, { status: 502 })
  }

  const data = await res.json()
  const translatedText = data.translations?.[0]?.text
  if (!translatedText) {
    return NextResponse.json({ error: 'Translation response empty' }, { status: 502 })
  }

  return NextResponse.json({ translation: cleanText(translatedText) })
}
