export const READING_GOAL_KEY = 'pdf_reading_goal_minutes'
export const DEFAULT_READING_GOAL_MINUTES = 30

export function formatReadingDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getReadingGoalMinutes(): number {
  if (typeof window === 'undefined') return DEFAULT_READING_GOAL_MINUTES
  try {
    const raw = localStorage.getItem(READING_GOAL_KEY)
    const value = Number(raw)
    if (Number.isFinite(value) && value >= 5 && value <= 240) return value
  } catch {
    // ignore
  }
  return DEFAULT_READING_GOAL_MINUTES
}

export function setReadingGoalMinutes(minutes: number): void {
  if (typeof window === 'undefined') return
  const clamped = Math.max(5, Math.min(240, Math.round(minutes)))
  localStorage.setItem(READING_GOAL_KEY, String(clamped))
}

export function computeStreak(readingDays: string[], now = new Date()): number {
  if (!readingDays.length) return 0

  const daySet = new Set(readingDays)
  const today = formatReadingDay(now)
  const yesterday = formatReadingDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  if (!daySet.has(today) && !daySet.has(yesterday)) return 0

  let streak = 0
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!daySet.has(today)) {
    cursor.setDate(cursor.getDate() - 1)
  }

  while (daySet.has(formatReadingDay(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

export function goalProgressPercent(secondsRead: number, goalMinutes: number): number {
  if (goalMinutes <= 0) return 0
  return Math.min(100, Math.round((secondsRead / (goalMinutes * 60)) * 100))
}
