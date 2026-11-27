import { cleanText } from '@/lib/text'

export const ANNOTATION_CATEGORY_COLORS = [
  '#e50914',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#94a3b8',
] as const

export interface AnnotationCategory {
  id: number
  name: string
  color: string
  position: number
  created_at?: string
  updated_at?: string
}

export function normalizeCategoryName(value: unknown) {
  return cleanText(String(value ?? '')).trim().replace(/\s+/g, ' ').slice(0, 40)
}

export function categoryNameKey(value: unknown) {
  return normalizeCategoryName(value).toLocaleLowerCase('tr')
}

export function normalizeCategoryColor(value: unknown) {
  const color = String(value ?? '').toLowerCase()
  return (ANNOTATION_CATEGORY_COLORS as readonly string[]).includes(color)
    ? color
    : ANNOTATION_CATEGORY_COLORS[0]
}

export function parseCategoryId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
