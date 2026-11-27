import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, userOwnsBook } from '@/lib/auth'
import { repairTurkishWordSpacing } from '@/lib/text'
import { checkRateLimit } from '@/lib/rateLimit'
import { checkAndIncrementAiQuota } from '@/lib/quotas'

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const limited = checkRateLimit(req, 'manual-ocr', 30, 60 * 60 * 1000)
    if (limited) return limited

    const declaredLength = Number(req.headers.get('content-length') || 0)
    if (declaredLength > 12_000_000) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    const { bookId, page, imageBase64 } = await req.json()
    const normalizedBookId = Number(bookId)
    const normalizedPage = Number(page)
    if (
      !Number.isInteger(normalizedBookId)
      || normalizedBookId < 1
      || !Number.isInteger(normalizedPage)
      || normalizedPage < 1
      || normalizedPage > 100_000
      || !imageBase64
      || typeof imageBase64 !== 'string'
      || imageBase64.length > 12_000_000
    ) {
      return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
    }
    if (!userOwnsBook(user.id, normalizedBookId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY || ''

    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini Vision API key not configured' }, { status: 500 })
    }
    if (!checkAndIncrementAiQuota(user.id, 50)) {
      return NextResponse.json({ error: 'Daily AI request limit exceeded' }, { status: 429 })
    }

    const body = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: cleanBase64,
              },
            },
            {
              text: 'Sen yüksek hassasiyetli bir Doküman OCR yapay zeka modelisin. Verilen bu kitap sayfasındaki TÜM metinleri hatasız olarak çıkar. Türkçe karakterleri (ç, ğ, ı, i, ö, ş, ü, Ç, Ğ, İ, Ö, Ş, Ü) eksiksiz koru. Kelimeleri ortadan bölme. Sadece sayfadaki temiz metni ve paragrafları yanıt olarak dön.',
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      }
    )

    const data = await res.json()

    if (!res.ok || data?.error) {
      console.error('[api-ocr Gemini error]', data?.error?.message || res.status)
      return NextResponse.json({ error: 'OCR processing failed' }, { status: 500 })
    }

    const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const repairedText = repairTurkishWordSpacing(textPart.trim())

    return NextResponse.json({ success: true, text: repairedText })
  } catch (error) {
    console.error('[api-ocr POST]', error)
    return NextResponse.json({ error: 'OCR server error' }, { status: 500 })
  }
}
