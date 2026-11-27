export interface ReadingSummaryBook {
  bookId: number
  title: string
  author: string
  seconds: number
  pages: number
  sessions: number
}

export interface ReadingSummaryPeriod {
  seconds: number
  pages: number
  sessions: number
  books: ReadingSummaryBook[]
}

export interface ReadingSummary {
  today: ReadingSummaryPeriod
  week: ReadingSummaryPeriod
  streak?: number
}

type TimeKey = 'time.minsOnly' | 'time.hoursMin' | 'time.hoursOnly'

export function formatReadingTime(
  seconds = 0,
  t: (key: TimeKey, values?: Record<string, string | number>) => string,
) {
  if (seconds <= 0) return t('time.minsOnly', { m: 0 })
  const mins = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours && rem) return t('time.hoursMin', { h: hours, m: rem })
  if (hours) return t('time.hoursOnly', { h: hours })
  return t('time.minsOnly', { m: Math.max(1, rem) })
}
