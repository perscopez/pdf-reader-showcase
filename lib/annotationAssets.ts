import path from 'node:path'

const ASSET_ROUTE = '/api/annotation-assets'

export const ANNOTATION_ASSET_ROOT = path.join(process.cwd(), 'data', 'annotation-assets')

export function annotationAssetDirectory(userId: number, bookId: string | number) {
  return path.join(ANNOTATION_ASSET_ROOT, String(userId), String(bookId))
}

export function annotationAssetPathFromUrl(
  previewUrl: unknown,
  userId: number,
  bookId: string | number,
) {
  if (typeof previewUrl !== 'string') return null

  try {
    const base = 'http://annotation-assets.local'
    const url = new URL(previewUrl, base)
    const filename = url.searchParams.get('file')
    if (
      url.origin !== base
      || url.pathname !== ASSET_ROUTE
      || url.searchParams.get('book_id') !== String(bookId)
      || !filename
      || path.basename(filename) !== filename
      || !/^[A-Za-z0-9.-]+$/.test(filename)
    ) {
      return null
    }
    return path.join(annotationAssetDirectory(userId, bookId), filename)
  } catch {
    return null
  }
}

export function annotationPreviewPaths(
  content: unknown,
  userId: number,
  bookId: string | number,
) {
  if (!content || typeof content !== 'object') return []
  const record = content as {
    area?: { previewUrl?: unknown }
    sources?: Array<{ area?: { previewUrl?: unknown } }>
  }
  const urls = [
    record.area?.previewUrl,
    ...(Array.isArray(record.sources) ? record.sources.map(source => source?.area?.previewUrl) : []),
  ]
  return [...new Set(urls
    .map(url => annotationAssetPathFromUrl(url, userId, bookId))
    .filter((item): item is string => Boolean(item)))]
}
