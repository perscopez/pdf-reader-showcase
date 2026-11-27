'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import BackupAdminPanel from '@/components/BackupAdminPanel'
import { LibraryPageShell } from '@/components/LibrarySubnav'
import SyncStatusBadge from '@/components/SyncStatusBadge'
import { useI18n } from '@/components/I18nProvider'
import { useLibraryTheme } from '@/components/useLibraryTheme'
import { useSession } from '@/components/SessionProvider'

export default function BackupsPage() {
  const { t } = useI18n()
  const router = useRouter()
  const libraryTheme = useLibraryTheme()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const { user, loading: sessionLoading } = useSession()
  const cinematic = libraryTheme !== 'seoul'

  useEffect(() => {
    if (sessionLoading) return
    if (user?.username === 'owner' && user.role === 'admin') {
      const timer = window.setTimeout(() => setAllowed(true), 0)
      return () => window.clearTimeout(timer)
    }
    router.replace('/')
  }, [router, sessionLoading, user?.role, user?.username])

  if (allowed !== true) {
    return (
      <div className={`flex min-h-screen items-center justify-center ${cinematic ? 'bg-[#050505] text-[#8d8986]' : 'bg-[#FAF8F4] text-[#7A7060]'}`}>
        {t('common.loading')}
      </div>
    )
  }

  return (
    <LibraryPageShell
      title={t('backup.pageTitle')}
      subtitle={t('backup.pageHint')}
      libraryTheme={libraryTheme}
      active="backups"
      showBackups
      showBugs
    >
      <div className="mb-4 flex items-center justify-end gap-2">
        <SyncStatusBadge compact={false} />
        <LanguageSwitcher compact />
      </div>
      <BackupAdminPanel libraryTheme={libraryTheme} />
    </LibraryPageShell>
  )
}
