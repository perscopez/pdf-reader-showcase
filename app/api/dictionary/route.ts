import { NextRequest, NextResponse } from 'next/server'
import { cleanText } from '@/lib/text'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const word = cleanText(req.nextUrl.searchParams.get('word'))
  if (!word) return NextResponse.json({ error: 'word required' }, { status: 400 })

  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
  if (!res.ok) return NextResponse.json({ error: 'Word not found' }, { status: 404 })

  const data = await res.json()
  const entry = data[0]
  const meanings = entry?.meanings?.slice(0, 2).map((m: { partOfSpeech: string; definitions: { definition: string; example?: string }[] }) => ({
    partOfSpeech: m.partOfSpeech,
    definitions: m.definitions.slice(0, 2).map((d: { definition: string; example?: string }) => ({
      definition: d.definition,
      example: d.example,
    })),
  }))

  return NextResponse.json({ word: entry?.word, phonetic: entry?.phonetic, meanings })
}
