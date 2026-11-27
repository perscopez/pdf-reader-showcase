import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_ASSET_ROOT,
  annotationAssetPathFromUrl,
  annotationPreviewPaths,
} from '@/lib/annotationAssets'

describe('annotation assets', () => {
  it('resolves only an owned preview URL for the expected book', () => {
    expect(annotationAssetPathFromUrl(
      '/api/annotation-assets?book_id=6&file=preview-1.png',
      7,
      6,
    )).toBe(path.join(ANNOTATION_ASSET_ROOT, '7', '6', 'preview-1.png'))

    expect(annotationAssetPathFromUrl(
      '/api/annotation-assets?book_id=9&file=preview-1.png',
      7,
      6,
    )).toBeNull()
    expect(annotationAssetPathFromUrl(
      '/api/annotation-assets?book_id=6&file=../secret',
      7,
      6,
    )).toBeNull()
    expect(annotationAssetPathFromUrl(
      'https://example.com/api/annotation-assets?book_id=6&file=preview-1.png',
      7,
      6,
    )).toBeNull()
  })

  it('collects unique area and multi-source preview paths', () => {
    expect(annotationPreviewPaths({
      area: { previewUrl: '/api/annotation-assets?book_id=6&file=area.png' },
      sources: [
        { area: { previewUrl: '/api/annotation-assets?book_id=6&file=source.jpg' } },
        { area: { previewUrl: '/api/annotation-assets?book_id=6&file=area.png' } },
        { area: { previewUrl: '/api/annotation-assets?book_id=8&file=foreign.png' } },
      ],
    }, 7, 6)).toEqual([
      path.join(ANNOTATION_ASSET_ROOT, '7', '6', 'area.png'),
      path.join(ANNOTATION_ASSET_ROOT, '7', '6', 'source.jpg'),
    ])
  })
})
