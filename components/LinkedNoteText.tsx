import { parseNoteLinks } from '@/lib/noteLinks'
import type { CSSProperties } from 'react'

export default function LinkedNoteText({
  text,
  className = '',
  style,
}: {
  text: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={`select-text ${className}`} style={style}>
      {parseNoteLinks(text).map((token, index) => (
        token.type === 'link' ? (
          <a
            key={`${token.href}-${index}`}
            href={token.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={event => event.stopPropagation()}
            className="rounded-sm font-medium text-[var(--note-accent)] underline decoration-current/60 underline-offset-2 transition hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--note-accent)]"
          >
            {token.text}
          </a>
        ) : <span key={index}>{token.text}</span>
      ))}
    </span>
  )
}
