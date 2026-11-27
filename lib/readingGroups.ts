import db from '@/lib/db'

export type GroupRole = 'owner' | 'member'
export type GroupVisibility = 'group' | 'private'

export interface GroupAccess {
  groupId: number
  role: GroupRole
}

export function parsePositiveId(value: unknown) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function normalizeGroupText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function getGroupAccess(userId: number, groupId: unknown): GroupAccess | null {
  const id = parsePositiveId(groupId)
  if (!id) return null
  const row = db.prepare(`
    SELECT group_id, role
    FROM reading_group_members
    WHERE group_id = ? AND user_id = ?
  `).get(id, userId) as { group_id: number; role: GroupRole } | undefined
  return row ? { groupId: row.group_id, role: row.role } : null
}

export function groupOwnerId(groupId: number) {
  const row = db.prepare('SELECT owner_user_id FROM reading_groups WHERE id = ?').get(groupId) as { owner_user_id: number } | undefined
  return row?.owner_user_id ?? null
}

export function groupBook(groupId: number, bookId: unknown) {
  const id = parsePositiveId(bookId)
  if (!id) return null
  return db.prepare(`
    SELECT b.id, b.title, b.author, b.filename, b.total_pages, b.is_encrypted,
           a.created_at AS shared_at
    FROM reading_group_books a
    JOIN books b ON b.id = a.book_id
    WHERE a.group_id = ? AND a.book_id = ?
  `).get(groupId, id) as {
    id: number; title: string; author: string; filename: string; total_pages: number; is_encrypted: number; shared_at: string
  } | undefined
}

export function visibleGroupAnnotation(userId: number, groupId: number, annotationId: unknown) {
  const id = parsePositiveId(annotationId)
  if (!id) return null
  return db.prepare(`
    SELECT a.*, u.username AS author_username
    FROM reading_group_annotations a
    JOIN users u ON u.id = a.author_user_id
    WHERE a.id = ? AND a.group_id = ?
      AND (a.visibility = 'group' OR a.author_user_id = ?)
  `).get(id, groupId, userId) as Record<string, unknown> | undefined
}

export function parseJsonContent(value: unknown) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return {} }
}
