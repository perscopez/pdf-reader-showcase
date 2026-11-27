export type NoteLinkToken =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

const NOTE_LINK_PATTERN = /\[([^\]\n]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<]+)/gi
const TRAILING_PUNCTUATION = /[),.;:!?]+$/u

function safeHref(value: string) {
  const candidate = value.toLowerCase().startsWith('www.') ? `https://${value}` : value
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function parseNoteLinks(value: string): NoteLinkToken[] {
  if (!value) return []
  const tokens: NoteLinkToken[] = []
  let cursor = 0
  const appendText = (text: string) => {
    if (!text) return
    const previous = tokens[tokens.length - 1]
    if (previous?.type === 'text') previous.text += text
    else tokens.push({ type: 'text', text })
  }

  for (const match of value.matchAll(NOTE_LINK_PATTERN)) {
    const index = match.index ?? 0
    const unmatchedMarkdownStart = value.lastIndexOf('[', index)
    if (!match[1] && unmatchedMarkdownStart >= cursor && /^\[[^\]\n]+\]\($/.test(value.slice(unmatchedMarkdownStart, index))) {
      appendText(value.slice(cursor))
      return tokens
    }
    if (index > cursor) appendText(value.slice(cursor, index))

    const markdownLabel = match[1]
    const rawDestination = match[2] || match[3] || ''
    const trailing = markdownLabel ? '' : (rawDestination.match(TRAILING_PUNCTUATION)?.[0] || '')
    const destination = trailing ? rawDestination.slice(0, -trailing.length) : rawDestination
    const href = safeHref(destination)

    if (href) {
      tokens.push({ type: 'link', text: markdownLabel || destination, href })
      if (trailing) appendText(trailing)
    } else {
      appendText(match[0])
    }
    cursor = index + match[0].length
  }

  if (cursor < value.length) appendText(value.slice(cursor))
  return tokens.length ? tokens : [{ type: 'text', text: value }]
}
