export type GroupRole = 'owner' | 'member'

export type GroupAnnotationRecord = {
  id: number
  author_user_id: number
  visibility: 'group' | 'private'
}

export type GroupReplyRecord = {
  id: number
  author_user_id: number
}

export function groupDetailHref(groupId: number) {
  return `/groups/${encodeURIComponent(String(groupId))}`
}

export function sourceHref(bookId: number, page: number) {
  const params = new URLSearchParams({ page: String(page) })
  return `/reader/${encodeURIComponent(String(bookId))}?${params.toString()}`
}

export function canManageGroup(role: GroupRole | null | undefined) {
  return role === 'owner'
}

export function canDeleteGroupAnnotation(annotation: GroupAnnotationRecord, userId: number | undefined, role: GroupRole | null | undefined) {
  return role === 'owner' || annotation.author_user_id === userId
}

export function canDeleteGroupReply(reply: GroupReplyRecord, userId: number | undefined, role: GroupRole | null | undefined) {
  return role === 'owner' || reply.author_user_id === userId
}

export function annotationText(content: unknown) {
  if (typeof content === 'string') return content.trim()
  if (!content || typeof content !== 'object') return ''
  const record = content as Record<string, unknown>
  for (const key of ['note', 'text', 'quote', 'content']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
  }
  return ''
}
