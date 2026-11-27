'use client'

import { useState } from 'react'
import { Flame, Target } from 'lucide-react'
import { useI18n } from './I18nProvider'
import {
  getReadingGoalMinutes,
  goalProgressPercent,
  setReadingGoalMinutes,
} from '@/lib/readingGoals'
import type { LibraryTheme } from '@/lib/libraryTheme'
import { LIBRARY_THEME } from '@/lib/libraryTheme'

interface ReadingGoalWidgetProps {
  todaySeconds: number
  streak: number
  libraryTheme: LibraryTheme
}

export default function ReadingGoalWidget({ todaySeconds, streak, libraryTheme }: ReadingGoalWidgetProps) {
  const { t } = useI18n()
  const [goalMinutes, setGoalMinutes] = useState(() => getReadingGoalMinutes())
  const th = LIBRARY_THEME[libraryTheme]
  const progress = goalProgressPercent(todaySeconds, goalMinutes)
  const todayMinutes = Math.round(todaySeconds / 60)

  function handleGoalChange(value: number) {
    setReadingGoalMinutes(value)
    setGoalMinutes(value)
  }

  return (
    <section className={`library-card-reveal mt-6 overflow-hidden rounded-2xl border p-4 shadow-[0_20px_70px_var(--lib-shadow)] sm:p-5 ${th.card}`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={`text-xs font-black uppercase tracking-[0.22em] ${th.bookCat}`}>{t('library.readingGoal.label')}</p>
          <h2 className={`mt-1 text-2xl font-black ${th.title}`}>{t('library.readingGoal.title')}</h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1.5 text-xs font-semibold text-orange-200">
          <Flame size={14} />
          {t('library.readingGoal.streak', { count: streak })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className={th.bookMeta}>{t('library.readingGoal.today', { minutes: todayMinutes, goal: goalMinutes })}</span>
            <span className={`font-bold ${th.title}`}>{progress}%</span>
          </div>
          <div className="liquid-glass-progress-bg relative h-3 rounded-full">
            <div
              className="liquid-glass-progress-fill"
              style={{ width: `${progress}%`, '--progress-color': th.progressColor, '--progress-glow': th.progressGlow } as React.CSSProperties}
            />
          </div>
        </div>

        <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${th.input}`}>
          <Target size={14} />
          <span>{t('library.readingGoal.dailyTarget')}</span>
          <input
            type="number"
            min={5}
            max={240}
            step={5}
            value={goalMinutes}
            onChange={event => handleGoalChange(Number(event.target.value))}
            className={`w-16 rounded-md border bg-transparent px-2 py-1 text-right text-sm outline-none ${th.input}`}
            aria-label={t('library.readingGoal.dailyTarget')}
          />
          <span>{t('library.readingGoal.minutes')}</span>
        </label>
      </div>
    </section>
  )
}
