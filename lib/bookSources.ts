export interface BookSourceResult {
  source: 'gutenberg' | 'openlibrary' | 'googlebooks'
  sourceId: string
  title: string
  author: string
  description?: string
  coverUrl?: string
  downloadUrl?: string
  formats?: { format: string; url: string }[]
  sourceUrl?: string
}

interface GutendexResult {
  id: number
  title: string
  authors: { name: string; birth_year?: number; death_year?: number }[]
  subjects: string[]
  bookshelves: string[]
  formats: Record<string, string>
  download_count: number
}

interface OpenLibraryResult {
  key: string
  title: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  ia?: string[]
  id_gutenberg?: string[]
  isbn?: string[]
  public_scan_b?: boolean
  ebook_access?: string
  has_fulltext?: boolean
  availability?: { identifier?: string; status?: string; is_restricted?: boolean }
}

interface InternetArchiveMetadata {
  d1?: string
  dir?: string
  files?: { name?: string; format?: string; size?: string }[]
}

interface GoogleBooksResult {
  id: string
  volumeInfo: {
    title: string
    authors?: string[]
    description?: string
    imageLinks?: { thumbnail?: string }
    previewLink?: string
    infoLink?: string
    readingModes?: { pdf?: boolean; image?: boolean }
    accessViewStatus?: string
  }
  accessInfo?: {
    pdf?: { isAvailable: boolean; downloadLink?: string }
    epub?: { isAvailable: boolean; downloadLink?: string }
    publicDomain?: boolean
    viewability?: string
  }
}

export async function searchProjectGutenberg(
  query: string,
  limit = 12
): Promise<BookSourceResult[]> {
  try {
    const url = `https://gutendex.com/books?search=${encodeURIComponent(query)}&languages=en,tr,de,fr,es`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json() as { results: GutendexResult[] }
    return data.results.slice(0, limit).map(book => {
      const author = book.authors.map(a => a.name).join(', ')
      const formats = Object.entries(book.formats).map(([format, url]) => ({
        format,
        url,
      }))
      // The reader supports PDF and EPUB, so do not advertise text/HTML as importable books.
      const downloadUrl = book.formats['application/pdf']
        || book.formats['application/epub+zip']
        || Object.entries(book.formats).find(([f]) =>
            f.includes('epub') || f.includes('pdf')
          )?.[1]
      const coverUrl = book.formats['image/jpeg']
      return {
        source: 'gutenberg' as const,
        sourceId: String(book.id),
        title: cleanTitle(book.title),
        author,
        description: `Project Gutenberg #${book.id} — ${book.download_count.toLocaleString()} downloads`,
        coverUrl,
        downloadUrl,
        formats,
        sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
      }
    })
  } catch {
    return []
  }
}

export async function searchOpenLibrary(
  query: string,
  limit = 12
): Promise<BookSourceResult[]> {
  try {
    const fields = 'key,title,author_name,cover_i,ia,public_scan_b,ebook_access,has_fulltext,availability'
    const headers = { 'User-Agent': `DigitalLibrary/1.0 (${process.env.PUBLIC_APP_URL || 'self-hosted'})` }
    const fetchDocs = async (searchQuery: string, resultLimit: number) => {
      const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(searchQuery)}&limit=${resultLimit}&fields=${encodeURIComponent(fields)}`
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })
      if (!res.ok) return []
      const data = await res.json() as { docs?: OpenLibraryResult[] }
      return data.docs || []
    }

    const publicLimit = Math.min(6, limit)
    const [catalogResult, publicResult] = await Promise.allSettled([
      fetchDocs(query, limit),
      fetchDocs(`(${query}) AND ebook_access:public`, publicLimit),
    ])
    const catalogDocs = catalogResult.status === 'fulfilled' ? catalogResult.value : []
    const publicDocs = publicResult.status === 'fulfilled' ? publicResult.value : []
    const publicResults = await Promise.all(publicDocs.map(async book => {
      const iaId = book.availability?.identifier || book.ia?.[0]
      const resolved = iaId ? await resolveInternetArchiveDownload(iaId) : undefined
      return toOpenLibraryResult(book, resolved)
    }))
    const publicKeys = new Set(publicDocs.map(book => book.key))
    const catalogResults = catalogDocs
      .filter(book => !publicKeys.has(book.key))
      .map(book => toOpenLibraryResult(book))

    return [...publicResults, ...catalogResults].slice(0, limit)
  } catch {
    return []
  }
}

function toOpenLibraryResult(
  book: OpenLibraryResult,
  resolved?: { iaId: string; downloadUrl: string; format: string; formats: { format: string; url: string }[] },
): BookSourceResult {
      const sourceId = book.key.replace('/works/', '')
      const author = book.author_name?.join(', ') || ''
      const coverUrl = book.cover_i
        ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`
        : undefined
      return {
        source: 'openlibrary' as const,
        sourceId: resolved ? `${sourceId}:${resolved.iaId}` : sourceId,
        title: book.title,
        author,
        coverUrl,
        downloadUrl: resolved?.downloadUrl,
        formats: resolved?.formats,
        description: resolved ? `Internet Archive — ${resolved.format.toUpperCase()}` : undefined,
        sourceUrl: resolved
          ? `https://archive.org/details/${resolved.iaId}`
          : `https://openlibrary.org${book.key}`,
      }
}

export async function resolveInternetArchiveDownload(iaId: string) {
  try {
    const headers = { 'User-Agent': `DigitalLibrary/1.0 (${process.env.PUBLIC_APP_URL || 'self-hosted'})` }
    const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(iaId)}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return undefined
    const metadata = await res.json() as InternetArchiveMetadata
    const candidates = (metadata.files || [])
      .filter(file => {
        const name = file.name?.toLowerCase() || ''
        const size = Number(file.size || 0)
        return (name.endsWith('.pdf') || name.endsWith('.epub')) && size > 0 && size <= 100 * 1024 * 1024
      })
      .sort((a, b) => {
        const extensionRank = (name = '') => name.toLowerCase().endsWith('.pdf') ? 0 : 1
        return extensionRank(a.name) - extensionRank(b.name) || Number(a.size || 0) - Number(b.size || 0)
      })
    if (!candidates.length) return undefined

    const makeUrl = (name: string) => metadata.d1 && metadata.dir
      ? `https://${metadata.d1}${metadata.dir}/${encodeURIComponent(name)}`
      : `https://archive.org/download/${encodeURIComponent(iaId)}/${encodeURIComponent(name)}`
    const formats = candidates.map(file => ({
      format: file.name!.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : 'application/pdf',
      url: makeUrl(file.name!),
    }))
    return {
      iaId,
      downloadUrl: formats[0].url,
      format: formats[0].format.includes('epub') ? 'epub' : 'pdf',
      formats,
    }
  } catch {
    return undefined
  }
}

