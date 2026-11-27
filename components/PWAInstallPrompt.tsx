'use client'

import { useEffect, useState } from 'react'
import { useI18n } from './I18nProvider'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

const DISMISS_KEY = 'pdf-library-install-prompt-dismissed-at'
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function wasDismissedRecently() {
  try {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || '0')
    return dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_MS
  } catch {
    return false
  }
}

export default function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSHint, setShowIOSHint] = useState(false)
  const [isOnline, setIsOnline] = useState(true)
  const { t } = useI18n()

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    const handleAppInstalled = () => {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()))
      } catch (e) {
        console.warn(e)
      }
      setInstallEvent(null)
      setShowIOSHint(false)
    }
    const handleBeforeInstallPrompt = (event: Event) => {
      if (isStandaloneMode() || wasDismissedRecently()) return
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('appinstalled', handleAppInstalled)
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    const onlineTimer = window.setTimeout(() => setIsOnline(navigator.onLine), 0)
    let iosTimer: ReturnType<typeof setTimeout> | undefined
    if (!isStandaloneMode() && isIOSDevice() && !wasDismissedRecently()) {
      iosTimer = setTimeout(() => setShowIOSHint(true), 1200)
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('appinstalled', handleAppInstalled)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.clearTimeout(onlineTimer)
      if (iosTimer) clearTimeout(iosTimer)
    }
  }, [])

  async function installApp() {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()))
      } catch (e) {
        console.warn(e)
      }
    }
    setInstallEvent(null)
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch (e) {
      console.warn(e)
    }
    setInstallEvent(null)
    setShowIOSHint(false)
  }

  const shouldShowInstall = Boolean(installEvent || showIOSHint)

  if (isOnline && !shouldShowInstall) return null

  return (
    <div className="fixed left-3 right-3 bottom-3 z-[120] flex justify-center pointer-events-none" aria-live="polite">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur pointer-events-auto">
        {!isOnline && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
            {t('pwa.offline')}
          </div>
        )}

        {shouldShowInstall && (
          <div className="p-4">
            <div className="flex items-start gap-3">
              <img loading="lazy" decoding="async" src="/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{t('pwa.installTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {installEvent ? t('pwa.installBody') : t('pwa.iosBody')}
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-lg px-2 text-xl leading-none text-slate-500 hover:bg-slate-800 hover:text-white"
                aria-label={t('pwa.dismiss')}
              >
                ×
              </button>
            </div>

            {installEvent && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={installApp}
                  className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {t('pwa.install')}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  {t('pwa.later')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
