import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimit'
import { searchAllSources, searchProjectGutenberg, searchOpenLibrary, searchGoogleBooks } from '@/lib/bookSources'

export async function GET(req: NextRequest) {
  const user = getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const limited = checkRateLimit(req, 'search-source', 60, 60 * 1000)
  if (limited) return limited

  const { searchParams } = new URL(req.url)
  const query = searchParams.get('q')?.trim()
  const sourceParam = searchParams.get('source')

  if (!query || query.length < 2) {
    return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
  }

  try {
    let results
    if (sourceParam === 'gutenberg') {
      results = await searchProjectGutenberg(query)
    } else if (sourceParam === 'openlibrary') {
      results = await searchOpenLibrary(query)
    } else if (sourceParam === 'googlebooks') {
      results = await searchGoogleBooks(query)
    } else {
      results = await searchAllSources(query)
    }
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[search-source]', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
