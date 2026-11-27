'use client'

import type { PageTextModel } from '@/lib/pdfTextModel'

interface OcrTextLayerProps {
  model: PageTextModel
  label: string
  page: number
}

export default function OcrTextLayer({ model, label, page }: OcrTextLayerProps) {
  if (model.source !== 'ocr' || model.words.length === 0) return null

  return (
    <div
      className="ocr-text-layer"
      data-page-text-source="ocr"
      data-page-number={page}
      aria-label={label}
    >
      {model.words.map((word, index) => (
        <span
          key={word.id || `${word.line}:${index}:${word.text}`}
          style={{
            left: `${word.left * 100}%`,
            top: `${word.top * 100}%`,
            width: `${word.width * 100}%`,
            height: `${word.height * 100}%`,
            fontSize: `${Math.max(0.6, word.height * 100)}cqh`,
          }}
          data-ocr-word={index}
          data-reader-word-id={word.id}
          data-text-start={word.startOffset}
          data-text-end={word.endOffset}
        >
          {word.text}
        </span>
      ))}
    </div>
  )
}
