'use client'

import { cleanText } from '@/lib/text'
import { useI18n } from '@/components/I18nProvider'
import ReadingGoalWidget from '@/components/ReadingGoalWidget'
import type { LibraryTheme } from '@/lib/libraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'
import {
  formatReadingTime,
  type ReadingSummary,
  type ReadingSummaryPeriod,
} from '@/lib/readingDisplay'

function ReadingPeriodCard({ title, period, libraryTheme, th, t }: {
  title: string
  period: ReadingSummaryPeriod
  libraryTheme: LibraryTheme
  th: (typeof LIBRARY_THEME)[LibraryTheme]
  t: ReturnType<typeof useI18n>['t']
}) {
  const hasReading = period.seconds > 0 || period.books.length > 0

  return (
    <article className={`rounded-2xl border p-5 backdrop-blur-md transition-all duration-300 ${th.statCard} shadow-[0_18px_55px_var(--lib-shadow)]`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-black uppercase tracking-[0.16em] ${th.bookCat}`}>{title}</p>
          <p className={`mt-1 text-4xl font-black tracking-tight ${th.title}`}>{formatReadingTime(period.seconds, t)}</p>
        </div>
        <div className="grid gap-1.5 text-right">
          <span className={`rounded-full px-3 py-1 text-xs font-black ${th.statusReading}`}>
            {t('library.pagesRead', { count: period.pages })}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${th.cardBadge}`}>
            {t('library.sessionsRead', { count: period.sessions })}
          </span>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {!hasReading && (
          <div className={`rounded-xl border border-dashed px-4 py-8 text-center text-sm ${th.emptyPanel} ${th.cardMuted}`}>
            {t('library.noReadingPeriod')}
          </div>
        )}
        {period.books.map(book => (
          <div
            key={`${title}-${book.bookId}`}
            className={`rounded-xl border px-3 py-2.5 transition-all duration-200 ${th.cardBadge} hover:border-[var(--lib-border-strong)]`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-bold ${th.bookTitle}`}>{cleanText(book.title)}</p>
                {book.author && <p className={`truncate text-xs ${th.bookAuthor}`}>{cleanText(book.author)}</p>}
              </div>
              <div className={`shrink-0 text-right text-xs font-semibold ${th.bookMeta}`}>
                <p>{formatReadingTime(book.seconds, t)}</p>
                <p>{t('library.pagesRead', { count: book.pages })}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

export default function ReadingStatsPanel({
  summary,
  libraryTheme,
}: {
  summary: ReadingSummary
  libraryTheme: LibraryTheme
}) {
  const { t } = useI18n()
  const th = LIBRARY_THEME[libraryTheme]

  return (
    <div className="space-y-6">
      <ReadingGoalWidget
        todaySeconds={summary.today.seconds}
        streak={summary.streak || 0}
        libraryTheme={libraryTheme}
      />

      <section className={`library-panel overflow-hidden rounded-2xl border p-4 shadow-[0_28px_90px_var(--lib-shadow)] sm:p-6 ${th.card}`}>
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={`text-xs font-black uppercase tracking-[0.22em] ${th.bookCat}`}>{t('library.readingRhythmLabel')}</p>
            <h2 className={`mt-1 text-2xl font-black sm:text-3xl ${th.title}`}>{t('library.readingRhythm')}</h2>
          </div>
          <span className={`max-w-md text-xs sm:text-right ${th.bookMeta}`}>{t('library.readingRhythmHint')}</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ReadingPeriodCard title={t('library.todayRead')} period={summary.today} libraryTheme={libraryTheme} th={th} t={t} />
          <ReadingPeriodCard title={t('library.weekRead')} period={summary.week} libraryTheme={libraryTheme} th={th} t={t} />
        </div>
      </section>
    </div>
  )
}