export async function searchGoogleBooks(
  query: string,
  limit = 12
): Promise<BookSourceResult[]> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY
  try {
    let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${limit}&printType=books`
    if (apiKey) url += `&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = await res.json() as { items?: GoogleBooksResult[] }
    if (!data.items) return []
    return data.items.slice(0, limit).map(item => {
      const v = item.volumeInfo
      const author = v.authors?.join(', ') || ''
      const coverUrl = v.imageLinks?.thumbnail
        ? v.imageLinks.thumbnail.replace('http:', 'https:')
        : undefined
      const formats: { format: string; url: string }[] = []
      if (item.accessInfo?.pdf?.isAvailable && item.accessInfo.pdf.downloadLink) {
        formats.push({ format: 'application/pdf', url: item.accessInfo.pdf.downloadLink })
      }
      if (item.accessInfo?.epub?.isAvailable && item.accessInfo.epub.downloadLink) {
        formats.push({ format: 'application/epub+zip', url: item.accessInfo.epub.downloadLink })
      }
      const downloadUrl = formats.find(f =>
        f.format === 'application/pdf' || f.format === 'application/epub+zip'
      )?.url
      return {
        source: 'googlebooks' as const,
        sourceId: item.id,
        title: v.title,
        author,
        description: v.description
          ? v.description.replace(/<[^>]*>/g, '').slice(0, 500)
          : undefined,
        coverUrl,
        downloadUrl,
        formats,
        sourceUrl: v.infoLink || v.previewLink,
      }
    })
  } catch {
    return []
  }
}

export async function searchAllSources(
  query: string,
  limit = 12
): Promise<BookSourceResult[]> {
  const [gutenberg, openlibrary, googlebooks] = await Promise.all([
    searchProjectGutenberg(query, limit),
    searchOpenLibrary(query, limit),
    searchGoogleBooks(query, limit),
  ])
  return [...gutenberg, ...openlibrary, ...googlebooks]
}

export interface OnlineBookMetadata {
  title?: string
  author?: string
  coverUrl?: string
  description?: string
  isbn?: string
  language?: string
}

export async function fetchOnlineBookMetadata(
  title: string,
  author?: string,
  isbn?: string
): Promise<OnlineBookMetadata | null> {
  try {
    // 1. Try ISBN lookup first
    if (isbn && isbn.length >= 9) {
      const googleByIsbn = await searchGoogleBooks(`isbn:${isbn}`, 1)
      if (googleByIsbn.length > 0) {
        const b = googleByIsbn[0]
        return {
          title: b.title,
          author: b.author,
          coverUrl: b.coverUrl,
          description: b.description,
          isbn,
        }
      }
    }

    // 2. Try Title + Author lookup on Google Books
    const query = [title, author].filter(Boolean).join(' ').trim()
    if (query.length < 2) return null

    const googleResults = await searchGoogleBooks(query, 3)
    if (googleResults.length > 0) {
      const b = googleResults[0]
      return {
        title: b.title,
        author: b.author || author,
        coverUrl: b.coverUrl,
        description: b.description,
      }
    }

    // 3. Fallback to Open Library
    const olResults = await searchOpenLibrary(query, 3)
    if (olResults.length > 0) {
      const b = olResults[0]
      return {
        title: b.title,
        author: b.author || author,
        coverUrl: b.coverUrl,
      }
    }
  } catch {
    // Network or API failure fallback
  }

  return null
}

export function getDownloadExtension(format: string): string {
  if (format.includes('epub')) return '.epub'
  if (format.includes('pdf')) return '.pdf'
  if (format.includes('html')) return '.html'
  return '.pdf'
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}
