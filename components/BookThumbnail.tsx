'use client'

import Image from 'next/image'
import { useState } from 'react'
import { cleanText } from '@/lib/text'
import { getAssetUrl } from '@/lib/api'

interface BookThumbnailProps {
  filepath: string
  title: string
  thumbnail?: string
  placeholderImage?: string
  light?: boolean
}

export default function BookThumbnail({ title, thumbnail, placeholderImage, light }: BookThumbnailProps) {
  const cleanTitle = cleanText(title)
  const initials = cleanTitle
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('')
  const rawSrc = thumbnail || placeholderImage
  const src = rawSrc ? getAssetUrl(rawSrc) : null
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src && src !== failedSrc)

  // ── Seoul / light theme ──────────────────────────────────────────────────
  if (light) {
    return (
      <div className="group relative w-full aspect-[2/3] overflow-hidden bg-[#EDE9E1] select-none">
        {showImage ? (
          <Image
            src={src!}
            alt=""
            aria-hidden="true"
            fill
            sizes="(max-width: 640px) 45vw, 180px"
            unoptimized
            className="object-fill"
            draggable={false}
            onError={() => setFailedSrc(src)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#C8C3B8] bg-[#DDD9D0] text-2xl font-bold text-[#5A5245]">
              {initials || 'DOC'}
            </div>
            <p className="px-3 text-center text-xs leading-snug text-[#7A7060]">{cleanTitle}</p>
          </div>
        )}
      </div>
    )
  }

  // ── Dark theme ───────────────────────────────────────────────────────────
  return (
    <div
      className="group relative w-full aspect-[2/3] overflow-hidden bg-[var(--lib-surface-muted,#141414)] p-3 select-none transition-all duration-300"
      style={{ backgroundImage: 'linear-gradient(135deg, color-mix(in srgb, var(--lib-accent, #64748b) 18%, var(--lib-surface-muted, #141414)), var(--lib-surface-muted, #141414))' }}
    >
      {!showImage && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(15,23,42,0.32))]" />
          <div className="pointer-events-none absolute inset-x-5 bottom-2 h-8 rounded-full bg-black/25 blur-2xl opacity-60 transition-opacity duration-300 group-hover:opacity-80" />
        </>
      )}
      {showImage ? (
        <Image
          src={src!}
          alt=""
          aria-hidden="true"
          fill
          sizes="(max-width: 640px) 45vw, 180px"
          unoptimized
          className="object-fill"
          draggable={false}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div className="relative flex h-full flex-col items-center justify-center gap-2 text-[var(--lib-text)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--lib-border)] bg-[var(--lib-surface-subtle)] text-2xl font-bold text-[var(--lib-text)] shadow-[0_14px_30px_var(--lib-shadow,#0008)] backdrop-blur-sm transition-all duration-300 group-hover:-translate-y-0.5 group-hover:bg-[var(--lib-accent-surface)]">
            {initials || 'DOC'}
          </div>
          <p className="px-3 text-center text-xs leading-snug text-[var(--lib-text-secondary)] transition-opacity duration-300 group-hover:text-[var(--lib-text)]">{cleanTitle}</p>
        </div>
      )}
    </div>
  )
}
