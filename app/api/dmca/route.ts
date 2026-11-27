import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { cleanText } from '@/lib/text'
import { checkRateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 'dmca', 5, 60 * 60 * 1000)
  if (limited) return limited
  try {
    const body = await req.json()
    
    const reporterName = cleanText(body.reporterName || '').trim().slice(0, 200)
    const reporterEmail = cleanText(body.reporterEmail || '').trim().slice(0, 200)
    const ownerName = cleanText(body.ownerName || '').trim().slice(0, 200)
    const infringingUrl = cleanText(body.infringingUrl || '').trim().slice(0, 500)
    const details = cleanText(body.details || '').trim().slice(0, 2000)
    const signature = cleanText(body.signature || '').trim().slice(0, 200)

    // Basic validation
    if (!reporterName || !reporterEmail || !ownerName || !infringingUrl || !details || !signature) {
      return NextResponse.json({ error: 'Lütfen tüm zorunlu alanları doldurun.' }, { status: 400 })
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(reporterEmail)) {
      return NextResponse.json({ error: 'Lütfen geçerli bir e-posta adresi girin.' }, { status: 400 })
    }

    // Format message for the admin bug-reports dashboard
    const formattedMessage = `[DMCA TELİF BİLDİRİMİ]
Hak Sahibi: ${ownerName}
Bildiren: ${reporterName} (${reporterEmail})
İmza İfadesi: ${signature}

İhlal Açıklaması:
${details}`

    // Insert into bug_reports with user_id = 0 (Anonymous System ID)
    const result = db.prepare(
      'INSERT INTO bug_reports (user_id, message, page_url) VALUES (?, ?, ?)'
    ).run(0, formattedMessage, infringingUrl)

    return NextResponse.json({ id: result.lastInsertRowid, success: true }, { status: 201 })
  } catch (error) {
    console.error('[dmca POST]', error)
    return NextResponse.json({ error: 'Bir veritabanı hatası oluştu.' }, { status: 500 })
  }
}
