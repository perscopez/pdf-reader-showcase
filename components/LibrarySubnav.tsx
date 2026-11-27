'use client'

import { useSession } from '@/components/SessionProvider'
import Link from 'next/link'
import { BarChart3, BookMarked, Bug, Columns2, HardDrive, Home, Languages, Network, ShieldCheck, StickyNote, Telescope, Users } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import type { LibraryTheme } from '@/lib/libraryTheme'
import { getLibraryThemeStyle, LIBRARY_THEME } from '@/lib/libraryTheme'

type SubnavKey = 'home' | 'words' | 'notes' | 'notebooks' | 'stats' | 'research' | 'compare' | 'graph' | 'groups' | 'bugs' | 'backups' | 'admin'

type UserMeta = {
  username: string
  role: string
}

export default function LibrarySubnav({
  active,
  libraryTheme,
  showBugs = false,
  showBackups = false,
  showAdmin = false,
}: {
  active: SubnavKey
  libraryTheme: LibraryTheme
  showBugs?: boolean
  showBackups?: boolean
  showAdmin?: boolean
}) {
  const { t } = useI18n()
  const th = LIBRARY_THEME[libraryTheme]
  const { user: sessionUser } = useSession()
  const userMeta: UserMeta | null = sessionUser?.username
    ? { username: sessionUser.username, role: sessionUser.role || 'user' }
    : null

  const canSeeAdmin = showAdmin || userMeta?.role === 'admin'
  const canSeeBugs = showBugs || userMeta?.role === 'admin'
  const canSeeBackups = showBackups || (userMeta?.username === 'owner' && userMeta?.role === 'admin')

  const items: { key: SubnavKey; href: string; label: string; icon: typeof Home }[] = [
    { key: 'home', href: '/', label: t('library.nav.home'), icon: Home },
    { key: 'words', href: '/words', label: t('common.words'), icon: Languages },
    { key: 'notes', href: '/notes', label: 'Notlar', icon: StickyNote },
    { key: 'notebooks', href: '/notebooks', label: 'Not defterleri', icon: BookMarked },
    { key: 'research', href: '/research', label: 'Kaynaklı AI', icon: Telescope },
    { key: 'compare', href: '/compare', label: 'Karşılaştır', icon: Columns2 },
    { key: 'stats', href: '/stats', label: t('library.nav.stats'), icon: BarChart3 },
    { key: 'graph', href: '/knowledge-graph', label: t('graph.nav'), icon: Network },
    { key: 'groups', href: '/groups', label: 'Okuma grupları', icon: Users },
  ]

  if (canSeeAdmin || canSeeBugs || canSeeBackups) {
    items.push({ key: 'admin', href: '/admin', label: 'Yönetim Paneli', icon: ShieldCheck })
  }
  if (canSeeBugs) {
    items.push({ key: 'bugs', href: '/bugs', label: t('bug.title'), icon: Bug })
  }
  if (canSeeBackups) {
    items.push({ key: 'backups', href: '/backups', label: t('backup.nav'), icon: HardDrive })
  }

  return (
    <nav
      aria-label={t('library.nav.label')}
      className="library-subnav flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map(item => {
        const Icon = item.icon
        const isActive = active === item.key
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold transition-all duration-200 ${isActive ? `${th.subnavActive} shadow-sm` : `${th.subnavInactive} hover:brightness-95`}`}
          >
            <Icon size={14} />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export function LibraryPageShell({
  title,
  subtitle,
  backHref = '/',
  libraryTheme,
  active,
  showBugs = false,
  showBackups = false,
  showAdmin = false,
  children,
}: {
  title: string
  subtitle?: string
  backHref?: string
  libraryTheme: LibraryTheme
  active: SubnavKey
  showBugs?: boolean
  showBackups?: boolean
  showAdmin?: boolean
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const th = LIBRARY_THEME[libraryTheme]
  return (
    <div style={getLibraryThemeStyle(libraryTheme) as React.CSSProperties} className={`library-page relative min-h-screen overflow-x-clip text-[var(--lib-text)] ${th.bg}`}>
      {libraryTheme !== 'seoul' && (
        <div className="library-cinematic-bg pointer-events-none fixed inset-0" aria-hidden>
          <div className="library-mesh absolute inset-0" />
          <div className="library-vignette absolute inset-0" />
          <div className="library-noise absolute inset-0 opacity-[0.035]" />
        </div>
      )}
      <header className={`library-header sticky top-0 z-30 border-b px-3 py-3 sm:px-4 liquid-glass-bar ${th.headerBorder}`}>
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={backHref} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold min-h-[44px] inline-flex items-center ${th.navBtn}`}>
              ← {t('library.nav.back')}
            </Link>
            <div className="min-w-0 flex-1">
            <h1 className={`library-page-title truncate text-lg font-black tracking-tight sm:text-xl ${th.title}`}>{title}</h1>
              {subtitle && <p className={`truncate text-xs ${th.subtitle}`}>{subtitle}</p>}
            </div>
          </div>
          <div className="mt-3">
            <LibrarySubnav active={active} libraryTheme={libraryTheme} showBugs={showBugs} showBackups={showBackups} showAdmin={showAdmin} />
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-5xl p-3 sm:p-5">
        {children}
      </main>
    </div>
  )
}
